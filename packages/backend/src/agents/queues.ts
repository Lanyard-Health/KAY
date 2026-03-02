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
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ==========================================
// Per-queue lock duration (ms)
// ==========================================
// Workers use lockDuration to detect stalled jobs. A job running longer
// than its lockDuration is considered stalled and may be retried.
export const QUEUE_LOCK_DURATIONS: Record<QueueName, number> = {
  [QUEUE_NAMES.ORCHESTRATOR]: 5 * 60_000,  // 5 min — multi-turn loop, up to 20 tool calls
  [QUEUE_NAMES.DOCUMENT]: 3 * 60_000,      // 3 min — OCR + vision + credential save
  [QUEUE_NAMES.PORTAL]: 5 * 60_000,        // 5 min — Puppeteer browser automation
  [QUEUE_NAMES.EXCEPTION]: 2 * 60_000,     // 2 min — single Claude call + DB writes
  [QUEUE_NAMES.MONITOR]: 1 * 60_000,       // 1 min — lightweight checks
  [QUEUE_NAMES.APPROVAL]: 1 * 60_000,      // 1 min — DB + email
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

  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      attempts: 3,
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
