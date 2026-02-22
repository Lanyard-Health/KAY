import type { Request, Response, NextFunction } from 'express';
import { getSubscription } from '../services/billing.service.js';
import { logger } from '../utils/logger.js';

export async function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Admin/ops_staff bypass — they don't need subscriptions
    if (req.practiceScope?.isSuperAdmin) {
      next();
      return;
    }

    const practiceId = req.practiceScope?.practiceIds?.[0];
    if (!practiceId) {
      // No practice context = probably an admin call, let it through
      next();
      return;
    }

    const sub = await getSubscription(practiceId);

    // No subscription at all — block
    if (!sub) {
      res.status(402).json({
        error: 'Active subscription required',
        billingUrl: '/settings/billing',
      });
      return;
    }

    // Cancelled — block
    if (sub.status === 'CANCELLED') {
      res.status(402).json({
        error: 'Subscription cancelled — please reactivate',
        billingUrl: '/settings/billing',
      });
      return;
    }

    // Past due — block
    if (sub.status === 'PAST_DUE') {
      res.status(402).json({
        error: 'Payment required — please update billing',
        billingUrl: '/settings/billing',
      });
      return;
    }

    // TRIALING and ACTIVE pass through
    next();
  } catch (error) {
    logger.error(`Subscription check failed: ${error instanceof Error ? error.message : 'unknown'}`);
    // On error, let the request through (fail open for subscription check)
    // rather than blocking all operations when Stripe is down
    next();
  }
}
