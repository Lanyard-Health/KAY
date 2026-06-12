/**
 * CAQH re-attestation provider emails (B2, PR 4).
 *
 * Five Kay-approved templates (2026-06-12, rendered + approved one by one):
 *  T1 pre-due "nothing changed"  — diffVerdict 'unchanged'; 21/14/7/1 copy sets
 *  T2 pre-due neutral            — 'no_baseline' / 'changed'; same intervals
 *  T3 expiry +1 day "at risk"    — legal panel (DataSpring cycle + NSA 90-day)
 *  T4 weekly overdue             — +7/+14/+21/+28, hard cap 4
 *  T5 confirmation               — after an observed re-attestation
 *
 * Gates, in order: CAQH_REMINDER_EMAILS_ENABLED env flag (dry-run default:
 * unset → log "would send", mutate nothing), practice toggle, provider email
 * present, email service configured.
 *
 * Delivery semantics: claim-before-send. The sent-key is written to
 * remindersSent BEFORE the send; a send failure stays claimed (at-most-once).
 * A missed email is recoverable (next threshold + admin escalation); a
 * double-send to a provider is not. CTA URL verified live 2026-06-12:
 * https://proview.caqh.org/pr redirects to the official ProView sign-in.
 */

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { Prisma } from '@prisma/client';
import { emailService } from './email.service.js';
import { renderProviderActionEmail } from './email-templates.js';
import { daysUntil, EXPIRED_STATUS, CYCLE_DAYS_DEFAULT } from './caqh-attestation.service.js';

const PROVIEW_URL = 'https://proview.caqh.org/pr';
const SUPPORT_LINE =
  'Questions? Email credentialing@lanyardhealth.com and we will help.';
const OVERDUE_REASSURANCE =
  'Already re-attested? Thank you. It can take a day or two for DataSpring to reflect it, and no further action is needed. Need help? Email credentialing@lanyardhealth.com and we will walk you through it.';

export const PRE_DUE_THRESHOLDS = [21, 14, 7, 1] as const;
export const OVERDUE_THRESHOLDS = [7, 14, 21, 28] as const;
/** How recently a baseline must have been captured to count as "just attested". */
const CONFIRMATION_WINDOW_DAYS = 2;

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(d);
}

export type ReminderKind =
  | { kind: 'preDue'; threshold: number; variant: 'unchanged' | 'neutral' }
  | { kind: 'expired' }
  | { kind: 'overdue'; week: number }
  | { kind: 'confirmation' };

export function sentKeyFor(r: ReminderKind): string {
  switch (r.kind) {
    case 'preDue': return String(r.threshold);
    case 'expired': return 'expired1';
    case 'overdue': return `overdue${r.week}`;
    case 'confirmation': return 'confirmation';
  }
}

interface TrackerLike {
  providerStatus: string | null;
  lastAttestationDate: Date | null;
  nextDueDate: Date | null;
  baselineCapturedAt: Date | null;
  diffVerdict: string;
  remindersSent: unknown;
}

/**
 * Pure cadence selection: at most ONE reminder per provider per run, the most
 * urgent unsent one. Crossed-threshold semantics (≤, never ==) so a missed
 * night or a mid-cycle import never drops a provider — they just get the most
 * urgent reminder not yet sent, and never a burst of stale ones.
 */
export function selectReminder(tracker: TrackerLike, now: Date = new Date()): ReminderKind | null {
  if (!tracker.nextDueDate) return null;
  const sent = (tracker.remindersSent ?? {}) as Record<string, string>;

  // Confirmation: only an OBSERVED transition captures a baseline, so a fresh
  // baselineCapturedAt is the honest "they just attested" signal (a provider's
  // first observation never confirms — their attestation predates us).
  if (
    tracker.baselineCapturedAt
    && daysUntil(tracker.baselineCapturedAt, now) >= -CONFIRMATION_WINDOW_DAYS
    && !sent['confirmation']
  ) {
    return { kind: 'confirmation' };
  }

  const daysToDue = daysUntil(tracker.nextDueDate, now);
  const isExpired = tracker.providerStatus === EXPIRED_STATUS || daysToDue < 0;

  if (!isExpired) {
    const crossed = PRE_DUE_THRESHOLDS.filter((t) => daysToDue <= t);
    const unsent = crossed.filter((t) => !sent[String(t)]);
    if (unsent.length === 0) return null;
    const candidate = Math.min(...unsent);
    // If something at least as urgent was already sent, the stale larger
    // thresholds are skipped, not back-filled.
    const sentThresholds = PRE_DUE_THRESHOLDS.filter((t) => sent[String(t)]);
    if (sentThresholds.length > 0 && Math.min(...sentThresholds) <= candidate) return null;
    return {
      kind: 'preDue',
      threshold: candidate,
      variant: tracker.diffVerdict === 'unchanged' ? 'unchanged' : 'neutral',
    };
  }

  const daysOver = -daysToDue;
  if (daysOver >= 1 && !sent['expired1']) return { kind: 'expired' };

  const overdueSentCount = OVERDUE_THRESHOLDS.filter((d) => sent[`overdue${d}`]).length;
  if (overdueSentCount >= 4) return null;
  const crossedWeeks = OVERDUE_THRESHOLDS.filter((d) => daysOver >= d && !sent[`overdue${d}`]);
  if (crossedWeeks.length === 0) return null;
  return { kind: 'overdue', week: Math.max(...crossedWeeks) };
}

