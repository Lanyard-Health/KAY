import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';

const isTest = process.env['NODE_ENV'] === 'test';
const isDev = process.env['NODE_ENV'] === 'development';

const hashKey = (input: string): string =>
  createHash('sha256').update(input).digest('hex').slice(0, 16);

function shouldBypass(req: Request): boolean {
  // Vitest: always bypass unless the test sets X-RateLimit-Test=1 (opt-in for limiter tests)
  if (isTest) return req.header('x-ratelimit-test') !== '1';
  // Dev: bypass only when caller is using the dev-role header (E2E + local UI sessions)
  if (isDev) {
    const devRole = req.header('x-dev-role') ?? req.header('X-Dev-Role');
    return Boolean(devRole);
  }
  return false;
}

function logBlocked(scope: string) {
  return (req: Request, res: Response, _next: NextFunction, options: Options) => {
    const ipKey = hashKey(req.ip ?? 'unknown');
    logger.warn('Rate limit exceeded', {
      scope,
      ipHash: ipKey,
      path: req.path,
      method: req.method,
      windowMs: options.windowMs,
      limit: typeof options.max === 'number' ? options.max : undefined,
    });
    res.status(429).json({
      success: false,
      error: { message: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
    });
  };
}

interface LimiterConfig {
  scope: string;
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

function buildLimiter(cfg: LimiterConfig) {
  return rateLimit({
    windowMs: cfg.windowMs,
    max: cfg.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => shouldBypass(req),
    keyGenerator: cfg.keyGenerator ?? ((req) => req.ip ?? 'unknown'),
    handler: logBlocked(cfg.scope),
  });
}

/** Global API limiter: 300 req/min per IP — replaces the 1000/15min default. */
export const apiLimiter = () =>
  buildLimiter({ scope: 'api.global', windowMs: 60 * 1000, max: 300 });

/**
 * Auth-adjacent limiter: 5 attempts / 15min per compound (IP, username) key.
 * Prevents credential stuffing from rotating IPs and from single IP hitting many accounts.
 * Falls back to IP-only when no username present (e.g. logout).
 */
export const authLimiter = () =>
  buildLimiter({
    scope: 'auth',
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => {
      const ip = req.ip ?? 'unknown';
      const username =
        (typeof req.body?.email === 'string' && req.body.email.toLowerCase().trim()) ||
        (typeof req.body?.username === 'string' && req.body.username.toLowerCase().trim()) ||
        '';
      return username ? `${ip}|${hashKey(username)}` : ip;
    },
  });

/** Signup / portal registration: 5 per 15min per IP. */
export const signupLimiter = () =>
  buildLimiter({ scope: 'signup', windowMs: 15 * 60 * 1000, max: 5 });

/** Public lookup endpoints (NPI, payer list): 10 / min per IP. */
export const lookupLimiter = () =>
  buildLimiter({ scope: 'lookup', windowMs: 60 * 1000, max: 10 });

/** Portal lookup (NPI status check): 10 / 5min per IP — tighter than lookup to reduce enumeration. */
export const portalLookupLimiter = () =>
  buildLimiter({ scope: 'portal.lookup', windowMs: 5 * 60 * 1000, max: 10 });
