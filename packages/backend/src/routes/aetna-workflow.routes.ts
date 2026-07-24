import { Router, type Request, type Response, type NextFunction } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { evaluateAetnaReadiness } from '../agents/portal/aetna-rfp-resolver.js';
import {
  launchAetnaReviewRun,
  approveAetnaRun,
  rejectAetnaRun,
  hasLiveSession,
  type AetnaScreenArtifact,
} from '../services/aetna-review.service.js';

/**
 * Aetna enrollment workflow routes — the staff-facing, human-in-the-loop
 * surface for the Aetna "Join the Network" (RFP) automation:
 *
 *   - GET/PUT /providers/:id/payer-submission-details — the extra fields the
 *     Aetna form asks for that the core profile doesn't store
 *   - GET  /providers/:id/aetna-readiness — pre-flight per-field checklist
 *   - POST /aetna-runs — launch a fill run (pauses AWAITING_REVIEW)
 *   - GET  /aetna-runs — run history; GET /aetna-runs/:id — detail with
 *     signed screenshot URLs
 *   - POST /aetna-runs/:id/approve | /reject — final human decision
 *
 * Authorization mirrors form-fill.routes: admin roles + practice_admin +
 * credentialing_staff, with practice-scope checks on provider access.
 */

const router = Router();
const STAFF = [...ADMIN_ROLES, 'practice_admin', 'credentialing_staff'] as const;

function buildS3Client(): S3Client {
  const s3Endpoint = process.env['S3_ENDPOINT'];
  return new S3Client({
    region: process.env['AWS_REGION'] || 'us-east-1',
    ...(s3Endpoint && { endpoint: s3Endpoint, forcePathStyle: true }),
    ...(process.env['AWS_ACCESS_KEY_ID'] && {
      credentials: {
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
      },
    }),
  });
}

const BUCKET = process.env['S3_BUCKET_NAME'] || 'credentials-documents';

async function ensureProviderAccess(req: Request, providerId: string): Promise<boolean> {
  if (req.practiceScope?.isSuperAdmin) return true;
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { practiceId: true },
  });
  if (!provider?.practiceId) return false;
  return !!req.practiceScope?.practiceIds?.includes(provider.practiceId);
}

async function ensureEnrollmentAccess(req: Request, enrollmentId: string): Promise<boolean> {
  if (req.practiceScope?.isSuperAdmin) return true;
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { provider: { select: { practiceId: true } } },
  });
  const practiceId = enrollment?.provider?.practiceId;
  if (!practiceId) return false;
  return !!req.practiceScope?.practiceIds?.includes(practiceId);
}

/** Locate the Aetna RFP payer + the provider's enrollment for it. */
async function resolveAetnaTarget(providerId: string): Promise<
  | { ok: true; payerId: string; practiceId: string; enrollmentId: string | null }
  | { ok: false; message: string }
