/**
 * Phase 7 cutover — one-time migration of AetnaEnrollmentRun rows into
 * the generic EnrollmentRun table. Idempotent: skips rows whose
 * enrollment already has an EnrollmentRun with the same startedAt,
 * so re-running is safe.
 *
 * Usage:
 *   npx tsx scripts/migrate-aetna-to-enrollment-run.ts          # dry-run
 *   npx tsx scripts/migrate-aetna-to-enrollment-run.ts --apply  # writes
 */
import { prisma } from '../src/utils/prisma.js';

const APPLY = process.argv.includes('--apply');

// Aetna enum → EnrollmentRun.status string. Terminal failure variants
// collapse to 'failed' since the generic table doesn't distinguish them.
const STATUS_MAP: Record<string, string> = {
  pending: 'pending',
  filling: 'filling',
  awaiting_review: 'awaiting_review',
  submitting: 'submitting',
  completed: 'completed',
  failed: 'failed',
  rejected: 'failed',
  timed_out: 'failed',
};

async function main() {
  const aetnaRuns = await prisma.aetnaEnrollmentRun.findMany({
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${aetnaRuns.length} AetnaEnrollmentRun rows`);
  if (aetnaRuns.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  let copied = 0;
  let skipped = 0;

  for (const old of aetnaRuns) {
    const existing = await prisma.enrollmentRun.findFirst({
      where: {
        enrollmentId: old.payerEnrollmentId,
        startedAt: old.startedAt ?? old.createdAt,
      },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    const filledArtifacts = old.confirmationPdfId
      ? [{ source: 'aetna', engine: 'browser', artifactUrl: old.confirmationPdfId }]
      : null;

    const errorDetails =
      old.errorMessage || old.errorPage !== null || old.automationLog
        ? {
            source: 'aetna',
            aetnaRequestId: old.aetnaRequestId,
            errorMessage: old.errorMessage,
            errorPage: old.errorPage,
            automationLog: old.automationLog,
            screenshotDocIds: old.screenshotDocIds,
          }
        : null;

    const payload = {
      enrollmentId: old.payerEnrollmentId,
      status: STATUS_MAP[old.status] ?? 'failed',
      startedAt: old.startedAt ?? old.createdAt,
      submittedAt: old.submittedAt,
      completedAt: old.completedAt,
      filledArtifacts: filledArtifacts as never,
      errorDetails: errorDetails as never,
      triggeredBy: old.initiatedById,
      createdAt: old.createdAt,
    };

    if (APPLY) {
      await prisma.enrollmentRun.create({ data: payload });
    }
    copied++;
  }

  const mode = APPLY ? 'APPLIED' : 'DRY-RUN';
  console.log(`${mode}: copied ${copied}, skipped ${skipped} (already migrated)`);
  if (!APPLY) {
    console.log('Re-run with --apply to write.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
