import { Queue } from 'bullmq';
import { getRedisConfig } from '../utils/redis.js';
import { logger } from '../utils/logger.js';

// ==========================================
// Queue name constants
// ==========================================

export const QUEUE_NAMES = {
  ORCHESTRATOR: 'agent-orchestrator',
  DOCUMENT: 'agent-document',
  PORTAL: 'agent-portal',
  MONITOR: 'agent-monitor',
  EXCEPTION: 'agent-exception',
  APPROVAL: 'agent-approval',
  WEBHOOK_DELIVERY: 'webhook-delivery',
  // Submission engine — Phase 1. One job per EnrollmentRun (jobId =
  // EnrollmentRun.id for idempotency). Worker hands off to AdapterFactory.
  SUBMISSION: 'submission',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ==========================================
// Per-queue lock duration (ms)
// ==========================================
// Workers use lockDuration to detect stalled jobs. A job running longer
// than its lockDuration is considered stalled and may be retried.
export const QUEUE_LOCK_DURATIONS: Record<QueueName, number> = {
  [QUEUE_NAMES.ORCHESTRATOR]: 5 * 60_000,    // 5 min — multi-turn loop, up to 20 tool calls
  [QUEUE_NAMES.DOCUMENT]: 3 * 60_000,        // 3 min — OCR + vision + credential save
  [QUEUE_NAMES.PORTAL]: 5 * 60_000,          // 5 min — Puppeteer browser automation
  [QUEUE_NAMES.EXCEPTION]: 2 * 60_000,       // 2 min — single Claude call + DB writes
  [QUEUE_NAMES.MONITOR]: 1 * 60_000,         // 1 min — lightweight checks
  [QUEUE_NAMES.APPROVAL]: 1 * 60_000,        // 1 min — DB + email
  [QUEUE_NAMES.WEBHOOK_DELIVERY]: 30_000,    // 30 s — single HTTP POST, 10 s timeout per attempt
  [QUEUE_NAMES.SUBMISSION]: 6 * 60_000,      // 6 min — wraps 5-min Playwright timeout + DB writes
};

// ==========================================
// Per-queue default-job-options overrides
// ==========================================
// Most queues use the global default (3 attempts, 2 s exponential backoff).
// webhook-delivery overrides to 8 attempts so transient receiver failures
// (5xx, 408, 429) get retried per Phase 0.A Addition 1; once the retry
// budget is exhausted the worker marks WebhookDelivery.status='dead'
// (DLQ marker).
//
// 8 attempts × exponential 2 s backoff ≈ 8 + 4 + 8 + 16 + 32 + 64 + 128 + 256 s
// ≈ 8.6 minutes total wall-clock — long enough to ride out a deploy,
// short enough that delivery isn't deferred for hours.
const QUEUE_ATTEMPTS_OVERRIDE: Partial<Record<QueueName, number>> = {
  [QUEUE_NAMES.WEBHOOK_DELIVERY]: 8,
};

// ==========================================
// Queue cache and factory
// ==========================================

const queueCache = new Map<QueueName, Queue>();

/**
 * Returns a BullMQ Queue for the given name, lazily creating and caching it.
 * All queues share the same Redis connection config and default job options.
 */
export function getQueue(name: QueueName): Queue {
  const cached = queueCache.get(name);
  if (cached) {
    return cached;
  }

  const connection = getRedisConfig();

  const attempts = QUEUE_ATTEMPTS_OVERRIDE[name] ?? 3;
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      attempts,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
  });

  queueCache.set(name, queue);
  logger.info(`Queue created: ${name}`);

  return queue;
}

/**
 * Closes all cached queues and clears the cache.
 * Call during graceful shutdown.
 */
export async function closeAllQueues(): Promise<void> {
  const entries = Array.from(queueCache.entries());
  await Promise.all(
    entries.map(async ([name, queue]) => {
      await queue.close();
      logger.info(`Queue closed: ${name}`);
    })
  );
  queueCache.clear();
}
