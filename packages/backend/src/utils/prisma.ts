import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const SLOW_QUERY_THRESHOLD_MS = 500;

export const prisma = globalThis.prisma ?? new PrismaClient({
  log: process.env['NODE_ENV'] === 'development'
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ]
    : [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
      ],
});

prisma.$on('query' as never, (e: { query: string; params: string; duration: number }) => {
  if (e.duration >= SLOW_QUERY_THRESHOLD_MS) {
    // NEVER log params — they may contain PII (SSN, DOB, tax IDs, banking data)
    logger.warn(`Slow query (${e.duration}ms): ${e.query}`, {
      duration: e.duration,
    });
  }
});

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.prisma = prisma;
}
