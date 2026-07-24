import { Router, type Request, type Response, type NextFunction } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { runPdfFill } from '../services/form-fill/pdf-fill-runner.js';

/**
 * Form-fill routes — the user-facing surface for Phase 5's "Populate
 * Forms" button.
 *
 * Current scope:
 *   - POST /enrollments/:id/populate-forms — kicks off a fill run for
 *     every PayerForm with deliveryEngine='pdf' attached to the
 *     enrollment's PayerTrack. Runs synchronously for now (no BullMQ);
 *     the user sits through the ~1s PDF fill. If we ever need to fan
 *     out to many forms, or the browser engine lands, we'll queue it.
 *   - GET /enrollments/:id/runs — list runs for an enrollment
 *   - GET /enrollment-runs/:id — single run detail with signed S3 URLs
 *     for filled PDF artifacts (1-hour expiry)
 *
 * Authorization: standard admin roles + practice_admin. Access to an
 * EnrollmentRun requires access to the underlying enrollment's practice.
 */

const router = Router();

// Shared S3 client for signed URL generation (read-only).
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

async function ensurePracticeAccess(req: Request, enrollmentId: string): Promise<boolean> {
  if (req.practiceScope?.isSuperAdmin) return true;
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { provider: { select: { practiceId: true } } },
  });
  const practiceId = enrollment?.provider?.practiceId;
  if (!practiceId) return false;
  return !!req.practiceScope?.practiceIds?.includes(practiceId);
}

// POST /api/v1/enrollments/:id/populate-forms
router.post(
  '/enrollments/:id/populate-forms',
  authenticate,
  authorize(...ADMIN_ROLES, 'practice_admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enrollmentId = req.params['id']!;

      if (!(await ensurePracticeAccess(req, enrollmentId))) {
        return res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
      }

      // Load enrollment → payerTrack → payer forms (PDF only for now)
      const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: {
          id: true,
          payerTrackId: true,
          payerTrack: {
            select: {
              id: true,
              forms: {
                where: { format: 'PDF' },
                select: { id: true, formName: true, assetUrl: true },
              },
            },
          },
        },
      });

      if (!enrollment) {
        return res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
      }

      const forms = enrollment.payerTrack?.forms ?? [];
      const fillable = forms.filter((f) => f.assetUrl);

      if (fillable.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            message: enrollment.payerTrackId
              ? 'No fillable PDF forms configured for this payer track'
              : 'Enrollment is not linked to a PayerTrack — pick a payer before populating forms',
          },
        });
      }

      // Run each PDF fill; share one EnrollmentRun across all forms.
      let enrollmentRunId: string | undefined;
      const artifacts: Array<{
        payerFormId: string;
        formName: string;
        filledCount: number;
        skippedCount: number;
        missingRequired: string[];
      }> = [];

      for (const form of fillable) {
        const result = await runPdfFill({
          enrollmentId,
          payerFormId: form.id,
          triggeredBy: req.user?.id,
          enrollmentRunId, // undefined on first iteration; reused after
        });
        enrollmentRunId = result.enrollmentRunId;
        artifacts.push({
          payerFormId: form.id,
          formName: form.formName,
          filledCount: result.artifact.filledCount,
          skippedCount: result.artifact.skippedCount,
          missingRequired: result.missingRequired,
        });
      }

      logger.info(
        `populate-forms: enrollment ${enrollmentId} filled ${artifacts.length} form(s) in run ${enrollmentRunId}`
      );

      res.json({
        success: true,
        data: {
          enrollmentRunId,
          formsFilled: artifacts.length,
          artifacts,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/enrollments/:id/runs — recent runs for an enrollment
router.get(
  '/enrollments/:id/runs',
  authenticate,
  authorize(...ADMIN_ROLES, 'practice_admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enrollmentId = req.params['id']!;

      if (!(await ensurePracticeAccess(req, enrollmentId))) {
        return res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
      }

      const runs = await prisma.enrollmentRun.findMany({
        where: { enrollmentId },
        orderBy: { startedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          startedAt: true,
          reviewedAt: true,
          submittedAt: true,
          completedAt: true,
          filledArtifacts: true,
          errorDetails: true,
          triggeredBy: true,
          externalReference: true,
          confirmationNumber: true,
        },
      });

      res.json({ success: true, data: runs });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/enrollment-runs/:id — single run with signed artifact URLs
router.get(
  '/enrollment-runs/:id',
  authenticate,
  authorize(...ADMIN_ROLES, 'practice_admin', 'credentialing_staff'),
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
          triggeredBy: true,
        },
      });

      if (!run) {
        return res.status(404).json({ success: false, error: { message: 'Run not found' } });
      }

      if (!(await ensurePracticeAccess(req, run.enrollmentId))) {
        return res.status(404).json({ success: false, error: { message: 'Run not found' } });
      }

      // Sign artifact URLs so the frontend can fetch filled PDFs directly
      // from S3 without proxying through the backend.
      const s3 = buildS3Client();
      const artifacts = Array.isArray(run.filledArtifacts)
        ? (run.filledArtifacts as Array<{ payerFormId: string; filledS3Key: string; [k: string]: unknown }>)
        : [];

      const signed = await Promise.all(
        artifacts.map(async (a) => {
          if (!a.filledS3Key) return a;
          try {
            const url = await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: BUCKET, Key: a.filledS3Key }),
              { expiresIn: 3600 }
            );
            return { ...a, signedUrl: url };
          } catch (err) {
            logger.warn(`Failed to sign artifact URL for ${a.filledS3Key}`, err);
            return a;
          }
        })
      );

      res.json({
        success: true,
        data: {
          ...run,
          filledArtifacts: signed,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
