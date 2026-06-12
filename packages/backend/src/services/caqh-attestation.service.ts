/**
 * CAQH re-attestation tracker (B1).
 *
 * Fills CaqhAttestationTracker from the DataSpring status response the nightly
 * sync already fetches: persists the attestation date, computes the projected
 * due date, captures a baseline snapshot when a new attestation is observed,
 * and diffs the current pull against that baseline ("nothing changed" check).
 *
 * Verified semantics (spec v3.2 glossary + live demo, 2026-06-12 — see
 * ~/.claude/plans/caqh-reattest-b1-b2.md):
 *  - provider_status_date is the attestation date ONLY for the attested
 *    statuses below. For "Expired Attestation" it is the expiry-flag date —
 *    never derive a due date from it.
 *  - Cycle length is state-dependent: IL = 180 days, everywhere else = 120.
 *  - anniversary_date is a billing anniversary. Never use it.
 *
 * Baseline rule (plan decision #3): captured ONLY when we observe the
 * attestation date move — never retroactively. A provider's first cycle with
 * us is verdict 'no_baseline' (neutral reminder copy, no "nothing changed"
 * claim).
 *
 * Diff failure direction: unknown volatile fields produce a false "changed"
 * (harmless — neutral email), never a false "unchanged".
 */

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { Prisma } from '@prisma/client';
import { notificationService } from './notification.service.js';
import type { CaqhStatusResponse } from './caqh.service.js';

/** Statuses whose provider_status_date IS the (re-)attestation date. */
export const ATTESTED_STATUSES: ReadonlySet<string> = new Set([
  'Initial Profile Complete',
  'Profile Data Submitted',
  'Re-Attestation',
]);

/** Authoritative overdue signal. Its status_date is the expiry date — not an attestation. */
export const EXPIRED_STATUS = 'Expired Attestation';

export const CYCLE_DAYS_DEFAULT = 120;
export const CYCLE_DAYS_ILLINOIS = 180;

/**
 * Keys stripped before diffing. Conservative starter list — anything pull- or
 * envelope-specific. Unknown volatile keys fail safe (false "changed").
 */
const VOLATILE_KEYS: ReadonlySet<string> = new Set([
  'RequestID',
  'RequestDate',
  'ResponseDate',
  'ExtractDate',
  'GeneratedDate',
]);

/** Strict YYYYMMDD → UTC Date. Returns null on anything malformed. */
export function parseYyyymmddUTC(value: string | null | undefined): Date | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers like 20260231 → Mar 2.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function cycleDaysForState(practiceState: string | null | undefined): number {
  return practiceState?.trim().toUpperCase() === 'IL'
    ? CYCLE_DAYS_ILLINOIS
    : CYCLE_DAYS_DEFAULT;
}

export function computeNextDueDate(lastAttestation: Date, practiceState: string | null | undefined): Date {
  const due = new Date(lastAttestation.getTime());
  due.setUTCDate(due.getUTCDate() + cycleDaysForState(practiceState));
  return due;
}

/**
 * Deep-normalize for comparison: strip volatile keys, sort object keys,
 * sort arrays by their serialized form (CAQH list ordering is not stable).
 */
export function normalizeForDiff(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeForDiff(item))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = normalizeForDiff((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export interface DiffResult {
  verdict: 'unchanged' | 'changed';
  changedSections: string[];
}

/**
 * Compare two normalized Provider objects. changedSections = top-level keys
 * that differ (added, removed, or modified).
 */
export function diffSnapshots(baseline: unknown, current: unknown): DiffResult {
  const base = (normalizeForDiff(baseline) ?? {}) as Record<string, unknown>;
  const curr = (normalizeForDiff(current) ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(base), ...Object.keys(curr)]);
  const changedSections: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(base[key]) !== JSON.stringify(curr[key])) {
      changedSections.push(key);
    }
  }
  changedSections.sort();
  return changedSections.length === 0
    ? { verdict: 'unchanged', changedSections: [] }
    : { verdict: 'changed', changedSections };
}

/** The Provider payload section of the mirror's rawJson, if present. */
function providerSection(rawJson: unknown): unknown {
  if (rawJson && typeof rawJson === 'object' && 'Provider' in (rawJson as Record<string, unknown>)) {
    return (rawJson as Record<string, unknown>)['Provider'];
  }
  return rawJson ?? null;
}

