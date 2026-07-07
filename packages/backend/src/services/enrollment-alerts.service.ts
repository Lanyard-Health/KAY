/**
 * Practice-facing enrollment status alerts (notifications phase, chunk 3).
 *
 * When an enrollment becomes submitted / approved / denied, every practice
 * admin gets an in-app bell notification (always) and a branded email
 * (preference-gated, demo-tenant-excluded).
 *
 * Vocabulary rules (EXPERIENCE.md two-vocabulary rule): practice-facing copy
 * uses human status labels only — "Submitted to payer", "Approved", "Denied"
 * — never raw enums, and NEVER the staff shop-talk word "Delayed" (client
 * surfaces say "Running long"). Every denial states what Lanyard is doing.
 */
import crypto from 'crypto';
import type { EnrollmentStatus } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { notificationService, type NotificationPreferences } from './notification.service.js';
import { emailService } from './email.service.js';
import { renderProviderActionEmail } from './email-templates.js';

const ALERT_STATUSES: EnrollmentStatus[] = ['submitted', 'approved', 'denied'];

const STATUS_LABEL: Record<'submitted' | 'approved' | 'denied', string> = {
  submitted: 'Submitted to payer',
  approved: 'Approved',
  denied: 'Denied',
};

const FRONTEND_URL = () => process.env['FRONTEND_URL'] || 'https://portal.lanyardhealth.com';
const API_BASE = () => process.env['API_PUBLIC_URL'] || `${FRONTEND_URL().replace('portal.', 'api.')}`;

// ---------------------------------------------------------------------------
// One-click unsubscribe tokens (HMAC-SHA256, no DB state — flipping the pref
// IS the suppression). Token: base64url(userId|prefKey|expiresAtMs).signature
// ---------------------------------------------------------------------------

export type UnsubscribePrefKey = 'enrollmentStatusChanges' | 'denialAlerts' | 'weeklySummary';

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

let warnedNoSecret = false;
function tokenSecret(): string | null {
  const secret = process.env['UNSUBSCRIBE_TOKEN_SECRET'];
  if (!secret) {
    if (!warnedNoSecret) {
      logger.warn('UNSUBSCRIBE_TOKEN_SECRET not set — alert emails will omit the unsubscribe link');
      warnedNoSecret = true;
    }
    return null;
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function buildUnsubscribeToken(userId: string, prefKey: UnsubscribePrefKey): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const payload = Buffer.from(`${userId}|${prefKey}|${Date.now() + TOKEN_TTL_MS}`).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { userId: string; prefKey: UnsubscribePrefKey } | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const [userId, prefKey, expiresAt] = decoded.split('|');
  if (!userId || !prefKey || !expiresAt) return null;
  if (Number(expiresAt) < Date.now()) return null;
  if (!['enrollmentStatusChanges', 'denialAlerts', 'weeklySummary'].includes(prefKey)) return null;
  return { userId, prefKey: prefKey as UnsubscribePrefKey };
}

export function unsubscribeUrl(userId: string, prefKey: UnsubscribePrefKey): string | null {
  const token = buildUnsubscribeToken(userId, prefKey);
  if (!token) return null;
  return `${API_BASE()}/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Copy builders
// ---------------------------------------------------------------------------

function fmtDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

interface AlertContext {
  subjectName: string; // provider name or practice name for practice-wide enrollments
  payerName: string;
  minDays: number | null;
  maxDays: number | null;
  nextFollowUpDate: Date | null;
}

function inAppCopy(status: 'submitted' | 'approved' | 'denied', ctx: AlertContext): { title: string; message: string } {
  switch (status) {
    case 'submitted':
      return {
        title: `${ctx.payerName} application submitted`,
        message: `${ctx.subjectName}'s ${ctx.payerName} enrollment was submitted to the payer. We'll track it and follow up automatically.`,
      };
    case 'approved':
      return {
        title: `${ctx.payerName} enrollment approved`,
        message: `${ctx.subjectName} is now in network with ${ctx.payerName}.`,
      };
    case 'denied':
      return {
        title: `${ctx.payerName} enrollment needs attention`,
        message: `${ctx.subjectName}'s ${ctx.payerName} enrollment was denied. Lanyard is reviewing the denial and preparing the next step.`,
      };
  }
}

