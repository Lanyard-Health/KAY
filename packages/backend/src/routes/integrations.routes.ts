import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';

export const integrationsRoutes = Router();

integrationsRoutes.use(authenticate);
integrationsRoutes.use(authorize(...ADMIN_ROLES));

// GET /api/v1/integrations/status - Connection status for non-CAQH/non-email integrations
integrationsRoutes.get(
  '/status',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const documentStorageConfigured = !!(
        process.env['S3_BUCKET_NAME'] && process.env['AWS_ACCESS_KEY_ID']
      );
      const documentStorageEndpoint = process.env['S3_ENDPOINT'] || null;
      const documentStorageBucket = process.env['S3_BUCKET_NAME'] || null;

      const retellConfigured = !!process.env['RETELL_API_KEY'];

      res.json({
        success: true,
        data: {
          documentStorage: {
            configured: documentStorageConfigured,
            bucket: documentStorageBucket,
            endpoint: documentStorageEndpoint,
          },
          retell: {
            configured: retellConfigured,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