export interface TrackerUpdateInput {
  providerProfileId: string;
  status: CaqhStatusResponse;
  /** Current mirror rawJson (this pull). Null when no mirror exists yet. */
  rawJson: unknown;
}

/**
 * Core state machine. Idempotent: re-running with the same inputs writes the
 * same state (safe to double-run; no advisory lock needed at this layer —
 * the lock requirement lands with the email sender in PR 4).
 */
export async function updateAttestationTracker(input: TrackerUpdateInput): Promise<void> {
  const { providerProfileId, status, rawJson } = input;
  const providerStatus = status.provider_status ?? null;
  const statusDate = parseYyyymmddUTC(status.provider_status_date);
  const practiceState = status.provider_practice_state ?? null;

  const existing = await prisma.caqhAttestationTracker.findUnique({
    where: { providerProfileId },
  });

  // Statuses outside the attestation cycle (never attested, opted out,
  // deceased, retired, outreach states...): record the status for visibility,
  // touch nothing else.
  const inCycle = providerStatus !== null
    && (ATTESTED_STATUSES.has(providerStatus) || providerStatus === EXPIRED_STATUS);

  if (!inCycle) {
    await prisma.caqhAttestationTracker.upsert({
      where: { providerProfileId },
      create: { providerProfileId, providerStatus },
      update: { providerStatus },
    });
    return;
  }

  if (providerStatus === EXPIRED_STATUS) {
    // Authoritative overdue. status_date here is the expiry date — keep any
    // previously known attestation dates; if we never saw one, force the due
    // date into the past so "overdue" is queryable even without history.
    await prisma.caqhAttestationTracker.upsert({
      where: { providerProfileId },
      create: {
        providerProfileId,
        providerStatus,
        nextDueDate: statusDate, // expiry date ≈ the date it became due
      },
      update: {
        providerStatus,
        ...(existing?.nextDueDate ? {} : { nextDueDate: statusDate }),
      },
    });
    return;
  }

  // Attested status: provider_status_date IS the attestation date.
  if (!statusDate) {
    logger.warn({
      event: 'caqh_attestation_tracker_missing_date',
      providerProfileId,
      providerStatus,
    });
    await prisma.caqhAttestationTracker.upsert({
      where: { providerProfileId },
      create: { providerProfileId, providerStatus },
      update: { providerStatus },
    });
    return;
  }

  const nextDueDate = computeNextDueDate(statusDate, practiceState);
  const isNewAttestation =
    existing?.lastAttestationDate != null
    && existing.lastAttestationDate.getTime() !== statusDate.getTime();
  const isFirstObservation = existing?.lastAttestationDate == null;

  if (isNewAttestation) {
    // Observed transition → new cycle: capture baseline, reset reminder state.
    const baseline = normalizeForDiff(providerSection(rawJson));
    await prisma.caqhAttestationTracker.update({
      where: { providerProfileId },
      data: {
        providerStatus,
        lastAttestationDate: statusDate,
        nextDueDate,
        baselineSnapshot: baseline as Prisma.InputJsonValue,
        baselineCapturedAt: new Date(),
        diffVerdict: 'unchanged',
        changedSections: [],
        remindersSent: Prisma.DbNull,
        cycleAnchor: statusDate,
      },
    });
    logger.info({
      event: 'caqh_attestation_new_cycle',
      providerProfileId,
      lastAttestationDate: statusDate.toISOString(),
      nextDueDate: nextDueDate.toISOString(),
    });
    return;
  }

  if (isFirstObservation) {
    // First time tracking this provider: the attestation happened before we
    // started watching, so we have no honest baseline (plan decision #3).
    await prisma.caqhAttestationTracker.upsert({
      where: { providerProfileId },
      create: {
        providerProfileId,
        providerStatus,
        lastAttestationDate: statusDate,
        nextDueDate,
        diffVerdict: 'no_baseline',
        cycleAnchor: statusDate,
      },
      update: {
        providerStatus,
        lastAttestationDate: statusDate,
        nextDueDate,
        diffVerdict: 'no_baseline',
        cycleAnchor: statusDate,
      },
    });
    return;
  }

  // Same attestation date as before → mid-cycle pull: diff against baseline.
  if (existing.baselineSnapshot == null) {
    await prisma.caqhAttestationTracker.update({
      where: { providerProfileId },
      data: { providerStatus, nextDueDate, diffVerdict: 'no_baseline' },
    });
    return;
  }

  const { verdict, changedSections } = diffSnapshots(
    existing.baselineSnapshot,
    providerSection(rawJson),
  );
  await prisma.caqhAttestationTracker.update({
    where: { providerProfileId },
    data: { providerStatus, nextDueDate, diffVerdict: verdict, changedSections },
  });
}

