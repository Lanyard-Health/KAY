import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

import { authenticateApiKey, hashApiKey, API_KEY_PREFIX } from './apiKey.middleware.js';
import { errorHandler } from './error.middleware.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { setAuditContext } from './audit.middleware.js';

const PRACTICE_A = '11111111-1111-1111-1111-111111111111';
const RAW_KEY = `${API_KEY_PREFIX}${'a'.repeat(64)}`;

const VALID_KEY_ROW = {
  id: 'key-1',
  practiceId: PRACTICE_A,
  user: {
    id: 'svc-user-1',
    cognitoId: 'apikey:acme-health',
    email: 'apikey+acme-health@lanyardhealth.com',
    role: 'practice_admin',
  },
};

// Echoes back what the middleware attached, so assertions read the real state.
function buildApp() {
  const app = express();
  app.get('/probe', authenticateApiKey, (req, res) => {
    res.json({ user: req.user, practiceScope: req.practiceScope });
  });
  app.post('/probe', authenticateApiKey, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('authenticateApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rejects', () => {
    it('a missing Authorization header', async () => {
      const res = await request(buildApp()).get('/probe');
      expect(res.status).toBe(401);
    });

    it('a token without the lyd_live_ prefix, without hitting the database', async () => {
      const res = await request(buildApp())
        .get('/probe')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.fake.jwt');
      expect(res.status).toBe(401);
      expect(prismaMock.apiKey.findFirst).not.toHaveBeenCalled();
    });

    it('a non-GET request before authenticating it', async () => {
      const res = await request(buildApp())
        .post('/probe')
        .set('Authorization', `Bearer ${RAW_KEY}`);
      expect(res.status).toBe(403);
      expect(prismaMock.apiKey.findFirst).not.toHaveBeenCalled();
    });

    // The revoked / expired / dead-practice / inactive-owner cases are all
    // expressed as `where` predicates, so each one surfaces as findFirst
    // returning null. What matters is that the query carries every predicate —
    // asserted separately below — and that a miss is a 401.
    it('a key that matches no row', async () => {
      prismaMock.apiKey.findFirst.mockResolvedValue(null);
      const res = await request(buildApp())
        .get('/probe')
        .set('Authorization', `Bearer ${RAW_KEY}`);
      expect(res.status).toBe(401);
    });

    it('with an identical message regardless of why, leaking no oracle', async () => {
      prismaMock.apiKey.findFirst.mockResolvedValue(null);
      const miss = await request(buildApp())
        .get('/probe')
        .set('Authorization', `Bearer ${API_KEY_PREFIX}${'b'.repeat(64)}`);
      const badPrefix = await request(buildApp())
        .get('/probe')
        .set('Authorization', 'Bearer nope');
      expect(miss.body.error.message).toBe(badPrefix.body.error.message);
    });

    it('fails closed when the database throws', async () => {
      prismaMock.apiKey.findFirst.mockRejectedValue(new Error('connection lost'));
      const res = await request(buildApp())
        .get('/probe')
        .set('Authorization', `Bearer ${RAW_KEY}`);
      expect(res.status).toBe(401);
    });
  });

  describe('lookup query', () => {
    it('constrains on revocation, expiry, practice liveness and owner activity', async () => {
      prismaMock.apiKey.findFirst.mockResolvedValue(null);
      await request(buildApp()).get('/probe').set('Authorization', `Bearer ${RAW_KEY}`);

      const where = prismaMock.apiKey.findFirst.mock.calls[0]![0]!.where as Record<string, any>;
      expect(where['tokenHash']).toBe(hashApiKey(RAW_KEY));
      expect(where['revokedAt']).toBeNull();
      expect(where['expiresAt']).toHaveProperty('gt');
      expect(where['practice']).toEqual({ deletedAt: null, status: 'ACTIVE' });
      expect(where['user']).toEqual({ isActive: true });
    });

    it('never stores or queries the raw key', async () => {
      prismaMock.apiKey.findFirst.mockResolvedValue(null);
      await request(buildApp()).get('/probe').set('Authorization', `Bearer ${RAW_KEY}`);
      expect(JSON.stringify(prismaMock.apiKey.findFirst.mock.calls[0])).not.toContain(RAW_KEY);
    });
  });

  describe('accepts a valid key and', () => {
    beforeEach(() => {
      prismaMock.apiKey.findFirst.mockResolvedValue(VALID_KEY_ROW as never);
    });

    it('scopes it to exactly one practice, without super-admin', async () => {
      const res = await request(buildApp())
        .get('/probe')
        .set('Authorization', `Bearer ${RAW_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.practiceScope).toEqual({
        isSuperAdmin: false,
        practiceIds: [PRACTICE_A],
      });
    });

    it('never carries a cross-practice role', async () => {
      const res = await request(buildApp())
        .get('/probe')
        .set('Authorization', `Bearer ${RAW_KEY}`);

      // admin grants isSuperAdmin; lanyard_staff can read any practice via
      // ?practiceId= on the dashboard route. Neither may ever back an API key.
      expect(res.body.user.role).not.toBe('admin');
      expect(res.body.user.role).not.toBe('lanyard_staff');
    });

    it('attributes the request to the service account for the audit trail', async () => {
      const res = await request(buildApp())
        .get('/probe')
        .set('Authorization', `Bearer ${RAW_KEY}`);
      expect(res.body.user.id).toBe('svc-user-1');
    });

    it('records the key id under a field name the audit sanitizer will not redact', async () => {
      await request(buildApp()).get('/probe').set('Authorization', `Bearer ${RAW_KEY}`);
      expect(setAuditContext).toHaveBeenCalledWith(
        expect.anything(),
        { changes: { apiKeyId: 'key-1' } }
      );
    });
  });
});

describe('containment', () => {
  // The ONLY thing keeping partner keys off the other ~55 routers is that they
  // authenticate through a different middleware. If a future refactor teaches
  // authenticate() about api keys, every authenticated route accepts them.
  it('keeps api-key handling out of the Cognito auth middleware', () => {
    const source = readFileSync(join(__dirname, 'auth.middleware.ts'), 'utf8');
    expect(source.toLowerCase()).not.toContain('apikey');
    expect(source).not.toContain(API_KEY_PREFIX);
  });
});