function emailCopy(
  status: 'submitted' | 'approved' | 'denied',
  ctx: AlertContext,
): { subject: string; heading: string; paragraphs: string[]; reassurance?: string } {
  const nextCheckIn = fmtDate(ctx.nextFollowUpDate);
  switch (status) {
    case 'submitted': {
      const windowLine =
        ctx.minDays !== null && ctx.maxDays !== null
          ? `${ctx.payerName} typically responds in ${ctx.minDays}–${ctx.maxDays} days — we'll watch it and follow up automatically.`
          : `We'll watch it and follow up with ${ctx.payerName} automatically.`;
      return {
        subject: `Submitted to payer: ${ctx.subjectName} — ${ctx.payerName}`,
        heading: `${ctx.subjectName}'s application has been submitted`,
        paragraphs: [
          `Good news — ${ctx.subjectName}'s enrollment application was submitted to ${ctx.payerName} today.`,
          windowLine,
        ],
        reassurance: 'No action needed from you. We’ll let you know the moment the payer responds.',
      };
    }
    case 'approved':
      return {
        subject: `Approved: ${ctx.subjectName} is in network with ${ctx.payerName}`,
        heading: `${ctx.subjectName} is approved with ${ctx.payerName}`,
        paragraphs: [
          `${ctx.payerName} has approved ${ctx.subjectName}'s enrollment. ${ctx.subjectName} is now in network and can see ${ctx.payerName} patients.`,
        ],
        reassurance: 'Your dashboard has the full picture of where every enrollment stands.',
      };
    case 'denied':
      return {
        subject: `Needs attention: ${ctx.subjectName}'s ${ctx.payerName} enrollment`,
        heading: `${ctx.payerName} denied ${ctx.subjectName}'s enrollment — we're on it`,
        paragraphs: [
          `${ctx.payerName} has denied ${ctx.subjectName}'s enrollment application.`,
          `Our team is already reviewing the denial reason and preparing the resubmission.${nextCheckIn ? ` Your next check-in is scheduled for ${nextCheckIn}.` : ' We’ll post the next update on your dashboard.'}`,
        ],
        reassurance: 'You don’t need to do anything right now — we’ll handle the payer.',
      };
  }
}

function emailAllowed(status: 'submitted' | 'approved' | 'denied', prefs: NotificationPreferences): boolean {
  return status === 'denied' ? prefs.denialAlerts : prefs.enrollmentStatusChanges;
}

// ---------------------------------------------------------------------------
// Main entry — fire-and-forget from status-change call sites; never throws.
// ---------------------------------------------------------------------------

