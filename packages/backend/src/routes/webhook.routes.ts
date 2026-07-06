/**
 * Generic webhook receiver for enrollment status updates.
 *
 * POST /api/v1/webhooks/enrollment-status
 *
 * Designed as the integration backbone for any external source — email
 * parser, portal scraper, Zapier flow, third-party tool — to push status
 * changes into Lanyard. Authenticates via HMAC-SHA256 signature over the
 * raw request body plus a 5-minute timestamp guard.
 *
 * Two lookup modes:
 *  - Mode A: by `enrollmentId` (preferred when source knows it)
 *  - Mode B: by `providerNpi` + `payerExternalId` (matches Payer.payerId)
 *
 * Side effects on accepted requests:
 *  - Updates Enrollment.status (+ providerNumber/effectiveDate when given)
 *  - On `denied` status, calls triggerDenialTriage() to run the existing
 *    AI denial-analysis pipeline and create a DenialTriage row
 *  - Logs an agent_event (agent='webhook') for audit
 *  - Emits an `enrollment:status_updated` WebSocket event so any open
 *    workflow detail or enrollment page refreshes live
 *
 * Mounted BEFORE the global express.json() middleware in index.ts so the
 * raw body is available for signature verification.
 */

import express, { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import {
  getEnrollmentWebhookSecret,
  verifyEnrollmentWebhookSignature,
  timestampWithinTolerance,
} from '../services/webhookAuth.service.js';
import { triggerDenialTriage } from '../services/denial-triage.service.js';
import { recordEnrollmentOutcome } from '../services/enrollment-outcome.service.js';
import { notifyEnrollmentStatusChange } from '../services/enrollment-alerts.service.js';
import type { EnrollmentStatus } from '@prisma/client';
import { logAgentEvent } from '../agents/event-logger.js';
import { emitWorkflowEvent } from '../agents/websocket.js';

const router = Router();

// ──────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────

const STATUS_VALUES = [
  'submitted',
  'pending_review',
  'approved',
  'denied',
  'additional_info_needed',
] as const;

// Accept any string Date.parse() can interpret. Real-world payer emails
// carry dates in mixed formats (YYYY-MM-DD, full ISO 8601 with offset,
// sometimes human-readable). Strict `.datetime({ offset })` rejected
// date-only strings, which is too restrictive for an external integration
// contract.
const dateString = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Must be a parseable date or datetime string',
  });

const baseStatusFields = {
  status: z.enum(STATUS_VALUES),
  denialReason: z.string().min(1).max(2000).optional(),
  denialDate: dateString.optional(),
  effectiveDate: dateString.optional(),
  confirmationId: z.string().min(1).max(100).optional(),
  source: z.string().min(1).max(200).default('unknown'),
};

const webhookByIdSchema = z.object({
  enrollmentId: z.string().uuid(),
  ...baseStatusFields,
});

const webhookByNpiSchema = z.object({
  providerNpi: z.string().regex(/^\d{10}$/, 'NPI must be 10 digits'),
  payerExternalId: z.string().min(1).max(100),
  ...baseStatusFields,
});

// ──────────────────────────────────────────────
// Status mapping
// ──────────────────────────────────────────────

// Webhook accepts `additional_info_needed` (a real business state) but the
// EnrollmentStatus enum models it as `pending_review` — same effect on the
// monitor agent, which treats both as non-terminal but flagged for follow-up.
function mapToEnrollmentStatus(
  s: typeof STATUS_VALUES[number],
): 'submitted' | 'pending_review' | 'approved' | 'denied' {
  if (s === 'additional_info_needed') return 'pending_review';
  return s;
}

// ──────────────────────────────────────────────
// Route
// ──────────────────────────────────────────────

