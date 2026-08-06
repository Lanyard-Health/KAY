import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ==========================================
// Mocks — vi.hoisted so they're available in vi.mock factories
// ==========================================

const { mockOn, mockQuit, MockRedis } = vi.hoisted(() => {
  const mockOn = vi.fn().mockReturnThis();
  const mockQuit = vi.fn().mockResolvedValue('OK');
  const MockRedis = vi.fn().mockImplementation(function () {
    return { on: mockOn, quit: mockQuit };
  });
  return { mockOn, mockQuit, MockRedis };
});

vi.mock('ioredis', () => ({
  Redis: MockRedis,
}));

const { logWarn, logError } = vi.hoisted(() => ({ logWarn: vi.fn(), logError: vi.fn() }));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: logWarn, error: logError },
}));

import {
  getRedisConfig,
  getRedisConnection,
  closeRedisConnection,
  logRedisClientErrors,
} from './redis.js';

// ==========================================
// Tests
// ==========================================

describe('redis utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars
    delete process.env['REDIS_HOST'];
    delete process.env['REDIS_PORT'];
    delete process.env['REDIS_PASSWORD'];
  });

  afterEach(async () => {
    // Clean up singleton between tests
    await closeRedisConnection();
  });

  // ------------------------------------------
  // getRedisConfig
  // ------------------------------------------

  describe('getRedisConfig', () => {
    it('returns default host and port when env vars are not set', () => {
      const config = getRedisConfig();

      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
    });

    it('reads host and port from env vars', () => {
      process.env['REDIS_HOST'] = 'redis.example.com';
      process.env['REDIS_PORT'] = '6380';

      const config = getRedisConfig();

      expect(config.host).toBe('redis.example.com');
      expect(config.port).toBe(6380);
    });

    it('includes password when REDIS_PASSWORD is set', () => {
      process.env['REDIS_PASSWORD'] = 'secret';

      const config = getRedisConfig();

      expect(config.password).toBe('secret');
    });

    it('omits password when REDIS_PASSWORD is not set', () => {
      const config = getRedisConfig();

      expect(config.password).toBeUndefined();
    });

    it('sets maxRetriesPerRequest to null (BullMQ requirement)', () => {
      const config = getRedisConfig();

      expect(config.maxRetriesPerRequest).toBeNull();
    });

    it('enables ready check', () => {
      const config = getRedisConfig();

      expect(config.enableReadyCheck).toBe(true);
    });

    it('has a retryStrategy function', () => {
      const config = getRedisConfig();

      expect(typeof config.retryStrategy).toBe('function');
    });

    it('retryStrategy returns exponential backoff capped at 5000ms', () => {
      const config = getRedisConfig();
      const strategy = config.retryStrategy!;

      // Attempt 1: min(2^1 * 100, 5000) = 200
      expect(strategy(1)).toBe(200);
      // Attempt 5: min(2^5 * 100, 5000) = 3200
      expect(strategy(5)).toBe(3200);
      // Attempt 8: min(2^8 * 100, 5000) = 5000 (capped)
      expect(strategy(8)).toBe(5000);
    });

    it('retryStrategy returns null after max retries', () => {
      const config = getRedisConfig();
      const strategy = config.retryStrategy!;

      expect(strategy(11)).toBeNull();
    });
  });

  // ------------------------------------------
  // getRedisConnection
  // ------------------------------------------

  describe('getRedisConnection', () => {
    it('creates a Redis instance with config from getRedisConfig', () => {
      getRedisConnection();

      expect(MockRedis).toHaveBeenCalledTimes(1);
      expect(MockRedis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
        })
      );
    });

    it('returns the same instance on subsequent calls (singleton)', () => {
      const first = getRedisConnection();
      const second = getRedisConnection();

      expect(first).toBe(second);
      expect(MockRedis).toHaveBeenCalledTimes(1);
    });

    it('registers connect and error event listeners', () => {
      getRedisConnection();

      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  // ------------------------------------------
  // closeRedisConnection
  // ------------------------------------------

  describe('closeRedisConnection', () => {
    it('quits the connection when one exists', async () => {
      getRedisConnection();

      await closeRedisConnection();

      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('allows creating a new connection after closing', async () => {
      getRedisConnection();
      await closeRedisConnection();

      getRedisConnection();

      expect(MockRedis).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no connection exists', async () => {
      // Should not throw
      await closeRedisConnection();

      expect(mockQuit).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------
  // logRedisClientErrors (ENG-269)
  // ------------------------------------------

  describe('logRedisClientErrors', () => {
    it("documents why this exists: emitting 'error' with no listener throws", () => {
      const bare = new EventEmitter();

      expect(() => bare.emit('error', new Error('Connection is closed.'))).toThrow(
        'Connection is closed.',
      );
    });

    it('swallows that throw once attached, which is what stops the unhandled rejection', () => {
      const queue = new EventEmitter();
      logRedisClientErrors(queue, 'Queue test');

      expect(() => queue.emit('error', new Error('Connection is closed.'))).not.toThrow();
    });

    it('logs an expected connection drop at warn, not error', () => {
      const queue = new EventEmitter();
      logRedisClientErrors(queue, 'Queue test');

      queue.emit('error', new Error('Connection is closed.'));

      expect(logWarn).toHaveBeenCalledTimes(1);
      expect(logWarn.mock.calls[0]![0]).toContain('redis connection lost');
      expect(logError).not.toHaveBeenCalled();
    });

    it('logs anything else at error so real queue faults stay visible', () => {
      const queue = new EventEmitter();
      logRedisClientErrors(queue, 'Queue test');

      queue.emit('error', new Error('READONLY You cannot write against a read only replica.'));

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0]![0]).toContain('READONLY');
      expect(logWarn).not.toHaveBeenCalled();
    });
  });
});
