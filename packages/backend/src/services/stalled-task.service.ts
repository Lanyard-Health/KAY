import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { QUEUE_LOCK_DURATIONS, QUEUE_NAMES, type QueueName, getQueue } from '../agents/queues.js';

/**
 * Stalled-task watchdog (Tier 1 #3).
 *
 * BullMQ's lockDuration retries jobs that exceed their lock, but if Redis
 * restarts mid-deploy (no AOF persistence) the in-flight job state is lost.
 * The DB still shows status='in_progress' but no worker is processing it —
 * the task is orphaned forever.
 *
 * This watchdog scans for AgentTask rows that:
 *   - status = in_progress
 *   - startedAt older than (max lockDuration across queues + 10 min buffer)
 *   - stalledDetectedAt IS NULL (so we only act once)
 *
 * For each match, it sets stalledDetectedAt, and:
 *   - if the task has retries remaining, re-enqueues via the matching BullMQ
 *     queue and bumps attempts.
 *   - otherwise, transitions status to 'failed' with a structured error.
 */

// Buffer applied to the longest queue lockDuration. 10 minutes gives a slow
// portal automation job time to finish before we declare it stalled.
const STALLED_BUFFER_MS = 10 * 60_000;

// Computed once at module load — the longest queue lock + buffer.
function getStalledThresholdMs(): number {
  const maxLock = Math.max(...Object.values(QUEUE_LOCK_DURATIONS));
  return maxLock + STALLED_BUFFER_MS;
}

export interface StalledTaskSweepResult {
  scanned: number;
  reenqueued: number;
  failed: number;
  errors: Array<{ taskId: string; reason: string }>;
}

/**
 * Run one watchdog sweep. Safe to invoke from a cron, manually, or in tests.
 * Idempotent per task: once stalledDetectedAt is set, the task is excluded
 * from subsequent sweeps.
 */
export async function sweepStalledTasks(now: Date = new Date()): Promise<StalledTaskSweepResult> {
  const threshold = new Date(now.getTime() - getStalledThresholdMs());
  const result: StalledTaskSweepResult = { scanned: 0, reenqueued: 0, failed: 0, errors: [] };

  const candidates = await prisma.agentTask.findMany({
    where: {
      status: 'in_progress',
      startedAt: { lt: threshold },
      stalledDetectedAt: null,
    },
    select: {
      id: true,
      workflowId: true,
      type: true,
      queue: true,
      attempts: true,
      maxAttempts: true,
      startedAt: true,
      input: true,
    },
  });

  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  logger.warn(
    `[StalledTaskWatchdog] Detected ${candidates.length} stalled task(s) older than ${Math.round(getStalledThresholdMs() / 60_000)} min`,
  );

  for (const task of candidates) {
    const ageMinutes = task.startedAt
      ? Math.round((now.getTime() - task.startedAt.getTime()) / 60_000)
      : null;
    const canRetry = task.attempts < task.maxAttempts;
    const queueName = isKnownQueue(task.queue) ? task.queue : null;

    try {
      if (canRetry && queueName) {
        // Mark detected, increment attempts, requeue.
        await prisma.agentTask.update({
          where: { id: task.id },
          data: {
            stalledDetectedAt: now,
            attempts: { increment: 1 },
          },
        });
        await getQueue(queueName).add(task.type, {
          workflowId: task.workflowId,
          taskId: task.id,
          ...((task.input ?? {}) as Record<string, unknown>),
        });
        result.reenqueued++;
        logger.info(
          `[StalledTaskWatchdog] Re-enqueued task ${task.id} (type=${task.type}, queue=${queueName}, ageMinutes=${ageMinutes})`,
        );
      } else {
        // Out of retries OR queue unknown — fail the task.
        await prisma.agentTask.update({
          where: { id: task.id },
          data: {
            stalledDetectedAt: now,
            status: 'failed',
            completedAt: now,
            error: {
              reason: 'stalled',
              detectedBy: 'watchdog',
              ageMinutes,
              queue: task.queue ?? null,
              attemptsExhausted: !canRetry,
            },
          },
        });
        result.failed++;
        logger.warn(
          `[StalledTaskWatchdog] Marked task ${task.id} as failed (type=${task.type}, queue=${task.queue ?? 'unknown'}, ageMinutes=${ageMinutes}, canRetry=${canRetry})`,
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ taskId: task.id, reason });
      logger.error(`[StalledTaskWatchdog] Failed to process task ${task.id}:`, err);
    }
  }

  return result;
}

function isKnownQueue(name: string | null): name is QueueName {
  if (!name) return false;
  return (Object.values(QUEUE_NAMES) as string[]).includes(name);
}
