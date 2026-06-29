/**
 * enrollment-outcome.service.ts — the OUTCOME RECORDER (the moat).
 *
 * Writes one row to `enrollment_outcomes` for each real production enrollment
 * outcome, tagged by payer × state × provider_type × process_type, with the
 * timeline. This is auto-captured fact (no human verification) — but it is the
 * asset, so integrity is paramount:
 *
 *  - IDEMPOTENT. Keyed on (enrollmentId, outcome) and written via upsert, so a
 *    webhook double-send, a re-save, or a replayed event never creates a second
 *    row. A terminal outcome happens once per enrollment; that's the natural key.
 *    (We deliberately do NOT include a mutable transition timestamp in the key —
 *    that would let replays with a fresh timestamp duplicate the row.)
 *  - PRODUCTION-ONLY. Demo/seed tenants are excluded at the TENANT level
 *    (Practice.isDemo), not by NODE_ENV — staging runs NODE_ENV=production and we
 *    validate the recorder there. Belt-and-suspenders: @dev.local creators and an
 *    optional practice-id denylist. We do NOT exclude by practice name, because
 *    beta testers are told to use "Test ..." names — name-matching would drop
 *    exactly the data we want to validate with.
 *  - NEVER THROWS. Callers fire-and-forget; a recorder failure must not affect the
 *    enrollment status update.
 *
 * approved / denied / terminated are captured at status-change (hooked into
 * updateEnrollmentStatus and the enrollment-status webhook). `stuck` is derived
 * (>60 days in a non-terminal status) and captured by sweepStuckEnrollments(),
 * intended for a periodic (daily) call.
 */
import { Prisma } from '@prisma/client';
import type { EnrollmentStatus, EnrollmentOutcomeType } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const STUCK_STATUSES: EnrollmentStatus[] = ['not_started', 'in_progress', 'submitted', 'pending_review'];

// Terminal statuses captured at status-change. (stuck is handled by the sweep.)
const RECORDABLE_AT_TRANSITION: Partial<Record<EnrollmentStatus, EnrollmentOutcomeType>> = {
  approved: 'approved',
  denied: 'denied',
  terminated: 'terminated',
};

/** Optional per-practice id denylist (belt-and-suspenders). */
function excludedPracticeIds(): Set<string> {
  return new Set(
    (process.env['OUTCOME_RECORDER_EXCLUDE_PRACTICE_IDS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Everything the recorder needs to resolve the outcome dimensions + exclusion.
const outcomeInclude = Prisma.validator<Prisma.EnrollmentInclude>()({
  payer: { select: { name: true } },
  payerTrack: { select: { stateRegion: true } },
  provider: {
    select: {
      id: true,
      providerType: true,
      practice: { select: { id: true, isDemo: true, state: true, deletedAt: true } },
    },
  },
  createdBy: { select: { email: true } },
});
type LoadedEnrollment = Prisma.EnrollmentGetPayload<{ include: typeof outcomeInclude }>;

interface RecordParams {
  enrollmentId: string;
  status: EnrollmentStatus;
  transitionAt?: Date;
}

function daysBetween(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null;
  const days = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

/** True if this enrollment must be kept OUT of the production outcomes record. */
function isExcluded(e: LoadedEnrollment): boolean {
  const practice = e.provider?.practice ?? null;
  if (!practice) return true; // no practice → not a real tenant outcome
  if (practice.isDemo) return true;
  if (practice.deletedAt) return true; // soft-deleted tenant → not a real outcome
  if (excludedPracticeIds().has(practice.id)) return true;
  const email = e.createdBy?.email?.toLowerCase() ?? '';
  if (email.endsWith('@dev.local')) return true;
  return false;
}

/** Resolve + upsert one outcome from an already-loaded enrollment. Idempotent. */
async function upsertOutcome(
  e: LoadedEnrollment,
  outcome: EnrollmentOutcomeType,
  transitionAt: Date,
): Promise<boolean> {
  if (isExcluded(e)) {
    logger.debug(`[outcomes] skipped (demo/excluded tenant) enrollment=${e.id}`);
    return false;
  }

  // Outcomes are a provider-level dataset (payer × state × provider_type).
  // Practice enrollments have no provider and aren't recorded.
  if (!e.provider) {
    logger.debug(`[outcomes] skipped (practice enrollment, no provider) enrollment=${e.id}`);
    return false;
  }

  const practice = e.provider.practice!; // not-null guaranteed by isExcluded
  const state = e.payerTrack?.stateRegion ?? practice.state ?? 'unknown';
  const processType = e.recredentialingDate ? 'recred' : 'initial';
  const daysToOutcome =
    outcome === 'approved'
      ? daysBetween(e.applicationDate, e.effectiveDate)
      : daysBetween(e.applicationDate, transitionAt);

  await prisma.enrollmentOutcome.upsert({
    where: { enrollmentId_outcome: { enrollmentId: e.id, outcome } },
    create: {
      enrollmentId: e.id,
      outcome,
      payerId: e.payerId,
      payerName: e.payer?.name ?? 'unknown',
      payerTrackId: e.payerTrackId,
      state,
      providerId: e.provider.id,
      providerType: String(e.provider.providerType),
      processType,
      practiceId: practice.id,
      transitionAt,
      applicationDate: e.applicationDate,
      effectiveDate: e.effectiveDate,
      daysToOutcome,
    },
    // Idempotent: the existing row is the source of truth — never overwrite.
    update: {},
  });
  logger.info(`[outcomes] ${outcome} enrollment=${e.id} ${e.payer?.name ?? '?'}/${state}/${processType}`);
  return true;
}

/**
 * Record one production enrollment outcome at status-change. Fire-and-forget.
 * No-op for non-terminal statuses (stuck is the sweep's job). Never throws.
 */
export async function recordEnrollmentOutcome(params: RecordParams): Promise<void> {
  const outcome = RECORDABLE_AT_TRANSITION[params.status];
  if (!outcome) return;

  try {
    const e = await prisma.enrollment.findUnique({
      where: { id: params.enrollmentId },
      include: outcomeInclude,
    });
    if (!e) return;
    await upsertOutcome(e, outcome, params.transitionAt ?? new Date());
  } catch (err) {
    logger.error('[outcomes] recordEnrollmentOutcome failed', {
      enrollmentId: params.enrollmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Idempotent sweep for `stuck` outcomes: in-flight enrollments past 60 days in a
 * non-terminal status with no 'stuck' row yet. Intended for a daily scheduled
 * call (wire in Phase C). Returns the number of new stuck rows written.
 */
export async function sweepStuckEnrollments(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SIXTY_DAYS_MS);
  const candidates = await prisma.enrollment.findMany({
    where: {
      status: { in: STUCK_STATUSES },
      updatedAt: { lt: cutoff },
      outcomes: { none: { outcome: 'stuck' } },
    },
    include: outcomeInclude,
  });

  let written = 0;
  for (const e of candidates) {
    try {
      // transitionAt = when it crossed into stuck ≈ updatedAt + 60d (best available).
      const stuckAt = new Date(new Date(e.updatedAt).getTime() + SIXTY_DAYS_MS);
      if (await upsertOutcome(e, 'stuck', stuckAt)) written++;
    } catch (err) {
      logger.error('[outcomes] sweepStuckEnrollments row failed', {
        enrollmentId: e.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (written > 0) logger.info(`[outcomes] sweep wrote ${written} stuck outcome(s)`);
  return written;
}