interface EmailContent { subject: string; previewText: string; html: string }

export function buildReminderEmail(
  r: ReminderKind,
  params: { firstName: string; tracker: TrackerLike },
): EmailContent {
  const { firstName, tracker } = params;
  const dueDate = tracker.nextDueDate ? formatDate(tracker.nextDueDate) : '';

  if (r.kind === 'preDue') {
    const t = r.threshold;
    const dueWord = t === 1 ? 'tomorrow' : t === 7 ? 'in one week' : `in ${t} days`;
    const heading = `Your DataSpring attestation is due ${dueWord}`;
    if (r.variant === 'unchanged') {
      const subjects: Record<number, string> = {
        21: "Your DataSpring attestation is due in 3 weeks, and nothing's changed",
        14: '14 days left: a 30-second re-attestation keeps you in-network',
        7: 'One week left to re-attest with DataSpring',
        1: 'Due tomorrow: your DataSpring attestation',
      };
      const paragraphs = [
        `Your DataSpring (formerly CAQH) profile is due for re-attestation on ${dueDate}.`,
        'Good news: we checked your profile, and nothing has changed since you last attested. Re-attesting should take about 30 seconds: sign in, confirm, done.',
      ];
      if (t === 1) paragraphs.push('This is the last reminder before your attestation is due.');
      return {
        subject: subjects[t]!,
        previewText: 'A 30-second re-attestation keeps you active with your payers.',
        html: renderProviderActionEmail({
          previewText: 'A 30-second re-attestation keeps you active with your payers.',
          heading, firstName, paragraphs,
          cta: { label: 'Re-attest on DataSpring', url: PROVIEW_URL },
          reassurance: `Staying current keeps payers seeing you as active and in-network. ${SUPPORT_LINE}`,
        }),
      };
    }
    const subjects: Record<number, string> = {
      21: 'Your DataSpring attestation is due in 3 weeks',
      14: '14 days left to re-attest with DataSpring',
      7: 'One week left to re-attest with DataSpring',
      1: 'Due tomorrow: your DataSpring attestation',
    };
    const paragraphs = [
      `Your DataSpring (formerly CAQH) profile is due for re-attestation on ${dueDate}.`,
      'Sign in, review your profile, and confirm everything is up to date. Most providers finish in 5 to 10 minutes.',
    ];
    if (t === 1) paragraphs.push('This is the last reminder before your attestation is due.');
    return {
      subject: subjects[t]!,
      previewText: 'Re-attesting on time keeps you active with your payers.',
      html: renderProviderActionEmail({
        previewText: 'Re-attesting on time keeps you active with your payers.',
        heading, firstName, paragraphs,
        cta: { label: 'Review and re-attest on DataSpring', url: PROVIEW_URL },
        reassurance: `Staying current keeps payers seeing you as active and in-network. ${SUPPORT_LINE}`,
      }),
    };
  }

  if (r.kind === 'expired') {
    // Cycle length derived from the tracked dates themselves (120, or 180 for
    // IL) — no extra state needed.
    const cycleDays = tracker.lastAttestationDate && tracker.nextDueDate
      ? Math.round((tracker.nextDueDate.getTime() - tracker.lastAttestationDate.getTime()) / 86_400_000)
      : CYCLE_DAYS_DEFAULT;
    return {
      subject: 'Action needed: your DataSpring attestation has lapsed',
      previewText: 'Re-attest now to avoid being removed from payer directories.',
      html: renderProviderActionEmail({
        previewText: 'Re-attest now to avoid being removed from payer directories.',
        heading: 'Your DataSpring attestation has lapsed',
        firstName,
        paragraphs: [
          `Your DataSpring (formerly CAQH) attestation expired on ${dueDate}. Until you re-attest, your profile is no longer current, and that puts your network participation at risk.`,
        ],
        stepsTitle: 'Why this is time-sensitive',
        steps: [
          `DataSpring requires re-attestation every ${cycleDays} days to keep your profile active.`,
          'Separately, the federal No Surprises Act requires health plans to verify provider directory information every 90 days. Providers whose information is not confirmed can be removed from plan directories until it is.',
          'Being dropped from a directory means patients and referring providers cannot find you in-network, which can directly affect your revenue.',
        ],
        cta: { label: 'Re-attest now on DataSpring', url: PROVIEW_URL },
        reassurance: OVERDUE_REASSURANCE,
      }),
    };
  }

  if (r.kind === 'overdue') {
    const weeks = Math.round(r.week / 7);
    const weeksWord = weeks === 1 ? 'one week' : `${['', 'one', 'two', 'three', 'four'][weeks]} weeks`;
    return {
      subject: 'Still lapsed: your DataSpring attestation',
      previewText: `Your profile has been expired for ${weeksWord}. Re-attesting takes a few minutes.`,
      html: renderProviderActionEmail({
        previewText: `Your profile has been expired for ${weeksWord}. Re-attesting takes a few minutes.`,
        heading: 'Your DataSpring attestation is still lapsed',
        firstName,
        paragraphs: [
          `Your DataSpring (formerly CAQH) attestation expired on ${dueDate}, ${weeksWord} ago. Your profile stays out of date with payers until you re-attest.`,
          'The longer a profile stays lapsed, the higher the chance payers remove you from their directories.',
        ],
        cta: { label: 'Re-attest now on DataSpring', url: PROVIEW_URL },
        reassurance: OVERDUE_REASSURANCE,
      }),
    };
  }

  // confirmation
  return {
    subject: "You're all set: DataSpring attestation confirmed",
    previewText: 'Your re-attestation went through. Nothing more to do.',
    html: renderProviderActionEmail({
      previewText: 'Your re-attestation went through. Nothing more to do.',
      heading: 'Your attestation went through',
      firstName,
      paragraphs: [
        'We can see your DataSpring (formerly CAQH) re-attestation was completed. Thank you for taking care of it.',
        `You are set until ${dueDate}. We will keep an eye on your profile and remind you ahead of the next deadline.`,
      ],
      reassurance: 'No action needed. Questions about your credentialing? Email credentialing@lanyardhealth.com.',
    }),
  };
}

