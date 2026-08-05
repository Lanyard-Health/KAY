import { Redis } from 'ioredis';
import { logger } from './logger.js';

import type { RedisOptions } from 'ioredis';

const MAX_RETRIES = 10;
const MAX_DELAY_MS = 5000;

let connection: Redis | null = null;
let redisAvailable = false;

/**
 * Returns true if a REDIS_URL or REDIS_HOST is configured.
 * When false, Redis-dependent features (BullMQ workers) should be skipped.
 */
export function isRedisConfigured(): boolean {
  return !!(process.env['REDIS_URL'] || process.env['REDIS_HOST']);
}

/**
 * Returns true if Redis has successfully connected at least once.
 */
export function isRedisAvailable(): boolean {
  return redisAvailable;
}

/**
 * Returns Redis connection config using environment variables with sensible defaults.
 * maxRetriesPerRequest is null as required by BullMQ.
 */
export function getRedisConfig(): RedisOptions {
  // If REDIS_URL is set (e.g. from Render), parse it
  if (process.env['REDIS_URL']) {
    return {
      ...parseRedisUrl(process.env['REDIS_URL']),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times: number): number | null {
        if (times > MAX_RETRIES) {
          logger.error(`Redis: max retries (${MAX_RETRIES}) exceeded, giving up`);
          return null;
        }
        const delay = Math.min(Math.pow(2, times) * 100, MAX_DELAY_MS);
        return delay;
      },
    };
  }

  const config: RedisOptions = {
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times: number): number | null {
      if (times > MAX_RETRIES) {
        logger.error(`Redis: max retries (${MAX_RETRIES}) exceeded, giving up`);
        return null;
      }
      const delay = Math.min(Math.pow(2, times) * 100, MAX_DELAY_MS);
      return delay;
    },
  };

  const password = process.env['REDIS_PASSWORD'];
  if (password) {
    config.password = password;
  }

  return config;
}

function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  const opts: RedisOptions = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
  };
  if (parsed.password) {
    opts.password = decodeURIComponent(parsed.password);
  }
  if (parsed.username) {
    opts.username = decodeURIComponent(parsed.username);
  }
  // Render Redis uses TLS on rediss:// URLs
  if (parsed.protocol === 'rediss:') {
    opts.tls = {};
  }
  return opts;
}

/**
 * Returns a shared Redis singleton connection.
 * Logs connect and error events.
 */
export function getRedisConnection(): Redis {
  if (connection) {
    return connection;
  }

  const config = getRedisConfig();
  connection = new Redis(config);

  connection.on('connect', () => {
    redisAvailable = true;
    logger.info('Redis: connected');
  });

  connection.on('error', (err: Error) => {
    logger.error(`Redis: connection error — ${err.message}`);
  });

  return connection;
}

/**
 * Attach an 'error' listener to a BullMQ Queue or Worker.
 *
 * BullMQ forwards its Redis connection errors to an 'error' event
 * (queue-base.js:43, worker.js:129). Node throws when 'error' is emitted with
 * no listener, and BullMQ emits from inside a promise catch —
 * `this.run().catch(error => this.emit('error', error))` (worker.js:116) — so
 * that throw surfaces as an unhandled rejection rather than a clean crash.
 * That is how one dropped connection became ENG-267..ENG-283.
 *
 * Every Queue and Worker must have this attached at construction.
 */
export function logRedisClientErrors(
  client: { on(event: 'error', listener: (err: Error) => void): unknown },
  label: string,
): void {
  client.on('error', (err: Error) => {
    // A connection dropping during a Redis restart, a laptop sleeping, or a
    // graceful shutdown is expected — ioredis rejects every in-flight command
    // with these on socket close. Keep them out of the error stream so they
    // don't drown genuine queue failures.
    if (/Connection is closed|ECONNREFUSED|ECONNRESET|EPIPE/i.test(err.message)) {
      logger.warn(`${label}: redis connection lost — ${err.message}`);
      return;
    }
    logger.error(`${label}: ${err.message}`);
  });
}

/**
 * Gracefully closes the shared Redis connection and resets the singleton.
 */
export async function closeRedisConnection(): Promise<void> {
  if (!connection) {
    return;
  }

  try {
    await connection.quit();
  } catch {
    // Connection may already be dead
  }
  connection = null;
  redisAvailable = false;
  logger.info('Redis: connection closed');
}
