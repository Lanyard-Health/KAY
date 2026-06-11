import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { requirePracticeProvider } from '../middleware/practiceScope.middleware.js';
import {
  CaqhService,
  ProviderNotReadyForCaqhError,
  CaqhRosterIndividualException,
  CaqhBatchEnqueueException,
  CaqhDuplicateException,
  CaqhOptOutException,
  CaqhMultipleMatchException,
  CaqhInvalidProviderIdException,
} from '../services/caqh.service.js';
import { caqhCredentialsService } from '../services/caqh-credentials.service.js';
import { enqueueCaqhImport } from '../queues/caqh-import.queue.js';
import { importCaqhDocuments } from '../services/caqh-document-import.service.js';
import { scrubPii, buildCsv, buildPdf, slugifyForFilename, type ExportContext } from '../utils/caqh-export.js';
import rateLimit from 'express-rate-limit';

export const caqhRoutes = Router();

caqhRoutes.use(authenticate);
caqhRoutes.use(authorize('admin', 'credentialing_staff'));
caqhRoutes.use(requirePracticeProvider);

const caqhService = new CaqhService();

const addToRosterSchema = z.object({
  providerId: z.string().uuid(),
});

const credentialVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, error: { message: 'Too many credential verification requests, please try again later' } },
  standardHeaders: true,
  legacyHeaders: false,
});

function caqhError(res: Response, code: string, message: string, status = 404) {
  return res.status(status).json({ success: false, code, error: message });
}

// ============================================
// CAQH CREDENTIALS VERIFICATION ROUTES
// ============================================

// POST /api/v1/caqh/credentials/test - Test credentials without saving (for initial validation)
// NOTE: This route MUST come before /:providerId routes to prevent "test" being matched as a provider ID
caqhRoutes.post(
  '/credentials/test',
  credentialVerifyLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body;

      if (!username || typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
        return res.status(400).json({
          success: false,
          error: 'Valid username is required (1-256 characters)',
        });
      }
      if (!password || typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
        return res.status(400).json({
          success: false,
          error: 'Valid password is required (1-256 characters)',
        });
      }

      const result = await caqhCredentialsService.verifyCredentials(username, password);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/caqh/import/:providerId — CAQH-first onboarding: enqueue the
// background import job (roster-add → status check → full profile sync).
// Returns 202 immediately; progress is visible via provider.caqhImportStatus.
caqhRoutes.post(
  '/import/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
        select: { id: true, caqhProviderId: true },
      });
      if (!provider) {
        return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
      }
      if (!provider.caqhProviderId) {
        return res.status(400).json({
          success: false,
          error: 'Provider has no CAQH Provider ID — add one on the provider page first',
        });
      }

      const { jobId, deduplicated } = await enqueueCaqhImport({ providerId, trigger: 'manual' });

      res.status(202).json({
        success: true,
        data: { jobId, deduplicated, status: 'queued' },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/caqh/import-documents/:providerId — CAQH-first onboarding PR 3:
// pull the provider's documents from CAQH into our document system. Idempotent;
// also runs automatically as the tail of the caqh-import job.
caqhRoutes.post(
  '/import-documents/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
        select: { id: true, caqhProviderId: true },
      });
      if (!provider) {
        return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
      }
      if (!provider.caqhProviderId) {
        return res.status(400).json({
          success: false,
          error: 'Provider has no CAQH Provider ID — add one on the provider page first',
        });
      }

      const summary = await importCaqhDocuments(providerId);
      res.json({ success: true, data: summary });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/caqh/credentials/:providerId - Save CAQH credentials
caqhRoutes.post(
  '/credentials/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const { username, password } = req.body;

      if (!username || typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
        return res.status(400).json({
          success: false,
          error: 'Valid username is required (1-256 characters)',
        });
      }
      if (!password || typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
        return res.status(400).json({
          success: false,
          error: 'Valid password is required (1-256 characters)',
        });
      }

      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
      }

      await caqhCredentialsService.saveCredentials(providerId!, username, password);

      res.json({
        success: true,
        message: 'CAQH credentials saved successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/caqh/credentials/:providerId - Get credential status (not the actual password)
caqhRoutes.get(
  '/credentials/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
      }

      const status = await caqhCredentialsService.getCredentialStatus(providerId!);

      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/caqh/credentials/:providerId/verify - Verify CAQH credentials
caqhRoutes.post(
  '/credentials/:providerId/verify',
  requireProviderAccess,
  credentialVerifyLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
      }

      const result = await caqhCredentialsService.verifyAndUpdateProvider(providerId!);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// EXISTING CAQH ROSTER ROUTES
// ============================================

// POST /api/v1/caqh/roster - Add provider to CAQH roster
caqhRoutes.post(
  '/roster',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = addToRosterSchema.parse(req.body);

      const result = await caqhService.addToRoster(providerId);

      await prisma.providerProfile.update({
        where: { id: providerId },
        data: {
          caqhProviderId: result.caqhProviderId,
          caqhStatus: 'pending',
        },
      });

      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ProviderNotReadyForCaqhError) {
        return caqhError(res, 'PROVIDER_NOT_READY', error.message, 400);
      }
      if (error instanceof CaqhDuplicateException) {
        return caqhError(res, 'CAQH_DUPLICATE', error.exceptionDescription, 409);
      }
      if (error instanceof CaqhOptOutException) {
        return caqhError(res, 'CAQH_OPT_OUT', error.exceptionDescription, 422);
      }
      if (error instanceof CaqhMultipleMatchException) {
        return caqhError(res, 'CAQH_MULTIPLE_MATCH', error.exceptionDescription, 422);
      }
      if (error instanceof CaqhInvalidProviderIdException) {
        return caqhError(res, 'CAQH_INVALID_PROVIDER_ID', error.exceptionDescription, 422);
      }
      if (error instanceof CaqhRosterIndividualException) {
        return caqhError(res, 'CAQH_REJECTED', error.exceptionDescription, 422);
      }
      if (error instanceof CaqhBatchEnqueueException) {
        // 502: CAQH responded but rejected the enqueue itself (issue #206).
        return caqhError(
          res,
          'CAQH_BATCH_ENQUEUE_REJECTED',
          `CAQH did not return a usable batch_id (${error.reason}). The roster request was not accepted; provider was NOT added.`,
          502,
        );
      }
      next(error);
    }
  }
);