// ---------------------------------------------------------------------------
// Admin alerts (B1 PR 3) — in-app notifications at the three moments Kay
// chose (decision Q1/Q5): expiry, day-7 pre-due heads-up, +14d-overdue
// escalation. Each fires once per cycle, tracked under admin-prefixed keys
// in remindersSent (cleared automatically on cycle reset). Provider-facing
// email keys (PR 4) share the same object under numeric keys.
// ---------------------------------------------------------------------------

/** Whole-day difference (UTC) from `now` to `date`. Negative = past due. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

interface AdminAlertRule {
  key: string;
  applies: (daysToDue: number, isExpired: boolean) => boolean;
  title: string;
  message: (providerName: string, daysToDue: number) => string;
}

const ADMIN_ALERT_RULES: AdminAlertRule[] = [
  {
    key: 'admin7',
    applies: (d, expired) => !expired && d >= 0 && d <= 7,
    title: 'CAQH attestation due within 7 days',
    message: (name, d) =>
      `${name}'s CAQH attestation is due in ${d} day${d === 1 ? '' : 's'} and is still pending.`,
  },
  {
    key: 'adminExpired',
    applies: (d, expired) => expired || d < 0,
    title: 'CAQH attestation expired',
    message: (name) =>
      `${name}'s CAQH attestation has expired. Payers may treat a lapsed attestation as a termination — this needs attention.`,
  },
  {
    key: 'adminOverdue14',
    applies: (d) => d <= -14,
    title: 'CAQH attestation 2+ weeks overdue',
    message: (name) =>
      `${name}'s CAQH attestation has been lapsed for two weeks despite reminders. Automated nudges have not worked — consider a phone call.`,
  },
];

export interface AdminAlertInput {
  providerProfileId: string;
  providerName: string;
  practiceId: string | null;
  /** Injectable for tests. */
  now?: Date;
}

/**
 * Evaluate and send the once-per-cycle admin alerts for one provider.
 * Respects the practice-level toggle (PracticeSettings.caqhRemindersEnabled).
 * Best-effort by contract: callers wrap it so failures never break the sync.
 */
export async function evaluateAdminAttestationAlerts(input: AdminAlertInput): Promise<void> {
  const { providerProfileId, providerName, practiceId } = input;
  const now = input.now ?? new Date();

  const tracker = await prisma.caqhAttestationTracker.findUnique({
    where: { providerProfileId },
  });
  if (!tracker?.nextDueDate) return;

  if (practiceId) {
    const settings = await prisma.practiceSettings.findUnique({
      where: { practiceId },
      select: { caqhRemindersEnabled: true },
    });
    if (settings?.caqhRemindersEnabled === false) return;
  }

  const sent = (tracker.remindersSent ?? {}) as Record<string, string>;
  const isExpired = tracker.providerStatus === EXPIRED_STATUS;
  const daysToDue = daysUntil(tracker.nextDueDate, now);

  const fired: Record<string, string> = {};
  for (const rule of ADMIN_ALERT_RULES) {
    if (sent[rule.key] || !rule.applies(daysToDue, isExpired)) continue;
    await notificationService.notifyAdminUsers({
      type: 'system_announcement',
      title: rule.title,
      message: rule.message(providerName, daysToDue),
      actionUrl: `/providers/${providerProfileId}`,
    });
    fired[rule.key] = now.toISOString();
    logger.info({
      event: 'caqh_attestation_admin_alert',
      providerProfileId,
      alert: rule.key,
      daysToDue,
    });
  }

  if (Object.keys(fired).length > 0) {
    await prisma.caqhAttestationTracker.update({
      where: { providerProfileId },
      data: { remindersSent: { ...sent, ...fired } as Prisma.InputJsonValue },
    });
  }
}
