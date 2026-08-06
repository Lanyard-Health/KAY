import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==========================================
// Mocks — vi.hoisted so they're available in vi.mock factories
// ==========================================

const { mockClose, MockQueue } = vi.hoisted(() => {
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const MockQueue = vi.fn().mockImplementation(function (name: string) {
    return { name, close: mockClose };
  });
  return { mockClose, MockQueue };
});

vi.mock('bullmq', () => ({
  Queue: MockQueue,
}));

vi.mock('../utils/redis.js', () => ({
  getRedisConfig: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
  logRedisClientErrors: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { QUEUE_NAMES, getQueue, closeAllQueues } from './queues.js';
import type { QueueName } from './queues.js';

// ==========================================
// Tests
// ==========================================

describe('queues', () => {
  beforeEach(async () => {
    // Clear queue cache from prior tests, then reset mock call counts
    await closeAllQueues();
    vi.clearAllMocks();
  });

  // ------------------------------------------
  // QUEUE_NAMES
  // ------------------------------------------

  describe('QUEUE_NAMES', () => {
    it('has all 9 queue entries', () => {
      expect(Object.keys(QUEUE_NAMES)).toHaveLength(9);
    });

    it('contains CAQH_IMPORT queue', () => {
      expect(QUEUE_NAMES.CAQH_IMPORT).toBe('caqh-import');
    });

    it('contains ORCHESTRATOR queue', () => {
      expect(QUEUE_NAMES.ORCHESTRATOR).toBe('agent-orchestrator');
    });

    it('contains DOCUMENT queue', () => {
      expect(QUEUE_NAMES.DOCUMENT).toBe('agent-document');
    });

    it('contains PORTAL queue', () => {
      expect(QUEUE_NAMES.PORTAL).toBe('agent-portal');
    });

    it('contains MONITOR queue', () => {
      expect(QUEUE_NAMES.MONITOR).toBe('agent-monitor');
    });

    it('contains EXCEPTION queue', () => {
      expect(QUEUE_NAMES.EXCEPTION).toBe('agent-exception');
    });

    it('contains APPROVAL queue', () => {
      expect(QUEUE_NAMES.APPROVAL).toBe('agent-approval');
    });

    it('contains SUBMISSION queue', () => {
      expect(QUEUE_NAMES.SUBMISSION).toBe('submission');
    });
  });

  // ------------------------------------------
  // getQueue
  // ------------------------------------------

  describe('getQueue', () => {
    it('returns a Queue for a valid name', () => {
      const queue = getQueue(QUEUE_NAMES.ORCHESTRATOR);

      expect(queue).toBeDefined();
      expect(queue.name).toBe('agent-orchestrator');
    });

    it('creates the Queue with correct BullMQ options', () => {
      getQueue(QUEUE_NAMES.DOCUMENT);

      expect(MockQueue).toHaveBeenCalledWith(
        'agent-document',
        expect.objectContaining({
          connection: expect.objectContaining({
            host: 'localhost',
            port: 6379,
          }),
          defaultJobOptions: expect.objectContaining({
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 5000 },
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          }),
        })
      );
    });

    it('caches and returns the same Queue instance on repeated calls', () => {
      const first = getQueue(QUEUE_NAMES.PORTAL);
      const second = getQueue(QUEUE_NAMES.PORTAL);

      expect(first).toBe(second);
      expect(MockQueue).toHaveBeenCalledTimes(1);
    });

    it('creates separate Queue instances for different names', () => {
      const q1 = getQueue(QUEUE_NAMES.MONITOR);
      const q2 = getQueue(QUEUE_NAMES.EXCEPTION);

      expect(q1).not.toBe(q2);
      expect(MockQueue).toHaveBeenCalledTimes(2);
    });
  });

  // ------------------------------------------
  // closeAllQueues
  // ------------------------------------------

  describe('closeAllQueues', () => {
    it('is exported as a function', () => {
      expect(typeof closeAllQueues).toBe('function');
    });

    it('closes all cached queues', async () => {
      getQueue(QUEUE_NAMES.ORCHESTRATOR);
      getQueue(QUEUE_NAMES.DOCUMENT);
      getQueue(QUEUE_NAMES.PORTAL);

      await closeAllQueues();

      expect(mockClose).toHaveBeenCalledTimes(3);
    });

    it('clears the cache so new instances are created after close', async () => {
      getQueue(QUEUE_NAMES.APPROVAL);
      await closeAllQueues();

      MockQueue.mockClear();
      getQueue(QUEUE_NAMES.APPROVAL);

      expect(MockQueue).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------
  // QueueName type (compile-time check)
  // ------------------------------------------

  describe('QueueName type', () => {
    it('accepts valid queue name values', () => {
      const name: QueueName = QUEUE_NAMES.ORCHESTRATOR;
      expect(name).toBe('agent-orchestrator');
    });
  });
});
