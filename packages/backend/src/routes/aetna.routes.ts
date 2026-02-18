import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { checkAetnaReadiness } from '../services/aetna/readiness.service.js';
import { startAetnaEnrollment, approveAndSubmit, rejectRun } from '../services/aetna/enrollment.service.js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const aetnaRoutes = Router({ mergeParams: true });

// All routes require auth + staff role
aetnaRoutes.use(authenticate);
aetnaRoutes.use(authorize('admin', 'credentialing_staff', 'practice_admin'));

function getS3Client(): S3Client {
  return new S3Client({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['S3_ENDPOINT'] ? {
      endpoint: process.env['S3_ENDPOINT'],
      forcePathStyle: true,
    } : {}),
  });
}

// POST /api/v1/enrollments/:enrollmentId/aetna/readiness
aetnaRoutes.post('/readiness', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enrollmentId } = req.params;

    const enrollment = await prisma.payerEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { payer: true },
    });

    if (!enrollment) {
      return res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
    }

    const result = await checkAetnaReadiness(enrollment.providerId);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/enrollments/:enrollmentId/aetna/start
aetnaRoutes.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enrollmentId } = req.params;
    const userId = req.user!.id;

    const enrollment = await prisma.payerEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      return res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
    }

    // Check for existing active run
    const activeRun = await prisma.aetnaEnrollmentRun.findFirst({
      where: {
        payerEnrollmentId: enrollmentId,
        status: { in: ['pending', 'filling', 'awaiting_review', 'submitting'] },
      },
    });

    if (activeRun) {
      return res.status(409).json({
        success: false,
        error: { message: 'An active enrollment run already exists', data: { runId: activeRun.id } },
      });
    }

    // Check readiness first
    const readiness = await checkAetnaReadiness(enrollment.providerId);
    if (!readiness.ready) {
      return res.status(400).json({
        success: false,
        error: { message: 'Provider data is not complete for Aetna enrollment', data: readiness },
      });
    }

    // Create the run record
    const run = await prisma.aetnaEnrollmentRun.create({
      data: {
        payerEnrollmentId: enrollmentId,
        status: 'pending',
        formPayload: {},
        initiatedById: userId,
      },
    });

    // Launch async — don't await (long-running process)
    startAetnaEnrollment(enrollmentId, run.id, userId).catch(err => {
      logger.error(`Aetna enrollment run ${run.id} failed`, err);
    });

    logger.info(`Aetna enrollment run ${run.id} created for enrollment ${enrollmentId}`);

    res.status(201).json({ success: true, data: { runId: run.id, status: run.status } });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/enrollments/:enrollmentId/aetna/runs/:runId
aetnaRoutes.get('/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runId } = req.params;

    const run = await prisma.aetnaEnrollmentRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return res.status(404).json({ success: false, error: { message: 'Run not found' } });
    }

    // Generate signed URLs for screenshots
    const s3 = getS3Client();
    const bucketName = process.env['S3_BUCKET_NAME'] ?? 'credentials-documents';
    const screenshotUrls = await Promise.all(
      run.screenshotDocIds.map(async (key) => {
        return getSignedUrl(s3, new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        }), { expiresIn: 3600 });
      })
    );

    let confirmationPdfUrl: string | null = null;
    if (run.confirmationPdfId) {
      confirmationPdfUrl = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: bucketName,
        Key: run.confirmationPdfId,
      }), { expiresIn: 3600 });
    }

    res.json({
      success: true,
      data: {
        id: run.id,
        status: run.status,
        aetnaRequestId: run.aetnaRequestId,
        screenshotDocIds: run.screenshotDocIds,
        screenshotUrls,
        automationLog: run.automationLog,
        errorMessage: run.errorMessage,
        errorPage: run.errorPage,
        startedAt: run.startedAt,
        reviewExpiresAt: run.reviewExpiresAt,
        submittedAt: run.submittedAt,
        completedAt: run.completedAt,
        confirmationPdfUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/enrollments/:enrollmentId/aetna/runs/:runId/approve
aetnaRoutes.post('/runs/:runId/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runId } = req.params;

    const run = await prisma.aetnaEnrollmentRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return res.status(404).json({ success: false, error: { message: 'Run not found' } });
    }

    if (run.status !== 'awaiting_review') {
      return res.status(400).json({
        success: false,
        error: { message: `Cannot approve run in status: ${run.status}` },
      });
    }

    if (run.reviewExpiresAt && new Date() > run.reviewExpiresAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'Review window has expired. Please start a new enrollment run.' },
      });
    }

    // Launch async submit
    approveAndSubmit(runId).catch(err => {
      logger.error(`Aetna run ${runId} approval failed`, err);
    });

    res.json({ success: true, data: { id: run.id, status: 'submitting' } });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/enrollments/:enrollmentId/aetna/runs/:runId/reject
aetnaRoutes.post('/runs/:runId/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runId } = req.params;

    const run = await prisma.aetnaEnrollmentRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return res.status(404).json({ success: false, error: { message: 'Run not found' } });
    }

    if (!['awaiting_review', 'filling', 'pending'].includes(run.status)) {
      return res.status(400).json({
        success: false,
        error: { message: `Cannot reject run in status: ${run.status}` },
      });
    }

    await rejectRun(runId);

    res.json({ success: true, data: { id: run.id, status: 'rejected' } });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/enrollments/:enrollmentId/aetna/runs/:runId/retry
aetnaRoutes.post('/runs/:runId/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runId } = req.params;

    const run = await prisma.aetnaEnrollmentRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return res.status(404).json({ success: false, error: { message: 'Run not found' } });
    }

    if (!['failed', 'timed_out'].includes(run.status)) {
      return res.status(400).json({
        success: false,
        error: { message: `Cannot retry run in status: ${run.status}` },
      });
    }

    // Reset the run
    const updated = await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'pending',
        errorMessage: null,
        errorPage: null,
        automationLog: null,
        screenshotDocIds: [],
        startedAt: null,
        reviewExpiresAt: null,
        submittedAt: null,
        completedAt: null,
      },
    });

    // Re-launch the form filler
    startAetnaEnrollment(run.payerEnrollmentId, runId, run.initiatedById).catch(err => {
      logger.error(`Aetna enrollment retry ${runId} failed`, err);
    });

    res.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (error) {
    next(error);
  }
});
