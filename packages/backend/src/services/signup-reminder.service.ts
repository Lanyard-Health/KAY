/**
 * Signup / first-login reminder emails.
 *
 * Two tracks, one daily run:
 *  A) Pending practice invitations that were never accepted ("never signed up").
 *  B) Accounts that were created but never logged in ("never signed in").
 *
 * Cadence: day 2, 5, 7 from invite-sent (A) / account-created (B). At day 7 the
 * record is closed — invite → expired, account → inactive + Cognito login
 * disabled. Both are reversible (re-invite / re-activate).
 *
 * Design mirrors caqh-reminder.service.ts: crossed-threshold selection (a missed
 * night never drops anyone — they get the most urgent unsent stage, no stale
 * burst), claim-before-send for at-most-once delivery, and a SIGNUP_REMINDER_
 * EMAILS_ENABLED env flag whose default (unset) is a dry-run that mutates
 * nothing. Copy approved by Kay 2026-06-20.
 */

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { Prisma } from '@prisma/client';
import { emailService } from './email.service.js';
import { renderProviderActionEmail } from './email-templates.js';
import { rotateInvitationTokenForReminder } from './practiceInvitation.service.js';
import { disableCognitoUser } from './cognitoUser.service.js';

/** Days since invite-sent / account-created that trigger each stage. */
export const REMINDER_STAGES = [2, 5, 7] as const;
const CLOSE_STAGE = 7;
const MS_PER_DAY = 86_400_000;

function loginUrl(): string {
  return `${(process.env['FRONTEND_URL'] || 'https://portal.lanyardhealth.com').replace(/\/$/, '')}/login`;
}

export function emailsEnabled(): boolean {
  return process.env['SIGNUP_REMINDER_EMAILS_ENABLED'] === 'true';
}

