import { getQueue, QUEUE_NAMES } from '../agents/queues.js';
import { logger } from '../utils/logger.js';

/**
 * CAQH-first onboarding import job (plan: caqh-first-onboarding.md PR 2).
 *
 * trigger:
 *  - 'approval'  — enqueued automatically when an application with a CAQH ID is approved
 *  - 'manual'    — admin clicked "Import from CAQH"
 *  - 'recheck'   — scheduled re-poll while the provider is in a waiting_* state
 *
 * recheckCount counts consecutive waiting-state re-polls so the job can give up
 * (and alert admins) instead of polling forever for a provider who never acts.
 */
export interface CaqhImportJobData {
  providerId: string;
  trigger: 'approval' | 'manual' | 'recheck';
  recheckCount: number;
}

export const MAX_CAQH_IMPORT_RECHECKS = 14; // daily re-polls ≈ two weeks

export async function enqueueCaqhImport(input: {
  providerId: string;
  trigger: CaqhImportJobData['trigger'];
  recheckCount?: number;
  delayMs?: number;
}): Promise<{ jobId: string; deduplicated: boolean }> {
  const queue = getQueue(QUEUE_NAMES.CAQH_IMPORT);

  // Immediate jobs dedup on providerId — a second "Import" click while a job is
  // queued/running is a no-op. Rechecks get a distinct id per round so the
  // delayed job is not swallowed by the dedup of the job that scheduled it.
  const recheckCount = input.recheckCount ?? 0;
  const jobId =
    input.trigger === 'recheck'
      ? `caqh-import-${input.providerId}-recheck-${recheckCount}`
      : `caqh-import-${input.providerId}`;

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'waiting' || state === 'active' || state === 'delayed') {
      logger.info('caqh-import job already pending — deduplicated', {
        providerId: input.providerId,
        jobId,
        state,
      });
      return { jobId, deduplicated: true };
    }
    // A finished job with the same id would block the re-add — clear it.
    await existing.remove();
  }

  const data: CaqhImportJobData = {
    providerId: input.providerId,
    trigger: input.trigger,
    recheckCount,
  };

  const job = await queue.add('caqh-import', data, {
    jobId,
    ...(input.delayMs ? { delay: input.delayMs } : {}),
  });

  logger.info('caqh-import job enqueued', {
    providerId: input.providerId,
    trigger: input.trigger,
    jobId: job.id,
    delayMs: input.delayMs ?? 0,
  });

  return { jobId: job.id ?? jobId, deduplicated: false };
}
