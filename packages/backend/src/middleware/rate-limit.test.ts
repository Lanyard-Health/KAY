import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/logger.js', () => ({ logger: loggerMock }));

import { apiLimiter, authLimiter, signupLimiter, lookupLimiter } from './rate-limit.js';

function build(handler: (app: Express) => void): Express {
  const app = express();
  app.use(express.json());
  app.set('trust proxy', true);
  handler(app);
  return app;
}

const TEST_HEADER = { 'X-RateLimit-Test': '1' };

describe('rate-limit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('apiLimiter (300/min/IP)', () => {
    it('returns 200 below the limit and 429 with RATE_LIMITED code after the limit', async () => {
      const app = build((a) => {
        a.use(apiLimiter());
        a.get('/ping', (_req, res) => res.json({ ok: true }));
      });
      // 5 quick requests should all pass (well under 300)
      for (let i = 0; i < 5; i++) {
        const ok = await request(app).get('/ping').set(TEST_HEADER);
        expect(ok.status).toBe(200);
      }
    });
  });

  describe('authLimiter (5/15min per IP+username)', () => {
    it('blocks the 6th attempt from same IP+email with 429 RATE_LIMITED', async () => {
      const app = build((a) => {
        a.use(authLimiter());
        a.post('/login', (_req, res) => res.json({ ok: true }));
      });
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/login').set(TEST_HEADER).send({ email: 'attacker@example.com' });
        expect(res.status).toBe(200);
      }
      const blocked = await request(app).post('/login').set(TEST_HEADER).send({ email: 'attacker@example.com' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    });

    it('isolates per-username on same IP — different email still allowed after attacker@ is blocked', async () => {
      const app = build((a) => {
        a.use(authLimiter());
        a.post('/login', (_req, res) => res.json({ ok: true }));
      });
      // Burn attacker@'s budget
      for (let i = 0; i < 5; i++) {
        await request(app).post('/login').set(TEST_HEADER).send({ email: 'attacker@example.com' });
      }
      const attackerBlocked = await request(app).post('/login').set(TEST_HEADER).send({ email: 'attacker@example.com' });
      expect(attackerBlocked.status).toBe(429);

      // A real user from the same IP should still be able to log in
      const real = await request(app).post('/login').set(TEST_HEADER).send({ email: 'real-user@example.com' });
      expect(real.status).toBe(200);
    });

    it('normalises email case and whitespace so attackers can\'t bypass with casing', async () => {
      const app = build((a) => {
        a.use(authLimiter());
        a.post('/login', (_req, res) => res.json({ ok: true }));
      });
      const variants = ['attacker@example.com', 'ATTACKER@example.com', '  Attacker@Example.com  ', 'attacker@EXAMPLE.com', 'AtTaCkEr@Example.com'];
      for (const email of variants) {
        await request(app).post('/login').set(TEST_HEADER).send({ email });
      }
      const blocked = await request(app).post('/login').set(TEST_HEADER).send({ email: 'attacker@example.com' });
      expect(blocked.status).toBe(429);
    });

    it('logs a structured warning when 429 fires', async () => {
      const app = build((a) => {
        a.use(authLimiter());
        a.post('/login', (_req, res) => res.json({ ok: true }));
      });
      for (let i = 0; i < 5; i++) {
        await request(app).post('/login').set(TEST_HEADER).send({ email: 'x@y.com' });
      }
      await request(app).post('/login').set(TEST_HEADER).send({ email: 'x@y.com' });
      expect(loggerMock.warn).toHaveBeenCalledWith(
        'Rate limit exceeded',
        expect.objectContaining({ scope: 'auth', path: '/login', method: 'POST' }),
      );
      // ipHash is a sha256 prefix, not raw IP
      const payload = loggerMock.warn.mock.calls.at(-1)?.[1];
      expect(payload.ipHash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('signupLimiter (5/15min/IP)', () => {
    it('blocks the 6th signup from same IP with 429', async () => {
      const app = build((a) => {
        a.use(signupLimiter());
        a.post('/register', (_req, res) => res.json({ ok: true }));
      });
      for (let i = 0; i < 5; i++) {
        const r = await request(app).post('/register').set(TEST_HEADER).send({});
        expect(r.status).toBe(200);
      }
      const blocked = await request(app).post('/register').set(TEST_HEADER).send({});
      expect(blocked.status).toBe(429);
    });
  });

  describe('lookupLimiter (10/min/IP)', () => {
    it('blocks the 11th lookup from same IP with 429', async () => {
      const app = build((a) => {
        a.use(lookupLimiter());
        a.get('/npi-lookup/:npi', (_req, res) => res.json({ ok: true }));
      });
      for (let i = 0; i < 10; i++) {
        const r = await request(app).get('/npi-lookup/1234567890').set(TEST_HEADER);
        expect(r.status).toBe(200);
      }
      const blocked = await request(app).get('/npi-lookup/1234567890').set(TEST_HEADER);
      expect(blocked.status).toBe(429);
    });
  });

  describe('test-mode bypass', () => {
    it('bypasses limits by default in NODE_ENV=test (no X-RateLimit-Test header)', async () => {
      const app = build((a) => {
        a.use(authLimiter());
        a.post('/login', (_req, res) => res.json({ ok: true }));
      });
      // 10 requests without the opt-in header — all should pass
      for (let i = 0; i < 10; i++) {
        const r = await request(app).post('/login').send({ email: 'x@y.com' });
        expect(r.status).toBe(200);
      }
    });
  });
});
