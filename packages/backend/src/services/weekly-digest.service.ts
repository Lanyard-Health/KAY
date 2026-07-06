/**
 * Weekly digest email (notifications phase, chunk 4) — the practice dashboard
 * in email form, sent Monday mornings to practice admins who opted in
 * (weeklySummary preference, OFF by default).
 *
 * Client vocabulary only: human status labels and "Running long" — never raw
 * enums, never the staff word "Delayed". Attention rows always carry the
 * we're-on-it line (what Lanyard is doing + next check-in when known).
 */
import type { EnrollmentStatus } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { emailService } from './email.service.js';
import { notificationService } from './notification.service.js';
import {
  assemblePracticeDashboard,
  type EnrollmentRow,
  type PracticeDashboardPayload,
} from './practice-dashboard.service.js';
import { renderDigestEmail, type DigestSection } from './email-templates.js';
import { unsubscribeUrl } from './enrollment-alerts.service.js';

const FRONTEND_URL = () => process.env['FRONTEND_URL'] || 'https://portal.lanyardhealth.com';

// Client-facing labels for every status a change row can land on.
const STATUS_LABEL: Record<EnrollmentStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted to payer',
  pending_review: 'Payer reviewing',
  approved: 'Approved',
  denied: 'Denied',
  terminated: 'No longer active',
};

export interface StatusChange {
  subjectName: string; // provider or practice name
  payerName: string;
  to: EnrollmentStatus;
}

export interface DigestContent {
  subject: string;
  previewText: string;
  heading: string;
  intro: string;
  sections: DigestSection[];
  summaryLine: string;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Pure content builder. Returns null when there is nothing worth saying
 * (no changes, nothing in flight, nothing needing attention) — the practice
 * is skipped rather than sent an empty email.
 */
export function buildDigestContent(
  payload: PracticeDashboardPayload,
  changes: StatusChange[],
  practiceName: string,
): DigestContent | null {
  if (changes.length === 0 && payload.inFlight.length === 0 && payload.attention.length === 0) {
    return null;
  }

  const sections: DigestSection[] = [];

  sections.push({
    heading: 'Last week',
    rows: changes.map((c) => ({
      title: `${c.subjectName} — ${c.payerName}`,
      detail: STATUS_LABEL[c.to],
    })),
  });

  sections.push({
    heading: 'In flight',
    rows: payload.inFlight.map((i) => ({
      title: `${i.providerName} — ${i.payerName}`,
      detail:
        i.minDays !== null && i.maxDays !== null
          ? `${STATUS_LABEL[i.status]} — day ${i.dayCount} of a typical ${i.minDays}–${i.maxDays} day window`
          : `${STATUS_LABEL[i.status]} — day ${i.dayCount} (no typical timeline on file)`,
    })),
  });

  // Attention rows carry the mandated we're-on-it context.
  sections.push({
    heading: 'Needs attention',
    rows: payload.attention.map((a) => {
      const followedUp = fmtDate(a.lastFollowUpDate);
      const nextCheckIn = fmtDate(a.nextFollowUpDate);
      const plan =
        a.kind === 'denied'
          ? "We're reviewing the denial and preparing the resubmission."
          : followedUp
            ? `Our team last followed up on ${followedUp}.`
            : 'Our team is monitoring this application.';
      return {
        title: `${a.providerName} — ${a.payerName}`,
        detail: a.kind === 'denied' ? 'Denied' : 'Running long',
        subDetail: `${plan}${nextCheckIn ? ` Next check-in: ${nextCheckIn}.` : " We'll post the next update on your dashboard."}`,
      };
    }),
  });

  const { approved, submitted, runningLong } = payload.tiles;
  const summaryLine = `Overall: ${approved} approved · ${submitted} with payers · ${runningLong} running long.`;

  const approvedCount = changes.filter((c) => c.to === 'approved').length;
  const subject =
    approvedCount > 0 || payload.inFlight.length > 0
      ? `${approvedCount > 0 ? `${approvedCount} approval${approvedCount === 1 ? '' : 's'}, ` : ''}${payload.inFlight.length} in flight — ${practiceName}`
      : `Your week in credentialing — ${practiceName}`;

  return {
    subject,
    previewText: summaryLine,
    heading: 'Your week in credentialing',
    intro: `Here's where ${practiceName}'s enrollments stand this Monday morning.`,
    sections,
    summaryLine,
  };
}

function lastMonday(now: Date): Date {
  const day = now.getUTCDay();
  const diff = (day === 0 ? 6 : day - 1) + 7; // Monday of the PREVIOUS week
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
}

/** Fetch enrollment rows for one practice — same select shape as slice 1. */
async function fetchPracticeEnrollmentRows(practiceId: string): Promise<EnrollmentRow[]> {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      OR: [
        { providerId: { not: null }, provider: { practiceId, deletedAt: null } },
        { providerId: null, practiceId },
      ],
    },
    select: {
      id: true,
      status: true,
      applicationDate: true,
      effectiveDate: true,
      lastFollowUpDate: true,
      nextFollowUpDate: true,
      updatedAt: true,
      payer: { select: { id: true, name: true } },
      provider: { select: { id: true, firstName: true, lastName: true, providerType: true, degree: true } },
      payerTrack: {
        select: {
          timelines: { where: { processType: 'Initial' }, select: { minDays: true, maxDays: true }, take: 1 },
        },
      },
    },
  });

  return enrollments.map((e) => ({
    id: e.id,
    status: e.status,
    applicationDate: e.applicationDate,
    effectiveDate: e.effectiveDate,
    lastFollowUpDate: e.lastFollowUpDate,
    nextFollowUpDate: e.nextFollowUpDate,
    updatedAt: e.updatedAt,
    payer: e.payer,
    provider: e.provider
      ? { ...e.provider, providerType: String(e.provider.providerType), degree: e.provider.degree ? String(e.provider.degree) : null }
      : null,
    timeline: e.payerTrack?.timelines[0] ?? null,
  }));
}

