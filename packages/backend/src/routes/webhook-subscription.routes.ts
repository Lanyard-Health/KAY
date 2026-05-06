/**
 * Outbound webhook subscription API (Phase 0.A PR 4, sub-chunk 4A).
 *
 * POST   /api/v1/webhook-subscriptions      — create subscription, returns secret once
 * GET    /api/v1/webhook-subscriptions      — list practice-scoped subscriptions
 * DELETE /api/v1/webhook-subscriptions/:id  — soft-delete
 *
 * Auth: authenticate + authorize(admin | credentialing_staff | practice_admin) +
 * practice scope check via req.practiceScope.
 *
 * Security:
 *   - HTTPS-only in production (HTTP allowed in dev/test for local mock servers).
 *   - SSRF guard at create time — resolves hostname, rejects private/loopback/
 *     link-local/unique-local IPs (delivery-time guard lives in 4B's worker).
 *   - Per-subscription HMAC secret, generated server-side via crypto.randomBytes,
 *     encrypted via encryptSafe before storage, returned **exactly once** in the
 *     create response. Never returned by GET. Lost-secret recovery is a re-create.
 *
 * Distinct path from /api/v1/webhooks (the existing inbound enrollment-status
 * receiver) — that route accepts payloads from external systems; this route
 * registers external endpoints we deliver TO.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { encryptSafe } from '../utils/crypto.js';
import { checkSsrfSafety } from '../utils/ssrf-guard.js';
import { setAuditContext } from '../middleware/audit.middleware.js';

// Registered event types. credential.expired is registered now; emitter
// deferred to Maintenance Phase 1 per Phase 0.A Flag #7.
export const REGISTERED_EVENT_TYPES = [
  'agent_event.created',
  'enrollment.status_changed',
  'credential.expired',
] as const;

const SECRET_BYTES = 32; // 256 bits, hex-encoded → 64-char string

const router = Router();

const createSchema = z.object({
  practiceId: z.string().uuid(),
  url: z.string().url().max(2048),
  eventTypes: z
    .array(z.enum(REGISTERED_EVENT_TYPES))
    .min(1, 'At least one event type required')
    .max(REGISTERED_EVENT_TYPES.length),
  description: z.string().max(500).optional(),
});

function isPracticeAccessible(req: Request, practiceId: string): boolean {
  if (req.practiceScope?.isSuperAdmin) return true;
  return !!req.practiceScope?.practiceIds?.includes(practiceId);
}

function publicShape(sub: {
  id: string;
  practiceId: string;
  url: string;
  eventTypes: string[];
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  lastDeliveryAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
}) {
  return {
    id: sub.id,
    practiceId: sub.practiceId,
    url: sub.url,
    eventTypes: sub.eventTypes,
    description: sub.description,
    active: sub.active,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    deletedAt: sub.deletedAt,
    lastDeliveryAt: sub.lastDeliveryAt,
    lastFailureAt: sub.lastFailureAt,
    consecutiveFailures: sub.consecutiveFailures,
  };
}

// ──────────────────────────────────────────────
// POST / — create subscription
// ──────────────────────────────────────────────
router.post(
  '/',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid request body', details: parsed.error.flatten() },
        });
      }
      const input = parsed.data;

      if (!isPracticeAccessible(req, input.practiceId)) {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions for this practice' },
        });
      }

      // HTTPS required in production. Local dev / test allow http for mock
      // servers — guarded by NODE_ENV so the prod gate cannot be bypassed
      // by sending a header.
      const parsedUrl = new URL(input.url);
      if (process.env['NODE_ENV'] === 'production' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({
          success: false,
          error: { message: 'Webhook URL must use HTTPS in production' },
        });
      }
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return res.status(400).json({
          success: false,
          error: { message: 'Webhook URL must use http or https' },
        });
      }

      // SSRF guard at create time (delivery-time re-check defends against DNS
      // rebinding — added in 4B). Resolves the URL's hostname and rejects
      // private/loopback/link-local/unique-local addresses.
      const ssrf = await checkSsrfSafety(input.url);
      if (!ssrf.ok) {
        logger.warn('Webhook subscription create rejected by SSRF guard', {
          url: input.url,
          reason: ssrf.reason,
        });
        return res.status(400).json({
          success: false,
          error: { message: `URL rejected: ${ssrf.reason}` },
        });
      }

      // Generate the HMAC secret server-side. Returned exactly once below;
      // stored encrypted via encryptSafe. Lost-secret recovery is re-create.
      const plaintextSecret = randomBytes(SECRET_BYTES).toString('hex');
      const secretEncrypted = encryptSafe(plaintextSecret);

      setAuditContext(req, { resourceType: 'webhook_subscription', action: 'create' });

      const created = await prisma.webhookSubscription.create({
        data: {
          practiceId: input.practiceId,
          url: input.url,
          eventTypes: input.eventTypes,
          secretEncrypted,
          description: input.description ?? null,
          active: true,
          createdById: req.user?.id ?? null,
        },
      });

      logger.info('Webhook subscription created', {
        id: created.id,
        practiceId: created.practiceId,
        url: created.url,
        eventTypes: created.eventTypes,
        createdBy: req.user?.id,
      });

      return res.status(201).json({
        success: true,
        data: {
          ...publicShape(created),
          secret: plaintextSecret,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ──────────────────────────────────────────────
// GET / — list subscriptions in practice scope
// ──────────────────────────────────────────────
router.get(
  '/',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceFilter = req.practiceScope?.isSuperAdmin
        ? {}
        : { practiceId: { in: req.practiceScope?.practiceIds ?? [] } };

      const subs = await prisma.webhookSubscription.findMany({
        where: {
          deletedAt: null,
          ...practiceFilter,
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({
        success: true,
        data: subs.map(publicShape),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ──────────────────────────────────────────────
// DELETE /:id — soft-delete
// ──────────────────────────────────────────────
router.delete(
  '/:id',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (!id) {
        return res.status(400).json({
          success: false,
          error: { message: 'Missing subscription id' },
        });
      }

      const existing = await prisma.webhookSubscription.findUnique({
        where: { id },
        select: { id: true, practiceId: true, deletedAt: true },
      });

      // 404 (not 403) on missing-or-out-of-scope so we don't leak existence
      // of subscriptions belonging to other practices.
      if (!existing || existing.deletedAt) {
        return res.status(404).json({
          success: false,
          error: { message: 'Subscription not found' },
        });
      }
      if (!isPracticeAccessible(req, existing.practiceId)) {
        return res.status(404).json({
          success: false,
          error: { message: 'Subscription not found' },
        });
      }

      setAuditContext(req, {
        resourceType: 'webhook_subscription',
        resourceId: id,
        action: 'delete',
      });

      const updated = await prisma.webhookSubscription.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      });

      logger.info('Webhook subscription soft-deleted', {
        id,
        practiceId: existing.practiceId,
        deletedBy: req.user?.id,
      });

      return res.json({
        success: true,
        data: publicShape(updated),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
