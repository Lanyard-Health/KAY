import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { requirePracticeProvider } from '../middleware/practiceScope.middleware.js';
import { verifyDirectorySchema, resolveAlertSchema, directoryStatusQuerySchema } from '@credential-management/shared';
import {
  verifyProvider,
  verifyProviderAllPayers,
  getProviderDirectoryStatus,
  getSnapshots,
  resolveAlert,
  getConfiguredPayers,
} from '../services/providerDirectory.service.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'credentialing_staff'));
router.use(requirePracticeProvider);

// GET /configured-payers — list payers with active directory adapters
router.get(
  '/configured-payers',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const payers = getConfiguredPayers();
      res.json({ success: true, data: payers });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:providerId/verify — verify provider against a specific payer
router.post(
  '/:providerId/verify',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const parsed = verifyDirectorySchema.parse(req.body);

      const snapshot = await verifyProvider(providerId, parsed.payerId);
      res.json({ success: true, data: snapshot });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:providerId/verify-all — verify against all configured payers
router.post(
  '/:providerId/verify-all',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const snapshots = await verifyProviderAllPayers(providerId);
      res.json({ success: true, data: snapshots });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:providerId/status — get latest snapshots + open alerts + summary
router.get(
  '/:providerId/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const status = await getProviderDirectoryStatus(providerId);
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:providerId/snapshots — paginated history
router.get(
  '/:providerId/snapshots',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const parsed = directoryStatusQuerySchema.parse(req.query);
      const take = Math.min(Number(req.query['limit']) || 20, 100);
      const skip = Number(req.query['offset']) || 0;

      const snapshots = await getSnapshots(providerId, parsed.payerId, take, skip);
      res.json({ success: true, data: snapshots });
    } catch (error) {
      next(error);
    }
  }
);

// POST /alerts/:alertId/resolve — mark alert as resolved
router.post(
  '/alerts/:alertId/resolve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const alertId = req.params['alertId']!;
      const parsed = resolveAlertSchema.parse(req.body);
      const resolvedBy = parsed.resolvedBy || (req as any).user?.email || 'unknown';

      const alert = await resolveAlert(alertId, resolvedBy);
      res.json({ success: true, data: alert });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