/** Status changes for a practice's enrollments since last Monday, via AuditLog. */
async function fetchStatusChanges(enrollmentRows: EnrollmentRow[], since: Date): Promise<StatusChange[]> {
  const byId = new Map(enrollmentRows.map((r) => [r.id, r]));
  if (byId.size === 0) return [];

  const logs = await prisma.auditLog.findMany({
    where: {
      resourceType: 'enrollment',
      action: 'update',
      resourceId: { in: [...byId.keys()] },
      timestamp: { gte: since },
      changes: { path: ['field'], equals: 'status' },
    },
    orderBy: { timestamp: 'asc' },
    select: { resourceId: true, changes: true },
  });

  return logs.flatMap((log) => {
    const row = log.resourceId ? byId.get(log.resourceId) : undefined;
    const to = (log.changes as { to?: string } | null)?.to as EnrollmentStatus | undefined;
    if (!row || !to || !(to in STATUS_LABEL)) return [];
    return [{
      subjectName: row.provider ? `${row.provider.firstName} ${row.provider.lastName}` : 'Practice-wide',
      payerName: row.payer.name,
      to,
    }];
  });
}

export interface DigestRunResult {
  practicesScanned: number;
  skippedEmpty: number;
  skippedNoRecipients: number;
  emailsSent: number;
  failed: number;
}

export async function runWeeklyDigest(now: Date = new Date()): Promise<DigestRunResult> {
  const result: DigestRunResult = {
    practicesScanned: 0, skippedEmpty: 0, skippedNoRecipients: 0, emailsSent: 0, failed: 0,
  };

  const practices = await prisma.practice.findMany({
    where: {
      isDemo: false,
      deletedAt: null,
      OR: [
        { enrollments: { some: {} } },
        { providers: { some: { enrollments: { some: {} } } } },
      ],
    },
    select: { id: true, name: true },
  });

  const since = lastMonday(now);

  for (const practice of practices) {
    result.practicesScanned++;
    try {
      const rows = await fetchPracticeEnrollmentRows(practice.id);
      const payload = assemblePracticeDashboard(rows, now);
      const changes = await fetchStatusChanges(rows, since);
      const content = buildDigestContent(payload, changes, practice.name);
      if (!content) {
        result.skippedEmpty++;
        continue;
      }

      const recipients = (await notificationService.getPracticeAdminRecipients(practice.id))
        .filter((r) => r.preferences.weeklySummary && !r.email.toLowerCase().endsWith('@dev.local'));
      if (recipients.length === 0) {
        result.skippedNoRecipients++;
        continue;
      }

      for (const r of recipients) {
        const footerLinks: Array<{ label: string; url: string }> = [
          { label: 'Notification settings', url: `${FRONTEND_URL()}/settings` },
        ];
        const unsub = unsubscribeUrl(r.id, 'weeklySummary');
        if (unsub) footerLinks.push({ label: 'Stop the weekly summary', url: unsub });

        const html = renderDigestEmail({
          previewText: content.previewText,
          heading: content.heading,
          firstName: r.firstName,
          intro: content.intro,
          sections: content.sections,
          summaryLine: content.summaryLine,
          cta: { label: 'Open your dashboard', url: `${FRONTEND_URL()}/dashboard` },
          footerLinks,
        });

        const sent = await emailService
          .sendEmail({ to: r.email, subject: content.subject, html, notificationType: 'enrollment_status' })
          .catch((err) => {
            logger.error(`Weekly digest send failed (practice ${practice.id}, user ${r.id}):`, err);
            return { success: false as const };
          });
        if (sent.success) result.emailsSent++;
        else result.failed++;
      }
    } catch (err) {
      // One practice failing must not halt the loop.
      result.failed++;
      logger.error(`Weekly digest failed for practice ${practice.id}:`, err);
    }
  }

  logger.info(
    `[WeeklyDigest] scanned=${result.practicesScanned} skippedEmpty=${result.skippedEmpty} skippedNoRecipients=${result.skippedNoRecipients} sent=${result.emailsSent} failed=${result.failed}`,
  );
  return result;
}
