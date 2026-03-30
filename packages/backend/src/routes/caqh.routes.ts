import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { requirePracticeProvider } from '../middleware/practiceScope.middleware.js';
import { CaqhService } from '../services/caqh.service.js';
import { caqhCredentialsService } from '../services/caqh-credentials.service.js';
import rateLimit from 'express-rate-limit';

export const caqhRoutes = Router();

caqhRoutes.use(authenticate);
caqhRoutes.use(authorize('admin', 'lanyard_admin', 'credentialing_staff'));
caqhRoutes.use(requirePracticeProvider);

const caqhService = new CaqhService();

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
      const { providerId } = req.body;

      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        return caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist');
      }

      const result = await caqhService.addToRoster(provider);

      // Update provider with CAQH ID
      await prisma.providerProfile.update({
        where: { id: providerId },
        data: {
          caqhProviderId: result.caqhProviderId,
          caqhStatus: 'pending',
        },
      });

      res.json({ success: true, data: result });
    } catch (error) {
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
          caqhStatus: status.attestationStatus,
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
  authorize('admin'),
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

// GET /api/v1/caqh/config - Get CAQH integration configuration status
caqhRoutes.get(
  '/config',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const configured = caqhService.isConfigured();
      const schedule = process.env['CAQH_SYNC_SCHEDULE'] || '0 2 * * *';

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
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