export async function notifyEnrollmentStatusChange(params: {
  enrollmentId: string;
  oldStatus: EnrollmentStatus;
  newStatus: EnrollmentStatus;
  actorUserId: string | null;
}): Promise<void> {
  try {
    const { enrollmentId, oldStatus, newStatus, actorUserId } = params;
    if (oldStatus === newStatus) return;
    if (!ALERT_STATUSES.includes(newStatus)) return;
    const status = newStatus as 'submitted' | 'approved' | 'denied';

    // Atomic claim: mark this status notified BEFORE sending so concurrent or
    // replayed callers (service, workflow auto-advance, webhook) can't
    // double-send. Count 0 = already announced (or enrollment gone) — skip.
    // If a send fails after claiming we don't retry; suppressing duplicates
    // matters more than best-effort redelivery here.
    const claim = await prisma.enrollment.updateMany({
      where: { id: enrollmentId, NOT: { notifiedStatuses: { has: newStatus } } },
      data: { notifiedStatuses: { push: newStatus } },
    });
    if (claim.count === 0) {
      logger.debug(`Enrollment alert skipped (already sent): enrollment ${enrollmentId}, status ${newStatus}`);
      return;
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        id: true,
        practiceId: true,
        nextFollowUpDate: true,
        payer: { select: { name: true } },
        provider: {
          select: {
            firstName: true,
            lastName: true,
            practiceId: true,
            practice: { select: { id: true, name: true, isDemo: true, deletedAt: true } },
          },
        },
        practice: { select: { id: true, name: true, isDemo: true, deletedAt: true } },
        createdBy: { select: { email: true } },
        payerTrack: {
          select: {
            timelines: { where: { processType: 'Initial' }, select: { minDays: true, maxDays: true }, take: 1 },
          },
        },
      },
    });
    if (!enrollment) return;

    const practice = enrollment.practice ?? enrollment.provider?.practice ?? null;
    if (!practice) return; // no tenant to notify

    const ctx: AlertContext = {
      subjectName: enrollment.provider
        ? `${enrollment.provider.firstName} ${enrollment.provider.lastName}`
        : practice.name,
      payerName: enrollment.payer.name,
      minDays: enrollment.payerTrack?.timelines[0]?.minDays ?? null,
      maxDays: enrollment.payerTrack?.timelines[0]?.maxDays ?? null,
      nextFollowUpDate: enrollment.nextFollowUpDate,
    };

    const recipients = (await notificationService.getPracticeAdminRecipients(practice.id)).filter(
      (r) => r.id !== actorUserId,
    );
    if (recipients.length === 0) return;

    // In-app: always, for every recipient (demo tenants included so the bell
    // works in demos).
    const inApp = inAppCopy(status, ctx);
    for (const r of recipients) {
      await notificationService
        .createNotification({
          userId: r.id,
          type: 'enrollment_status_change',
          title: inApp.title,
          message: inApp.message,
          actionUrl: `/enrollments/${enrollmentId}`,
          metadata: { enrollmentId, from: oldStatus, to: newStatus, practiceId: practice.id },
        })
        .catch((err) =>
          logger.error(`Enrollment alert in-app create failed (enrollment ${enrollmentId}, user ${r.id}):`, err),
        );
    }

    // Email: preference-gated, demo/dev tenants excluded (mirrors the outcome
    // recorder's exclusion rules).
    const creatorEmail = enrollment.createdBy?.email?.toLowerCase() ?? '';
    const emailExcluded = practice.isDemo || practice.deletedAt !== null || creatorEmail.endsWith('@dev.local');
    if (emailExcluded || !emailService.isConfigured()) return;

    const prefKey: UnsubscribePrefKey = status === 'denied' ? 'denialAlerts' : 'enrollmentStatusChanges';
    const copy = emailCopy(status, ctx);
    for (const r of recipients) {
      if (!emailAllowed(status, r.preferences)) continue;
      const footerLinks: Array<{ label: string; url: string }> = [
        { label: 'Notification settings', url: `${FRONTEND_URL()}/settings` },
      ];
      const unsub = unsubscribeUrl(r.id, prefKey);
      if (unsub) footerLinks.push({ label: 'Stop these emails', url: unsub });

      const html = renderProviderActionEmail({
        previewText: copy.paragraphs[0] ?? copy.subject,
        heading: copy.heading,
        firstName: r.firstName,
        paragraphs: copy.paragraphs,
        cta: { label: 'View enrollment', url: `${FRONTEND_URL()}/enrollments/${enrollmentId}` },
        supportSubject: `Question about ${ctx.subjectName}'s ${ctx.payerName} enrollment`,
        ...(copy.reassurance ? { reassurance: copy.reassurance } : {}),
        footerLinks,
      });

      await emailService
        .sendEmail({ to: r.email, subject: copy.subject, html, notificationType: 'enrollment_status' })
        .catch((err) =>
          logger.error(`Enrollment alert email failed (enrollment ${enrollmentId}, user ${r.id}):`, err),
        );
    }
  } catch (err) {
    // Alerting must never break a status update.
    logger.error(`notifyEnrollmentStatusChange failed (enrollment ${params.enrollmentId}):`, err);
  }
}
