import { Queue } from 'bullmq';
import { getRedisConfig } from '../utils/redis.js';
import { logger } from '../utils/logger.js';

// ==========================================
// Queue name constants
// ==========================================

export const QUEUE_NAMES = {
  ORCHESTRATOR: 'agent:orchestrator',
  DOCUMENT: 'agent:document',
  PORTAL: 'agent:portal',
  MONITOR: 'agent:monitor',
  EXCEPTION: 'agent:exception',
  APPROVAL: 'agent:approval',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

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