> {
  const config = await prisma.payerSubmissionConfig.findFirst({
    where: { adapterType: 'AETNA_RFP' },
    select: { payerId: true },
  });
  if (!config) return { ok: false, message: 'No payer is configured with the AETNA_RFP adapter' };

  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { practiceId: true },
  });
  if (!provider?.practiceId) return { ok: false, message: 'Provider has no practice' };

  const enrollment = await prisma.enrollment.findFirst({
    where: { providerId, payerId: config.payerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  return {
    ok: true,
    payerId: config.payerId,
    practiceId: provider.practiceId,
    enrollmentId: enrollment?.id ?? null,
  };
}

const DETAIL_FIELDS = [
  'fax', 'county', 'placeOfService', 'adaAccessible', 'accessAccommodations',
  'workingDays', 'officeHours', 'facilityFee',
  'telehealth', 'telehealthServices', 'telehealthMethods', 'telehealthTypes', 'telehealthHipaaAttested',
  'submitterFirstName', 'submitterLastName', 'submitterRole', 'submitterEmail', 'submitterPhone',
  'staffLanguages', 'interpreterLanguages', 'providerLanguages', 'aslOffered',
  'medicareCertified', 'medicarePtan', 'medicaidCertified', 'eapParticipation',
  'hospitalAdmittingPrivileges', 'facilityAdmittingPrivileges',
  'bhAgeGroups', 'bhPracticeFocus', 'w9DocumentId',
] as const;

// GET /providers/:id/payer-submission-details
router.get(
  '/providers/:id/payer-submission-details',
  authenticate,
  authorize(...STAFF),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['id']!;
      if (!(await ensureProviderAccess(req, providerId))) {
        return res.status(404).json({ success: false, error: { message: 'Provider not found' } });
      }
      const detail = await prisma.payerSubmissionDetail.findUnique({
        where: { providerId },
        include: { w9Document: { select: { id: true, fileName: true, documentType: true } } },
      });
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /providers/:id/payer-submission-details — upsert
router.put(
  '/providers/:id/payer-submission-details',
  authenticate,
  authorize(...STAFF),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['id']!;
      if (!(await ensureProviderAccess(req, providerId))) {
        return res.status(404).json({ success: false, error: { message: 'Provider not found' } });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const key of DETAIL_FIELDS) {
        if (key in body) data[key] = body[key];
      }

      // A configured W9 must exist and belong to this provider.
      if (typeof data['w9DocumentId'] === 'string' && data['w9DocumentId']) {
        const doc = await prisma.document.findUnique({
          where: { id: data['w9DocumentId'] as string },
          select: { providerId: true },
        });
        if (!doc || doc.providerId !== providerId) {
          return res
            .status(400)
            .json({ success: false, error: { message: 'w9DocumentId does not reference a document belonging to this provider' } });
        }
      }

      const detail = await prisma.payerSubmissionDetail.upsert({
        where: { providerId },
        create: { providerId, ...(data as object) },
        update: data as object,
        include: { w9Document: { select: { id: true, fileName: true, documentType: true } } },
      });
      res.json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

// GET /providers/:id/aetna-readiness — pre-flight checklist
router.get(
  '/providers/:id/aetna-readiness',
  authenticate,
  authorize(...STAFF),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['id']!;
      if (!(await ensureProviderAccess(req, providerId))) {
        return res.status(404).json({ success: false, error: { message: 'Provider not found' } });
      }
      const target = await resolveAetnaTarget(providerId);
      if (!target.ok) {
        return res.status(400).json({ success: false, error: { message: target.message } });
      }
      const readiness = await evaluateAetnaReadiness(
        { providerId, practiceId: target.practiceId, payerId: target.payerId },
        prisma
      );
      res.json({
        success: true,
        data: { ...readiness, enrollmentId: target.enrollmentId, payerId: target.payerId },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /aetna-runs — launch a human-in-the-loop run
router.post(
  '/aetna-runs',
  authenticate,
  authorize(...STAFF),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = (req.body ?? {}) as { providerId?: string };
      if (!providerId) {
        return res.status(400).json({ success: false, error: { message: 'providerId is required' } });
      }
      if (!(await ensureProviderAccess(req, providerId))) {
        return res.status(404).json({ success: false, error: { message: 'Provider not found' } });
      }
      const target = await resolveAetnaTarget(providerId);
      if (!target.ok) {
        return res.status(400).json({ success: false, error: { message: target.message } });
      }
      if (!target.enrollmentId) {
        return res.status(400).json({
          success: false,
          error: { message: 'No enrollment exists for this provider with the Aetna payer — create one first' },
        });
      }

      // Fail fast on readiness BEFORE creating any run or Aetna footprint.
      const readiness = await evaluateAetnaReadiness(
        { providerId, practiceId: target.practiceId, payerId: target.payerId },
        prisma
      );
      if (!readiness.ready) {
        return res.status(422).json({
          success: false,
          error: {
            message: 'Provider is not ready for Aetna submission',
            checklist: readiness.checklist.filter((c) => !c.ok),
          },
        });
      }

      const { runId } = await launchAetnaReviewRun({
        enrollmentId: target.enrollmentId,
        providerId,
        practiceId: target.practiceId,
        payerId: target.payerId,
        triggeredBy: req.user?.id,
      });
      logger.info('aetna-workflow: run launched', { runId, providerId, by: req.user?.id });
      res.status(202).json({ success: true, data: { runId, enrollmentId: target.enrollmentId } });
    } catch (err) {
      next(err);
    }
  }
);

// GET /aetna-runs — run history across the Aetna payer
router.get(
  '/aetna-runs',
  authenticate,
  authorize(...STAFF),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await prisma.payerSubmissionConfig.findFirst({
        where: { adapterType: 'AETNA_RFP' },
        select: { payerId: true },
      });
      if (!config) return res.json({ success: true, data: [] });

      const scope = req.practiceScope?.isSuperAdmin
        ? {}
        : { provider: { practiceId: { in: req.practiceScope?.practiceIds ?? [] } } };

      const runs = await prisma.enrollmentRun.findMany({
        where: { enrollment: { payerId: config.payerId, ...scope } },
        orderBy: { startedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          enrollmentId: true,
          status: true,
          startedAt: true,
          reviewedAt: true,
          submittedAt: true,
          externalReference: true,
          confirmationNumber: true,
          errorDetails: true,
          enrollment: {
            select: {
              provider: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });
      res.json({ success: true, data: runs });
    } catch (err) {
      next(err);
    }
  }
);

// GET /aetna-runs/:id — detail with signed screenshot URLs + live-session flag
router.get(
  '/aetna-runs/:id',
  authenticate,
  authorize(...STAFF),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;
      const run = await prisma.enrollmentRun.findUnique({
        where: { id },
        select: {
          id: true,
          enrollmentId: true,
          status: true,
          startedAt: true,
          reviewedAt: true,
          submittedAt: true,
          completedAt: true,
          filledArtifacts: true,
          errorDetails: true,
          externalReference: true,
          confirmationNumber: true,
        },
      });
      if (!run || !(await ensureEnrollmentAccess(req, run.enrollmentId))) {
        return res.status(404).json({ success: false, error: { message: 'Run not found' } });
      }

      const artifacts = run.filledArtifacts as { kind?: string; screens?: AetnaScreenArtifact[] } | null;
      const s3 = buildS3Client();
      const screens = await Promise.all(
        (artifacts?.screens ?? []).map(async (screen) => {
          try {
            const url = await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: BUCKET, Key: screen.s3Key }),
              { expiresIn: 3600 }
            );
            return { ...screen, signedUrl: url };
          } catch (err) {
            logger.warn(`Failed to sign screenshot URL for ${screen.s3Key}`, err);
            return screen;
          }
        })
      );

      res.json({
        success: true,
        data: { ...run, screens, liveSession: hasLiveSession(run.id) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /aetna-runs/:id/approve — final submit
router.post(
  '/aetna-runs/:id/approve',
  authenticate,
  authorize(...STAFF),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;
      const run = await prisma.enrollmentRun.findUnique({
        where: { id },
        select: { enrollmentId: true },
      });
      if (!run || !(await ensureEnrollmentAccess(req, run.enrollmentId))) {
        return res.status(404).json({ success: false, error: { message: 'Run not found' } });
      }
      const result = await approveAetnaRun(id, req.user?.id);
      res.json({ success: true, data: result });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status) {
        return res
          .status(status)
          .json({ success: false, error: { message: (err as Error).message } });
      }
      next(err);
    }
  }
);

// POST /aetna-runs/:id/reject — cancel without submitting
router.post(
  '/aetna-runs/:id/reject',
  authenticate,
  authorize(...STAFF),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;
      const { reason } = (req.body ?? {}) as { reason?: string };
      if (!reason?.trim()) {
        return res.status(400).json({ success: false, error: { message: 'A rejection reason is required' } });
      }
      const run = await prisma.enrollmentRun.findUnique({
        where: { id },
        select: { enrollmentId: true },
      });
      if (!run || !(await ensureEnrollmentAccess(req, run.enrollmentId))) {
        return res.status(404).json({ success: false, error: { message: 'Run not found' } });
      }
      await rejectAetnaRun(id, reason.trim(), req.user?.id);
      res.json({ success: true, data: { status: 'CANCELLED' } });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status) {
        return res
          .status(status)
          .json({ success: false, error: { message: (err as Error).message } });
      }
      next(err);
    }
  }
);

export default router;
