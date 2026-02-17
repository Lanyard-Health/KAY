import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/utils/cache.js', () => ({
  invalidateCache: vi.fn(),
  getCached: vi.fn().mockReturnValue(undefined),
  setCache: vi.fn(),
}));

vi.mock('../src/utils/queryValidation.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return actual;
});

// Mock authenticate to just pass through — we inject user manually
vi.mock('../src/middleware/auth.middleware.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (_req: any, _res: any, next: any) => next(),
  };
});

// Mock audit middleware to no-op
vi.mock('../src/middleware/audit.middleware.js', () => ({
  setAuditContext: () => (_req: any, _res: any, next: any) => next(),
}));

import { prismaMock } from './helpers/mock-prisma.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { providerRoutes } from '../src/routes/provider.routes.js';
import { adminUser, staffUser, providerUser, practiceAdminUser } from './helpers/fixtures.js';

// ==========================================
// Helpers
// ==========================================

function buildApp(user: Record<string, unknown>, practiceScope: { isSuperAdmin: boolean; practiceIds: string[] }) {
  const app = express();
  app.use(express.json());

  // Inject user + practice scope before routes
  app.use((req, _res, next) => {
    req.user = user as any;
    req.practiceScope = practiceScope;
    next();
  });

  app.use('/api/v1/providers', providerRoutes);
  app.use(errorHandler);
  return app;
}

// Full provider record for GET /:providerId responses
function fullProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-A1',
    npi: '1111111111',
    firstName: 'Alice',
    lastName: 'Smith',
    practiceId: 'practice-A',
    email: 'alice@test.com',
    status: 'active',
    addresses: [],
    practiceLocations: [],
    licenses: [],
    boardCertifications: [],
    malpracticeInsurances: [],
    educations: [],
    documents: [],
    payerEnrollments: [],
    checklist: null,
    workHistories: [],
    hospitalAffiliations: [],
    professionalReferences: [],
    deaRegistrations: [],
    continuingEducations: [],
    disciplinaryActions: [],
    additionalIdentifiers: [],
    bankingInformation: [],
    demographics: null,
    practice: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ==========================================
// Cross-Practice Isolation
// ==========================================

describe('Authorization Boundaries — Cross-Practice Isolation', () => {
  it('staff from Practice A cannot GET provider in Practice B → 403', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    // requirePracticeProvider looks up the provider first
    prismaMock.provider.findUnique.mockResolvedValue({ id: 'provider-B1', practiceId: 'practice-B' } as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(403);
  });

  it('staff from Practice A CAN GET provider in Practice A → 200', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    // Both middleware and route handler call findUnique
    prismaMock.provider.findUnique.mockResolvedValue(fullProvider({ id: 'provider-A1', practiceId: 'practice-A' }) as any);

    const res = await request(app).get('/api/v1/providers/provider-A1');

    expect(res.status).toBe(200);
  });

  it('practice admin from Practice A cannot GET provider in Practice B → 403', async () => {
    const app = buildApp(practiceAdminUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    prismaMock.provider.findUnique.mockResolvedValue({ id: 'provider-B1', practiceId: 'practice-B' } as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(403);
  });

  it('provider with practiceId=null is accessible to all staff (deliberate design)', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    prismaMock.provider.findUnique.mockResolvedValue(fullProvider({ id: 'unassigned', practiceId: null }) as any);

    const res = await request(app).get('/api/v1/providers/unassigned');

    expect(res.status).toBe(200);
  });

  it('admin bypasses all practice filters → 200', async () => {
    const app = buildApp(adminUser, { isSuperAdmin: true, practiceIds: [] });

    prismaMock.provider.findUnique.mockResolvedValue(fullProvider({ id: 'provider-B1', practiceId: 'practice-B' }) as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(200);
  });
});

// ==========================================
// Provider Self-Scope
// ==========================================

describe('Authorization Boundaries — Provider Self-Scope', () => {
  it('provider cannot list all providers (role gate) → 403', async () => {
    const app = buildApp(providerUser, { isSuperAdmin: false, practiceIds: [] });

    const res = await request(app).get('/api/v1/providers');

    expect(res.status).toBe(403);
  });

  it('provider can GET their own profile → 200', async () => {
    const app = buildApp(providerUser, { isSuperAdmin: false, practiceIds: [] });

    // providerUser.providerId = 'provider-record-id'
    prismaMock.provider.findUnique.mockResolvedValue(
      fullProvider({ id: 'provider-record-id', practiceId: null }) as any
    );

    const res = await request(app).get('/api/v1/providers/provider-record-id');

    expect(res.status).toBe(200);
  });

  it('provider cannot GET another provider profile → 403', async () => {
    const app = buildApp(providerUser, { isSuperAdmin: false, practiceIds: [] });

    // Different provider ID than providerUser.providerId
    prismaMock.provider.findUnique.mockResolvedValue(
      fullProvider({ id: 'other-provider', practiceId: null }) as any
    );

    const res = await request(app).get('/api/v1/providers/other-provider');

    expect(res.status).toBe(403);
  });
});

// ==========================================
// Staff with No Practice Assignments
// ==========================================

describe('Authorization Boundaries — Edge Cases', () => {
  it('staff with no practice assignments sees only unassigned providers in list', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: [] });

    prismaMock.provider.findMany.mockResolvedValue([{ id: 'unassigned', practiceId: null }] as any);
    prismaMock.provider.count.mockResolvedValue(1);

    const res = await request(app).get('/api/v1/providers');

    expect(res.status).toBe(200);
    // getPracticeProviderFilter with empty practiceIds returns { practiceId: null }
    expect(prismaMock.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ practiceId: null }),
      }),
    );
  });
});
