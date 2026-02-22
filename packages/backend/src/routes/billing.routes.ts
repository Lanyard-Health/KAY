import { Router, raw } from 'express';
import type { Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import {
  handleWebhook,
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  getInvoices,
} from '../services/billing.service.js';

const router = Router();

const VALID_PLANS = ['STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const;

/**
 * POST /webhook
 * Stripe webhook — NO auth middleware. Stripe calls this directly.
 * Must use express.raw() so req.body is a Buffer for signature verification.
 */
router.post('/webhook', raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    await handleWebhook(req.body, signature);
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook error', { error });
    res.status(400).json({ error: 'Webhook signature verification failed' });
  }
});

/**
 * POST /create-checkout
 * Creates a Stripe Checkout session for the practice's selected plan.
 */
router.post(
  '/create-checkout',
  authenticate,
  authorize('admin', 'practice_admin'),
  async (req: Request, res: Response) => {
    try {
      const { plan } = req.body;

      if (!plan || !VALID_PLANS.includes(plan)) {
        res.status(400).json({ error: `Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}` });
        return;
      }

      let practiceId: string | undefined;

      if (req.practiceScope?.isSuperAdmin) {
        // Super admins must explicitly provide a practiceId
        practiceId = req.body.practiceId;
        if (!practiceId) {
          res.status(400).json({ error: 'Admin must provide practiceId in request body' });
          return;
        }
      } else {
        practiceId = req.practiceScope?.practiceIds?.[0];
      }

      if (!practiceId) {
        res.status(400).json({ error: 'Practice context required' });
        return;
      }

      const { url } = await createCheckoutSession(practiceId, plan);
      res.json({ url });
    } catch (error) {
      logger.error('Failed to create checkout session', { error });
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  },
);

/**
 * POST /create-portal
 * Creates a Stripe Billing Portal session so the practice can manage their subscription.
 */
router.post(
  '/create-portal',
  authenticate,
  authorize('admin', 'practice_admin'),
  async (req: Request, res: Response) => {
    try {
      let practiceId: string | undefined;

      if (req.practiceScope?.isSuperAdmin) {
        practiceId = req.body.practiceId;
        if (!practiceId) {
          res.status(400).json({ error: 'Admin must provide practiceId in request body' });
          return;
        }
      } else {
        practiceId = req.practiceScope?.practiceIds?.[0];
      }

      if (!practiceId) {
        res.status(400).json({ error: 'Practice context required' });
        return;
      }

      const { url } = await createPortalSession(practiceId);
      res.json({ url });
    } catch (error) {
      logger.error('Failed to create portal session', { error });
      res.status(500).json({ error: 'Failed to create portal session' });
    }
  },
);

/**
 * GET /subscription
 * Returns the current subscription for the authenticated user's practice.
 */
router.get(
  '/subscription',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceScope?.practiceIds?.[0];
      if (!practiceId) {
        res.status(400).json({ error: 'Practice context required' });
        return;
      }

      const subscription = await getSubscription(practiceId);
      if (!subscription) {
        res.status(404).json({ error: 'No active subscription found' });
        return;
      }

      res.json(subscription);
    } catch (error) {
      logger.error('Failed to get subscription', { error });
      res.status(500).json({ error: 'Failed to retrieve subscription' });
    }
  },
);

/**
 * GET /invoices
 * Returns the invoice history for the authenticated user's practice.
 */
router.get(
  '/invoices',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceScope?.practiceIds?.[0];
      if (!practiceId) {
        res.status(400).json({ error: 'Practice context required' });
        return;
      }

      const invoices = await getInvoices(practiceId);
      res.json(invoices);
    } catch (error) {
      logger.error('Failed to get invoices', { error });
      res.status(500).json({ error: 'Failed to retrieve invoices' });
    }
  },
);

export default router;