// DELETE /api/v1/caqh/roster/:providerId - Remove provider from roster
caqhRoutes.delete(
  '/roster/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.providerProfile.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!provider || !provider.caqhProviderId) {
        if (!provider) {
          return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
        }
        return caqhError(res, 'CAQH_NOT_REGISTERED', 'Provider is not registered with CAQH');
      }

      await caqhService.removeFromRoster(provider.caqhProviderId);

      await prisma.providerProfile.update({
        where: { id: req.params['providerId'] },
        data: {
          caqhStatus: 'inactive',
        },
      });

      res.json({ success: true, message: 'Provider removed from CAQH roster' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/caqh/status/:providerId - Check CAQH status
caqhRoutes.get(
  '/status/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.providerProfile.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!provider || !provider.caqhProviderId) {
        if (!provider) {
          return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
        }
        return caqhError(res, 'CAQH_NOT_REGISTERED', 'Provider is not registered with CAQH');
      }

      const status = await caqhService.checkStatus(provider.caqhProviderId);

      // Update local status
      await prisma.providerProfile.update({
        where: { id: req.params['providerId'] },
        data: {
          caqhStatus: status.roster_status === 'ACTIVE' ? 'active' : 'inactive',
          caqhLastSync: new Date(),
        },
      });

      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/caqh/pull/:providerId - Pull credentials from CAQH
caqhRoutes.post(
  '/pull/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.providerProfile.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!provider || !provider.caqhProviderId) {
        if (!provider) {
          return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
        }
        return caqhError(res, 'CAQH_NOT_REGISTERED', 'Provider is not registered with CAQH');
      }

      const result = await caqhService.syncProvider(provider.id, provider.caqhProviderId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/caqh/sync-all - Trigger bulk sync for all eligible providers (admin only)
caqhRoutes.post(
  '/sync-all',
  authorize(...ADMIN_ROLES),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { schedulerService } = await import('../services/scheduler.service.js');
      const result = await schedulerService.runCaqhSyncJob();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/caqh/sync-history/:providerId - Get sync history (paginated)
caqhRoutes.get(
  '/sync-history/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 20));
      const skip = (page - 1) * limit;

      const [syncLogs, total] = await Promise.all([
        prisma.caqhSyncLog.findMany({
          where: { providerId: req.params['providerId'] },
          orderBy: { startedAt: 'desc' },
          take: limit,
          skip,
        }),
        prisma.caqhSyncLog.count({
          where: { providerId: req.params['providerId'] },
        }),
      ]);

      res.json({
        success: true,
        data: syncLogs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// CAQH DOCUMENT ROUTES
// ============================================

// GET /api/v1/caqh/documents/:providerId - Get list of CAQH documents
caqhRoutes.get(
  '/documents/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.providerProfile.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!provider || !provider.caqhProviderId) {
        if (!provider) {
          return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
        }
        return caqhError(res, 'CAQH_NOT_REGISTERED', 'Provider is not registered with CAQH');
      }

      const documents = await caqhService.getDocumentsList(provider.caqhProviderId);
      res.json({ success: true, data: documents });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/caqh/documents/:providerId/download - Download a CAQH document
caqhRoutes.get(
  '/documents/:providerId/download',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const docUrl = req.query['docUrl'] as string;
      if (!docUrl || typeof docUrl !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'docUrl query parameter is required',
        });
      }

      const provider = await prisma.providerProfile.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!provider || !provider.caqhProviderId) {
        if (!provider) {
          return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
        }
        return caqhError(res, 'CAQH_NOT_REGISTERED', 'Provider is not registered with CAQH');
      }

      const result = await caqhService.downloadDocument(provider.caqhProviderId, docUrl);

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition',
        result.fileName
          ? `attachment; filename="${result.fileName}"`
          : 'attachment'
      );
      // result.data is a binary Buffer from the CAQH API (PDF/image), not user input.
      // Headers enforce download-only: Content-Disposition: attachment + X-Content-Type-Options: nosniff
      res.send(result.data); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/caqh/export/:providerId?format=json|csv|pdf - Export CAQH data
// Phase 2g: PII-scrubbed (SSN, DOB redacted across all three formats).
caqhRoutes.get(
  '/export/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const formatSchema = z.enum(['json', 'csv', 'pdf']);
      const formatResult = formatSchema.safeParse(req.query['format']);
      if (!formatResult.success) {
        return res.status(400).json({
          success: false,
          error: 'format must be one of: json, csv, pdf',
        });
      }
      const format = formatResult.data;

      const providerId = req.params['providerId'] as string;

      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
        include: {
          practice: { select: { name: true } },
          licenses: {
            select: { state: true, licenseNumber: true, expirationDate: true },
            orderBy: { expirationDate: 'desc' },
          },
          boardCertifications: {
            select: { boardName: true, specialty: true, expirationDate: true },
            orderBy: { expirationDate: 'desc' },
          },
        },
      });

      if (!provider) {
        return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
      }

      const mirror = await prisma.providerCaqhMirror.findUnique({
        where: { providerProfileId: providerId },
      });

      if (!mirror) {
        return caqhError(
          res,
          'CAQH_NOT_SYNCED',
          'No CAQH data available — sync this provider first',
        );
      }

      const filenameBase = `${slugifyForFilename(provider.lastName)}-caqh-${new Date().toISOString().slice(0, 10)}`;

      if (format === 'json') {
        const scrubbed = scrubPii(mirror.rawJson);
        const body = JSON.stringify(scrubbed, null, 2);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.json"`);
        return res.send(body);
      }

      const ctx: ExportContext = {
        providerName: [provider.firstName, provider.middleName, provider.lastName]
          .filter(Boolean)
          .join(' '),
        npi: provider.npi,
        practiceName: provider.practice?.name ?? null,
        licenses: provider.licenses.map((l) => ({
          state: l.state,
          licenseNumber: l.licenseNumber,
          expirationDate: l.expirationDate,
        })),
        boardCertifications: provider.boardCertifications.map((b) => ({
          boardName: b.boardName,
          specialty: b.specialty,
          expirationDate: b.expirationDate,
        })),
        lastSyncedAt: mirror.lastPulledAt,
      };

      if (format === 'csv') {
        const body = buildCsv(ctx);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
        return res.send(body);
      }

      // PDF
      const pdfBytes = await buildPdf(ctx);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
      return res.send(Buffer.from(pdfBytes));
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/v1/caqh/config - Get CAQH integration configuration status
caqhRoutes.get(
  '/config',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const configured = caqhService.isConfigured();
      const schedule = process.env['CAQH_SYNC_SCHEDULE'] || '0 2 * * *';
      const proviewUrl =
        `${(process.env['CAQH_API_URL'] || 'https://proview.caqh.org').replace(/\/$/, '')}/Login`;

      const lastSync = await prisma.caqhSyncLog.findFirst({
        where: { status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });

      res.json({
        success: true,
        data: {
          configured,
          syncSchedule: schedule,
          lastSyncAt: lastSync?.completedAt || null,
          proviewUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
