import { createHash } from 'crypto';
import { getQueue, QUEUE_NAMES } from '../agents/queues.js';
import { logger } from '../utils/logger.js';

/**
 * Submission queue helper. Single entry point for code that wants to enqueue
 * a portal-submission job. Job ID = EnrollmentRun.id so BullMQ's built-in
 * deduplication prevents two parallel callers (double-click, redeploy mid-job,
 * retry storm) from spawning duplicate jobs.
 *
 * dedupeKey: separately, we attach a SHA-256 dedupeKey derived from the
 * submission's semantic inputs. This is recorded on the job data and can be
 * checked by the worker to refuse stale jobs whose target row has already
 * moved past PENDING/QUEUED. Mirrors the pattern at
 * src/agents/orchestrator/tool-executor.ts:352-362.
 */

export interface SubmissionJobData {
  enrollmentRunId: string;
  payerId: string;
  practiceId: string;
  providerId: string;
  /** Stable hash of (enrollmentRunId, payerId, practiceId, providerId, attemptHint). */
  dedupeKey: string;
  /** Wall-clock when the job was enqueued — for staleness detection. */
  enqueuedAt: string;
}

export function computeSubmissionDedupeKey(input: {
  enrollmentRunId: string;
  payerId: string;
  practiceId: string;
  providerId: string;
}): string {
  const hash = createHash('sha256');
  hash.update(
    [input.enrollmentRunId, input.payerId, input.practiceId, input.providerId].join('|')
  );
  return hash.digest('hex');
}

export async function enqueueSubmission(input: {
  enrollmentRunId: string;
  payerId: string;
  practiceId: string;
  providerId: string;
}): Promise<{ jobId: string; deduplicated: boolean }> {
  const queue = getQueue(QUEUE_NAMES.SUBMISSION);

  // BullMQ deduplicates by jobId — if an active or waiting job with this ID
  // already exists, add() returns the existing job rather than creating a new
  // one. We use this for tight-race idempotency (double-click within ms).
  const existing = await queue.getJob(input.enrollmentRunId);
  if (existing) {
    const state = await existing.getState();
    if (['waiting', 'active', 'delayed', 'paused'].includes(state)) {
      logger.info('enqueueSubmission: reused existing job', {
        enrollmentRunId: input.enrollmentRunId,
        state,
      });
      return { jobId: existing.id ?? input.enrollmentRunId, deduplicated: true };
    }
  }

  const data: SubmissionJobData = {
    enrollmentRunId: input.enrollmentRunId,
    payerId: input.payerId,
    practiceId: input.practiceId,
    providerId: input.providerId,
    dedupeKey: computeSubmissionDedupeKey(input),
    enqueuedAt: new Date().toISOString(),
  };

  const job = await queue.add('submit-application', data, {
    jobId: input.enrollmentRunId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
  });

  logger.info('enqueueSubmission: enqueued', {
    enrollmentRunId: input.enrollmentRunId,
    jobId: job.id,
    dedupeKey: data.dedupeKey.slice(0, 12),
  });

  return { jobId: job.id ?? input.enrollmentRunId, deduplicated: false };
}
