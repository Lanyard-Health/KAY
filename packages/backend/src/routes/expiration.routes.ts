import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ExpirationService } from '../services/expiration.service.js';

export const expirationRoutes = Router();

expirationRoutes.use(authenticate);

const expirationService = new ExpirationService();

// GET /api/v1/expirations - Get upcoming expirations
expirationRoutes.get(
  '/',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt(req.query['days'] as string) || 30;
      const type = req.query['type'] as string;

      const expirations = await expirationService.getUpcomingExpirations(days, type);

      res.json({ success: true, data: expirations });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/expirations/dashboard - Get expiration dashboard data
expirationRoutes.get(
  '/dashboard',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dashboard = await expirationService.getDashboardData();

      res.json({ success: true, data: dashboard });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/expirations/provider/:providerId - Get expirations for a provider
expirationRoutes.get(
  '/provider/:providerId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId'];

      // Check if user can access this provider
      if (
        req.user?.role === 'provider' &&
        req.user.providerId !== providerId
      ) {
        res.status(403).json({ success: false, error: { message: 'Access denied' } });
        return;
      }

      const expirations = await expirationService.getProviderExpirations(providerId!);

      res.json({ success: true, data: expirations });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/expirations/send-reminders - Manually trigger reminder emails
expirationRoutes.post(
  '/send-reminders',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { days } = req.body;
      const thresholds = days ? [days] : [90, 60, 30, 14, 7];

      const result = await expirationService.sendExpirationReminders(thresholds);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
