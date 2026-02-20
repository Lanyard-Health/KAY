import Redis from 'ioredis';
import { logger } from './logger.js';

const MAX_RETRIES = 10;
const MAX_DELAY_MS = 5000;

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
  enableReadyCheck: boolean;
  retryStrategy: (times: number) => number | null;
}

let connection: Redis | null = null;

/**
 * Returns Redis connection config using environment variables with sensible defaults.
 * maxRetriesPerRequest is null as required by BullMQ.
 */
export function getRedisConfig(): RedisConfig {
  const config: RedisConfig = {
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
    logger.info('Redis: connected');
  });

  connection.on('error', (err: Error) => {
    logger.error(`Redis: connection error — ${err.message}`);
  });

  return connection;
}

/**
 * Gracefully closes the shared Redis connection and resets the singleton.
 */
export async function closeRedisConnection(): Promise<void> {
  if (!connection) {
    return;
  }

  await connection.quit();
  connection = null;
  logger.info('Redis: connection closed');
}
