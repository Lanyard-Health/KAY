import { prisma } from '../utils/prisma.js';
import { onEnrollmentCreated } from './enrollment-creation-hook.js';
import { logger } from '../utils/logger.js';

const DEFAULT_SLA_DAYS = 90;

interface EnsureDraftsInput {
  practiceId: string;
  providerId?: string;
  payerId?: string;
  createdById?: string;
}

interface EnsureDraftsResult {
  created: number;
}

/**
 * Idempotently creates draft Enrollment rows for every (provider × payer)
 * combination implied by the practice's targetPayerIds.
 *
 * Called when a provider is added (providerId set, payerId omitted) — creates
 * one draft per target payer — and when a payer is added to targetPayerIds
 * (payerId set, providerId omitted) — creates one draft per existing provider.
 *
 * Drafts are marked isDraft=true so dashboards and metrics can exclude them
 * until staff edits real data. Duplicates are skipped via the existing
 * @@unique([providerId, payerId]) constraint.
 */
export async function ensureDraftEnrollments(
  input: EnsureDraftsInput
): Promise<EnsureDraftsResult> {
  const { practiceId, providerId, payerId, createdById } = input;

  if (!providerId && !payerId) {
    throw new Error('ensureDraftEnrollments requires providerId or payerId');
  }

  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { targetPayerIds: true },
  });
  if (!practice) return { created: 0 };

  // Resolve the (provider, payer) pairs to consider
  const providerIds: string[] = [];
  const payerIds: string[] = [];

  if (providerId) {
    providerIds.push(providerId);
    payerIds.push(...practice.targetPayerIds);
  } else if (payerId) {
    if (!practice.targetPayerIds.includes(payerId)) {
      // Payer isn't a target — nothing to do
      return { created: 0 };
    }
    payerIds.push(payerId);
    const providers = await prisma.providerProfile.findMany({
      where: { practiceId, status: { not: 'inactive' } },
      select: { id: true },
    });
    providerIds.push(...providers.map((p) => p.id));
  }

  if (providerIds.length === 0 || payerIds.length === 0) {
    return { created: 0 };
  }

  // Filter out pairs whose payer doesn't exist (defensive — targetPayerIds
  // may reference deleted/renamed payers)
  const existingPayers = await prisma.payer.findMany({
    where: { id: { in: payerIds } },
    select: { id: true },
  });
  const validPayerIds = new Set(existingPayers.map((p) => p.id));

  // Find existing (provider, payer) enrollments to skip
  const existing = await prisma.enrollment.findMany({
    where: {
      providerId: { in: providerIds },
      payerId: { in: [...validPayerIds] },
    },
    select: { providerId: true, payerId: true },
  });
  const existingSet = new Set(existing.map((e) => `${e.providerId}::${e.payerId}`));

  const slaTargetDate = new Date(Date.now() + DEFAULT_SLA_DAYS * 24 * 60 * 60 * 1000);

  // Create drafts one at a time so we can hydrate workflow steps per enrollment
  // and keep per-row errors from aborting the whole batch.
  let created = 0;
  for (const pid of providerIds) {
    for (const pyId of payerIds) {
      if (!validPayerIds.has(pyId)) continue;
      if (existingSet.has(`${pid}::${pyId}`)) continue;

      try {
        const enrollment = await prisma.enrollment.create({
          data: {
            providerId: pid,
            payerId: pyId,
            status: 'not_started',
            isDraft: true,
            slaTargetDate,
            createdById: createdById ?? null,
          },
          include: {
            payer: { select: { workflowKey: true, name: true } },
            provider: { select: { providerType: true } },
          },
        });

        // Hydrate workflow steps so the Command Center kanban has cards
        // immediately. Non-blocking: failures are logged but don't roll back
        // the draft.
        try {
          await onEnrollmentCreated(prisma, enrollment);
        } catch (hookErr) {
          logger.warn(
            `Draft ${enrollment.id}: workflow hydration failed (non-fatal)`,
            hookErr
          );
        }

        created++;
      } catch (err: unknown) {
        // Unique constraint violation = someone else created the pair concurrently; safe to skip
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Unique constraint')) continue;
        logger.error(
          `Failed to create draft enrollment for provider ${pid}, payer ${pyId}`,
          err
        );
      }
    }
  }

  if (created > 0) {
    logger.info(`Created ${created} draft enrollments for practice ${practiceId}`);
  }

  return { created };
}
