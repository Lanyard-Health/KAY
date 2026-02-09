import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { requirePracticeProvider } from '../middleware/practiceScope.middleware.js';
import { CaqhService } from '../services/caqh.service.js';
import { caqhCredentialsService } from '../services/caqh-credentials.service.js';

export const caqhRoutes = Router();

caqhRoutes.use(authenticate);
caqhRoutes.use(authorize('admin', 'credentialing_staff'));
caqhRoutes.use(requirePracticeProvider);

const caqhService = new CaqhService();

// ============================================
// CAQH CREDENTIALS VERIFICATION ROUTES
// ============================================

// POST /api/v1/caqh/credentials/test - Test credentials without saving (for initial validation)
// NOTE: This route MUST come before /:providerId routes to prevent "test" being matched as a provider ID
caqhRoutes.post(
  '/credentials/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required',
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required',
        });
      }

      const provider = await prisma.provider.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const provider = await prisma.provider.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const provider = await prisma.provider.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = req.body;

      const provider = await prisma.provider.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
      }

      const result = await caqhService.addToRoster(provider);

      // Update provider with CAQH ID
      await prisma.provider.update({
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.provider.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!provider || !provider.caqhProviderId) {
        throw new NotFoundError('Provider or CAQH registration');
      }

      await caqhService.removeFromRoster(provider.caqhProviderId);

      await prisma.provider.update({
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.provider.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!provider || !provider.caqhProviderId) {
        throw new NotFoundError('Provider or CAQH registration');
      }

      const status = await caqhService.checkStatus(provider.caqhProviderId);

      // Update local status
      await prisma.provider.update({
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.provider.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!provider || !provider.caqhProviderId) {
        throw new NotFoundError('Provider or CAQH registration');
      }

      // Create sync log
      const syncLog = await prisma.caqhSyncLog.create({
        data: {
          providerId: provider.id,
          direction: 'pull',
          status: 'in_progress',
        },
      });

      try {
        const caqhData = await caqhService.pullCredentials(provider.caqhProviderId);

        // Apply changes (this would involve complex mapping)
        const changes = await applyCaqhDataToProvider(provider.id, caqhData);

        // Update sync log
        await prisma.caqhSyncLog.update({
          where: { id: syncLog.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
            changesApplied: changes as any,
          },
        });

        // Update provider sync timestamp
        await prisma.provider.update({
          where: { id: provider.id },
          data: { caqhLastSync: new Date() },
        });

        res.json({ success: true, data: { syncId: syncLog.id, changes } });
      } catch (error) {
        // Update sync log with error
        await prisma.caqhSyncLog.update({
          where: { id: syncLog.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        throw error;
      }
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/caqh/sync-history/:providerId - Get sync history
caqhRoutes.get(
  '/sync-history/:providerId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const syncLogs = await prisma.caqhSyncLog.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { startedAt: 'desc' },
        take: 20,
      });

      res.json({ success: true, data: syncLogs });
    } catch (error) {
      next(error);
    }
  }
);

// Helper function to apply CAQH data to provider
async function applyCaqhDataToProvider(
  providerId: string,
  caqhData: any
): Promise<Record<string, unknown>> {
  const changes: Record<string, unknown> = {};

  // This is a placeholder - actual implementation would map CAQH fields
  // to local database fields and update accordingly

  // Example: Update licenses from CAQH data
  if (caqhData.licenses?.length > 0) {
    changes['licenses'] = caqhData.licenses.length;
    // Would create/update license records here
  }

  // Example: Update certifications from CAQH data
  if (caqhData.certifications?.length > 0) {
    changes['certifications'] = caqhData.certifications.length;
    // Would create/update certification records here
  }

  return changes;
}