router.post(
  '/enrollment-status',
  // Capture raw body so the HMAC verifier sees the exact bytes the caller
  // signed. This middleware ONLY applies to this route — the global JSON
  // parser (express.json()) is mounted after the webhook router in index.ts
  // so the rest of the API still parses JSON normally.
  express.raw({ type: 'application/json', limit: '64kb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 0. Webhook secret must be configured. If not, hard-fail rather than
      //    accept unsigned data.
      if (!getEnrollmentWebhookSecret()) {
        return res.status(503).json({
          success: false,
          error: { message: 'Webhook receiver not configured (ENROLLMENT_WEBHOOK_SECRET unset).' },
        });
      }

      // 1. Read raw body. express.raw() leaves it as a Buffer.
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      if (!rawBody) {
        return res.status(400).json({ success: false, error: { message: 'Empty request body.' } });
      }

      // 2. Verify timestamp + signature.
      const sigHeader = req.headers['x-webhook-signature'];
      const tsHeader = req.headers['x-webhook-timestamp'];
      const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      const ts = Array.isArray(tsHeader) ? tsHeader[0] : tsHeader;

      if (!sig || !ts) {
        logger.warn('Enrollment webhook rejected: missing signature or timestamp header');
        return res.status(401).json({ success: false, error: { message: 'Missing X-Webhook-Signature or X-Webhook-Timestamp header.' } });
      }

      if (!timestampWithinTolerance(ts)) {
        logger.warn('Enrollment webhook rejected: timestamp outside tolerance', { ts });
        return res.status(401).json({ success: false, error: { message: 'Timestamp outside tolerance window (5 minutes).' } });
      }

      if (!verifyEnrollmentWebhookSignature(rawBody, sig)) {
        logger.warn('Enrollment webhook rejected: invalid signature');
        return res.status(401).json({ success: false, error: { message: 'Invalid signature.' } });
      }

      // 3. Parse + validate body.
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ success: false, error: { message: 'Body is not valid JSON.' } });
      }

      // Try Mode A first (enrollmentId), fall back to Mode B (npi + payer).
      const byId = webhookByIdSchema.safeParse(parsedJson);
      const byNpi = byId.success ? null : webhookByNpiSchema.safeParse(parsedJson);

      if (!byId.success && !(byNpi && byNpi.success)) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Body must include either {enrollmentId, status, ...} or {providerNpi, payerExternalId, status, ...}',
            details: byId.error.flatten(),
          },
        });
      }

      const data = byId.success ? byId.data : (byNpi as z.SafeParseSuccess<z.infer<typeof webhookByNpiSchema>>).data;

      // 4. Resolve enrollmentId (pre-reading status so downstream side effects
      //    know the old value — replays with an unchanged status become no-ops).
      let enrollmentId: string;
      let oldStatus: string | null = null;
      if ('enrollmentId' in data) {
        enrollmentId = data.enrollmentId;
        const exists = await prisma.enrollment.findUnique({
          where: { id: enrollmentId },
          select: { id: true, status: true },
        });
        if (!exists) {
          return res.status(400).json({ success: false, error: { message: 'Enrollment not found.' } });
        }
        oldStatus = exists.status;
      } else {
        // Mode B: lookup by NPI + payer.payerId.
        const matches = await prisma.enrollment.findMany({
          where: {
            provider: { npi: data.providerNpi },
            payer: { payerId: data.payerExternalId },
          },
          select: { id: true, status: true },
          take: 2,
        });
        if (matches.length === 0) {
          return res.status(400).json({
            success: false,
            error: { message: 'No enrollment matches the provided NPI + payerExternalId combination.' },
          });
        }
        if (matches.length > 1) {
          return res.status(400).json({
            success: false,
            error: { message: 'Ambiguous match — multiple enrollments share this NPI + payer pair. Use enrollmentId instead.' },
          });
        }
        enrollmentId = matches[0]!.id;
        oldStatus = matches[0]!.status;
      }

      // 5. Build the update payload.
      const dbStatus = mapToEnrollmentStatus(data.status);
      const updatePayload: Record<string, unknown> = { status: dbStatus };
      if (data.confirmationId) updatePayload['providerNumber'] = data.confirmationId;
      if (data.effectiveDate) updatePayload['effectiveDate'] = new Date(data.effectiveDate);

      const updated = await prisma.enrollment.update({
        where: { id: enrollmentId },
        data: updatePayload,
        select: { id: true, status: true, providerId: true, payerId: true },
      });

      // Outcome recorder (the moat) — fire-and-forget, idempotent, demo-excluded.
      void recordEnrollmentOutcome({ enrollmentId, status: dbStatus, transitionAt: new Date() });

      // Practice-facing alerts + audit trail — each independently fire-and-forget
      // so one failure never skips the others. System-initiated: no actor.
      if (oldStatus !== dbStatus) {
        void notifyEnrollmentStatusChange({
          enrollmentId,
          oldStatus: oldStatus as EnrollmentStatus,
          newStatus: dbStatus,
          actorUserId: null,
        });
        prisma.auditLog.create({
          data: {
            userId: null,
            action: 'update',
            resourceType: 'enrollment',
            resourceId: enrollmentId,
            changes: { field: 'status', from: oldStatus, to: dbStatus, source: 'webhook' },
          },
        }).catch((err) => logger.error('Webhook enrollment audit log failed:', err));
      }

      // 6. Side effects.
      let triageCreated = false;
      if (data.status === 'denied') {
        try {
          const denialResult = await triggerDenialTriage(prisma, {
            enrollmentId,
            denialReason: data.denialReason ?? 'Denied via webhook (no reason provided)',
            ...(data.denialDate ? { denialDate: new Date(data.denialDate) } : {}),
          });
          triageCreated = denialResult.triageCreated;
        } catch (err) {
          // Triage failure should NOT fail the webhook — the enrollment is
          // already updated. Log and move on; the user can manually re-run
          // triage from the denial UI.
          logger.error('triggerDenialTriage failed inside webhook handler', {
            enrollmentId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 7. Log to agent_events for audit (visible on workflow detail page if
      //    a workflow was tracking this enrollment).
      const recentWorkflow = await prisma.agentWorkflow.findFirst({
        where: { enrollmentId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (recentWorkflow) {
        await logAgentEvent({
          workflowId: recentWorkflow.id,
          agent: 'webhook',
          action: 'enrollment_status_received',
          data: {
            source: data.source,
            status: data.status,
            ...(data.denialReason ? { denialReason: data.denialReason } : {}),
            ...(data.confirmationId ? { confirmationId: data.confirmationId } : {}),
            triageCreated,
          },
        });
        emitWorkflowEvent(recentWorkflow.id, 'enrollment:status_updated', {
          enrollmentId,
          status: dbStatus,
          source: data.source,
        });
      }

      logger.info('Enrollment webhook processed', {
        enrollmentId,
        status: dbStatus,
        source: data.source,
        triageCreated,
      });

      return res.json({
        success: true,
        enrollmentId: updated.id,
        newStatus: updated.status,
        triageCreated,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