/** Whole days elapsed since `from` (floored). */
export function daysSince(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * The single stage to send now: the most urgent crossed threshold not yet sent.
 * Crossed = age >= stage. Picking the MAX crossed (then checking it's unsent)
 * means a late-discovered record skips straight to its current stage instead of
 * back-filling stale earlier emails, and a record already at its latest stage
 * gets nothing. Returns null when there's nothing due.
 */
export function selectStage(ageDays: number, sent: Record<string, string>): number | null {
  const crossed = REMINDER_STAGES.filter((s) => ageDays >= s);
  if (crossed.length === 0) return null;
  const candidate = Math.max(...crossed);
  return sent[String(candidate)] ? null : candidate;
}

interface EmailContent { subject: string; html: string }

export function buildInviteReminderEmail(stage: number, practiceName: string, acceptUrl: string): EmailContent {
  const cta = { label: stage === CLOSE_STAGE ? 'Set up my account now' : 'Finish setting up your account', url: acceptUrl };
  const common = { firstName: 'there', cta };
  if (stage === 2) {
    return {
      subject: 'Your Lanyard Health invitation is waiting',
      html: renderProviderActionEmail({
        ...common,
        previewText: `Finish joining ${practiceName} on Lanyard Health — it takes about a minute.`,
        heading: 'Your Lanyard Health invitation is waiting',
        paragraphs: [
          `You've been invited to join ${practiceName} on Lanyard Health to manage provider credentialing in one place.`,
          'Setting up your account takes about a minute.',
        ],
        reassurance: 'Your invitation link stays active for 5 more days.',
      }),
    };
  }
  if (stage === 5) {
    return {
      subject: 'Reminder: your Lanyard invitation expires soon',
      html: renderProviderActionEmail({
        ...common,
        previewText: `Your invitation to join ${practiceName} expires in 2 days.`,
        heading: 'Reminder: your Lanyard invitation expires soon',
        paragraphs: [
          `Your invitation to join ${practiceName} on Lanyard Health is still open — but it expires in 2 days.`,
          'It only takes a minute to set up.',
        ],
        reassurance: "After your link expires, you'll need your administrator to send a new invitation.",
      }),
    };
  }
  return {
    subject: 'Last chance: your Lanyard invitation expires today',
    html: renderProviderActionEmail({
      ...common,
      previewText: `Final reminder — your invitation to join ${practiceName} expires today.`,
      heading: 'Last chance: your Lanyard invitation expires today',
      paragraphs: [
        `This is the final reminder — your invitation to join ${practiceName} on Lanyard Health expires at the end of today.`,
      ],
      reassurance: 'Once it expires, the link stops working. Ask your administrator to re-invite you if you miss it.',
    }),
  };
}

export function buildLoginReminderEmail(stage: number, firstName: string): EmailContent {
  const cta = { label: stage === CLOSE_STAGE ? 'Log in to stay active' : 'Log in to Lanyard', url: loginUrl() };
  const common = { firstName, cta };
  if (stage === 2) {
    return {
      subject: 'Welcome to Lanyard Health — pick up where you left off',
      html: renderProviderActionEmail({
        ...common,
        previewText: 'Your account is ready — log in to get started.',
        heading: 'Welcome to Lanyard Health — pick up where you left off',
        paragraphs: [
          "Your Lanyard Health account is ready, but you haven't signed in yet.",
          'Log in to start managing your credentialing and enrollments.',
        ],
        reassurance: 'Accounts that stay unused are paused after 7 days — you have 5 days left.',
      }),
    };
  }
  if (stage === 5) {
    return {
      subject: 'Your Lanyard account is waiting',
      html: renderProviderActionEmail({
        ...common,
        previewText: 'Log in once to keep your account active.',
        heading: 'Your Lanyard account is waiting',
        paragraphs: [
          "You set up a Lanyard Health account but haven't signed in yet.",
          'To keep it active, just log in once — it takes a moment.',
        ],
        reassurance: 'Unused accounts are paused in 2 days. You can always be re-activated by your administrator.',
      }),
    };
  }
  return {
    subject: 'Your Lanyard account will be paused today',
    html: renderProviderActionEmail({
      ...common,
      previewText: 'Log in today to keep your account active.',
      heading: 'Your Lanyard account will be paused today',
      paragraphs: [
        "Your Lanyard Health account hasn't been used since it was created, so it will be set to inactive at the end of today.",
        'Log in now to keep it active — nothing is lost either way.',
      ],
      reassurance: 'If your account is paused, your administrator can re-activate it anytime.',
    }),
  };
}

interface RunSummary { inviteSent: number; inviteClosed: number; loginSent: number; loginClosed: number; dryRun: boolean }

/** Daily entry point. Evaluates both tracks; sends + closes when the flag is on. */
export async function runSignupReminders(now: Date = new Date()): Promise<RunSummary> {
  const dryRun = !emailsEnabled();
  const summary: RunSummary = { inviteSent: 0, inviteClosed: 0, loginSent: 0, loginClosed: 0, dryRun };

  // ---- Track A: pending invitations, never accepted ----
  const invites = await prisma.practiceInvitation.findMany({
    where: { status: 'pending' },
    select: { id: true, email: true, createdAt: true, remindersSent: true, practice: { select: { name: true } } },
  });
  for (const inv of invites) {
    const sent = (inv.remindersSent ?? {}) as Record<string, string>;
    const stage = selectStage(daysSince(inv.createdAt, now), sent);
    if (stage === null) continue;

    if (dryRun) {
      logger.info({ event: 'signup_reminder_dry_run', track: 'invite', invitationId: inv.id, wouldSend: stage });
      continue;
    }
    // Claim before send (at-most-once).
    await prisma.practiceInvitation.update({
      where: { id: inv.id },
      data: { remindersSent: { ...sent, [stage]: now.toISOString() } as Prisma.InputJsonValue },
    });
    try {
      const acceptUrl = await rotateInvitationTokenForReminder(inv.id);
      const email = buildInviteReminderEmail(stage, inv.practice.name, acceptUrl);
      await emailService.sendEmail({ to: inv.email, subject: email.subject, html: email.html, notificationType: 'practice_invitation' });
      summary.inviteSent++;
      logger.info({ event: 'signup_reminder_sent', track: 'invite', invitationId: inv.id, stage });
    } catch (err) {
      logger.error({ event: 'signup_reminder_send_failed', track: 'invite', invitationId: inv.id, stage, error: err instanceof Error ? err.message : 'Unknown' });
    }
    if (stage >= CLOSE_STAGE) {
      await prisma.practiceInvitation.update({ where: { id: inv.id }, data: { status: 'expired' } });
      summary.inviteClosed++;
      logger.info({ event: 'signup_reminder_closed', track: 'invite', invitationId: inv.id });
    }
  }

  // ---- Track B: accounts created but never logged in (non-admins) ----
  const users = await prisma.user.findMany({
    where: { lastLoginAt: null, isActive: true, role: { not: 'admin' } },
    select: { id: true, email: true, firstName: true, createdAt: true, signupRemindersSent: true },
  });
  for (const user of users) {
    const sent = (user.signupRemindersSent ?? {}) as Record<string, string>;
    const stage = selectStage(daysSince(user.createdAt, now), sent);
    if (stage === null) continue;

    if (dryRun) {
      logger.info({ event: 'signup_reminder_dry_run', track: 'login', userId: user.id, wouldSend: stage });
      continue;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { signupRemindersSent: { ...sent, [stage]: now.toISOString() } as Prisma.InputJsonValue },
    });
    try {
      const email = buildLoginReminderEmail(stage, user.firstName);
      await emailService.sendEmail({ to: user.email, subject: email.subject, html: email.html, notificationType: 'practice_invitation' });
      summary.loginSent++;
      logger.info({ event: 'signup_reminder_sent', track: 'login', userId: user.id, stage });
    } catch (err) {
      logger.error({ event: 'signup_reminder_send_failed', track: 'login', userId: user.id, stage, error: err instanceof Error ? err.message : 'Unknown' });
    }
    if (stage >= CLOSE_STAGE) {
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      try { await disableCognitoUser(user.email); } catch (err) {
        logger.error({ event: 'signup_reminder_cognito_disable_failed', userId: user.id, error: err instanceof Error ? err.message : 'Unknown' });
      }
      summary.loginClosed++;
      logger.info({ event: 'signup_reminder_closed', track: 'login', userId: user.id });
    }
  }

  logger.info({ event: 'signup_reminder_run_complete', ...summary });
  return summary;
}
