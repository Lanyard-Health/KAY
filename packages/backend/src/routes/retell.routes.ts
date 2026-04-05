/**
 * Retell AI Routes
 *
 * POST /retell/webhook       — Retell callback (signature-verified, no auth)
 * GET  /retell/call-logs/:followUpRunId — Call logs for a follow-up run
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import {
  processWebhook,
  verifyWebhookSignature,
  getCallLogs,
  isRetellEnabled,
} from '../services/retell.service.js';
import type { RetellWebhookPayload } from '../services/retell.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ─── Webhook (no auth — uses signature verification) ────

router.post(
  '/webhook',
  async (req: Request, res: Response, _next: NextFunction) => {
    try {
      if (!isRetellEnabled()) {
        return res.status(503).json({ error: 'Retell AI not configured' });
      }

      // Verify webhook signature — reject if header is missing
      const signature = req.headers['x-retell-signature'] as string;
      if (!signature) {
        logger.warn('Retell webhook rejected: missing x-retell-signature header');
        return res.status(401).json({ error: 'Missing signature' });
      }
      const rawBody = JSON.stringify(req.body);
      if (!verifyWebhookSignature(rawBody, signature)) {
        logger.warn('Retell webhook signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const payload = req.body as RetellWebhookPayload;

      if (!payload.event || !payload.call?.call_id) {
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }

      const result = await processWebhook(prisma, payload);

      if (result.processed) {
        res.json({ success: true });
      } else {
        // Still return 200 so Retell doesn't retry for unhandled events
        res.json({ success: true, skipped: result.error });
      }
    } catch (error) {
      logger.error('Retell webhook processing error:', error);
      // Return 500 so Retell retries
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Call Logs (authenticated) ───────────────────────────

router.get(
  '/call-logs/:followUpRunId',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { followUpRunId } = req.params;
      const logs = await getCallLogs(prisma, followUpRunId!);
      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  }
);

export { router as retellRoutes };
