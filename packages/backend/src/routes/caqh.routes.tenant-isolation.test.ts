import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * Regression test for the cross-practice IDOR on the CAQH route surface.
 *
 * The bug: requirePracticeProvider was mounted via `caqhRoutes.use(...)`, which
 * runs before Express parses the :providerId path segment, so the tenant check
 * silently no-opped and any authenticated staffer could read another practice's
 * provider by ID. The fix wires it as a `router.param('providerId', ...)`
 * callback (+ an inline check on the body-only POST /roster).
 *
 * Unlike caqh.routes.test.ts, this file does NOT mock practiceScope.middleware —
 * it exercises the REAL guard so a regression would actually fail the test.
 */

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

// Role layer only — the tenant layer (practiceScope.middleware) is left REAL.
// requireProviderAccess just next()s for staff roles in production anyway.
vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({ setAuditContext: vi.fn() }));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/caqh.service.js', async () => {
  const actual = await vi.importActual<typeof import('../services/caqh.service.js')>('../services/caqh.service.js');
  return {
    ...actual,
    CaqhService: vi.fn().mockImplementation(function () {
      return {
        addToRoster: vi.fn().mockResolvedValue({ caqhProviderId: 'caqh-x', status: 'ACTIVE' }),
        removeFromRoster: vi.fn(),
        checkStatus: vi.fn(),
        syncProvider: vi.fn(),
        getDocumentsList: vi.fn(),
        downloadDocument: vi.fn(),
        isConfigured: vi.fn().mockReturnValue(false),
      };
    }),
  };
});

vi.mock('../services/caqh-credentials.service.js', () => ({
  caqhCredentialsService: {
    verifyCredentials: vi.fn(),
    saveCredentials: vi.fn(),
    getCredentialStatus: vi.fn(),
    verifyAndUpdateProvider: vi.fn(),
  },
  CaqhCredentialsService: vi.fn(),
}));

import { caqhRoutes } from './caqh.routes.js';
import { errorHandler } from '../middleware/error.middleware.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const OWN_PRACTICE = 'practice-A';
const OTHER_PRACTICE = 'practice-B';
const PROVIDER_UUID = '00000000-0000-4000-a000-000000000001';

/** Build an app whose caller is staff scoped to OWN_PRACTICE (or a super-admin). */
function appAs(scope: { isSuperAdmin: boolean; practiceIds: string[] }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-1', role: scope.isSuperAdmin ? 'admin' : 'credentialing_staff' };
    (req as any).practiceScope = scope;
    next();
  });
  app.use(caqhRoutes);
  app.use(errorHandler);
  return app;
}

const staffApp = appAs({ isSuperAdmin: false, practiceIds: [OWN_PRACTICE] });
const adminApp = appAs({ isSuperAdmin: true, practiceIds: [] });

// Representative set of :providerId routes spanning read, write, delete, download, export.
const pathParamRoutes: Array<{ name: string; call: (app: express.Express) => request.Test }> = [
  { name: 'GET /export/:providerId', call: (a) => request(a).get(`/export/${PROVIDER_UUID}`).query({ format: 'json' }) },
  { name: 'GET /import-summary/:providerId', call: (a) => request(a).get(`/import-summary/${PROVIDER_UUID}`) },
  { name: 'GET /credentials/:providerId', call: (a) => request(a).get(`/credentials/${PROVIDER_UUID}`) },
  { name: 'POST /credentials/:providerId', call: (a) => request(a).post(`/credentials/${PROVIDER_UUID}`).send({ username: 'u', password: 'p' }) },
  { name: 'DELETE /roster/:providerId', call: (a) => request(a).delete(`/roster/${PROVIDER_UUID}`) },
  { name: 'GET /status/:providerId', call: (a) => request(a).get(`/status/${PROVIDER_UUID}`) },
  { name: 'POST /pull/:providerId', call: (a) => request(a).post(`/pull/${PROVIDER_UUID}`) },
  { name: 'GET /sync-history/:providerId', call: (a) => request(a).get(`/sync-history/${PROVIDER_UUID}`) },
  { name: 'GET /documents/:providerId', call: (a) => request(a).get(`/documents/${PROVIDER_UUID}`) },
  { name: 'GET /documents/:providerId/download', call: (a) => request(a).get(`/documents/${PROVIDER_UUID}/download`).query({ docUrl: '/d' }) },
];

describe('CAQH tenant isolation (regression: cross-practice IDOR)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('blocks a staffer from touching a provider in ANOTHER practice (403)', () => {
    for (const route of pathParamRoutes) {
      it(`${route.name} → 403`, async () => {
        // The tenant guard reads the provider's practiceId; it belongs to OTHER_PRACTICE.
        prismaMock.providerProfile.findUnique.mockResolvedValue({ practiceId: OTHER_PRACTICE } as any);

        const res = await route.call(staffApp);

        expect(res.status).toBe(403);
        expect(res.body?.error ?? res.body).toBeDefined();
      });
    }

    it('POST /roster (providerId in body) → 403', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ practiceId: OTHER_PRACTICE } as any);

      const res = await request(staffApp).post('/roster').send({ providerId: PROVIDER_UUID });

      expect(res.status).toBe(403);
    });
  });

  describe('lets a staffer reach the handler for a provider in THEIR practice (not 403)', () => {
    it('GET /status/:providerId for own-practice provider is allowed past the guard', async () => {
      // Own practice → guard passes; provider has no CAQH id → handler returns 404 (NOT 403).
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        id: PROVIDER_UUID,
        practiceId: OWN_PRACTICE,
        caqhProviderId: null,
      } as any);

      const res = await request(staffApp).get(`/status/${PROVIDER_UUID}`);

      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404); // CAQH_NOT_REGISTERED — proves the guard let it through
    });

    it('POST /roster for own-practice provider is allowed past the guard', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: PROVIDER_UUID, practiceId: OWN_PRACTICE } as any);
      prismaMock.providerProfile.update.mockResolvedValue({} as any);

      const res = await request(staffApp).post('/roster').send({ providerId: PROVIDER_UUID });

      expect(res.status).not.toBe(403);
    });
  });

  describe('super-admin bypasses tenant scoping', () => {
    it('GET /status/:providerId across practices is NOT blocked for admin', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        id: PROVIDER_UUID,
        practiceId: OTHER_PRACTICE,
        caqhProviderId: null,
      } as any);

      const res = await request(adminApp).get(`/status/${PROVIDER_UUID}`);

      expect(res.status).not.toBe(403);
    });
  });
});