export function emailsEnabled(): boolean {
  return process.env['CAQH_REMINDER_EMAILS_ENABLED'] === 'true';
}

export interface ProviderReminderInput {
  providerProfileId: string;
  firstName: string;
  email: string | null;
  practiceId: string | null;
  now?: Date;
}

/**
 * Evaluate and (when live) send the single due reminder for one provider.
 * Called nightly per provider after the tracker + admin-alert updates.
 */
export async function evaluateProviderReminder(input: ProviderReminderInput): Promise<void> {
  const { providerProfileId, firstName, email, practiceId } = input;
  const now = input.now ?? new Date();

  const tracker = await prisma.caqhAttestationTracker.findUnique({
    where: { providerProfileId },
  });
  if (!tracker) return;

  if (practiceId) {
    const settings = await prisma.practiceSettings.findUnique({
      where: { practiceId },
      select: { caqhRemindersEnabled: true },
    });
    if (settings?.caqhRemindersEnabled === false) return;
  }

  const reminder = selectReminder(tracker, now);
  if (!reminder) return;
  const key = sentKeyFor(reminder);

  if (!emailsEnabled()) {
    // Dry-run: visible in logs (and greppable for the flag-flip review),
    // mutates nothing so the real first run still sends.
    logger.info({
      event: 'caqh_reminder_dry_run',
      providerProfileId,
      wouldSend: key,
      reminder,
    });
    return;
  }

  if (!email) {
    logger.warn({ event: 'caqh_reminder_no_email', providerProfileId, reminder: key });
    return;
  }
  if (!emailService.isConfigured()) {
    logger.warn({ event: 'caqh_reminder_email_unconfigured', providerProfileId });
    return;
  }

  // Claim before send (at-most-once).
  const sent = (tracker.remindersSent ?? {}) as Record<string, string>;
  await prisma.caqhAttestationTracker.update({
    where: { providerProfileId },
    data: { remindersSent: { ...sent, [key]: now.toISOString() } as Prisma.InputJsonValue },
  });

  const content = buildReminderEmail(reminder, { firstName, tracker });
  try {
    await emailService.sendEmail({
      to: email,
      subject: content.subject,
      html: content.html,
      notificationType: 'enrollment_follow_up',
    });
    logger.info({ event: 'caqh_reminder_sent', providerProfileId, reminder: key });
  } catch (err) {
    logger.error({
      event: 'caqh_reminder_send_failed',
      providerProfileId,
      reminder: key,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
