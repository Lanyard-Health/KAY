import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock aws-jwt-verify FIRST — provider.routes imports auth.middleware which imports
// CognitoJwtVerifier at module level. Without this mock, vitest hangs resolving the module.
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({ verify: vi.fn() }),
  },
}));

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
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

// Mock authenticate to pass through — we inject user manually.
// Use async factory to import error classes (ESM-safe). error.middleware has no heavy deps.
vi.mock('../src/middleware/auth.middleware.js', async () => {
  const { ForbiddenError, UnauthorizedError } = await import('../src/middleware/error.middleware.js');
  return {
    authenticate: (_req: any, _res: any, next: any) => next(),
    authorize: (...allowedRoles: string[]) => (req: any, _res: any, next: any) => {
      if (!req.user) return next(new UnauthorizedError('Not authenticated'));
      if (!allowedRoles.includes(req.user.role)) return next(new ForbiddenError('Insufficient permissions'));
      next();
    },
    requireProviderAccess: (req: any, _res: any, next: any) => {
      if (!req.user) return next(new UnauthorizedError('Not authenticated'));
      const { role, providerId: userProviderId } = req.user;
      const requestedProviderId = req.params?.providerId || req.body?.providerId;
      if (role === 'admin' || role === 'credentialing_staff' || role === 'practice_admin') return next();
      if (role === 'provider' && userProviderId === requestedProviderId) return next();
      next(new ForbiddenError('Access denied to this provider'));
    },
    requirePermission: () => (_req: any, _res: any, next: any) => next(),
    ADMIN_ROLES: ['admin'],
  };
});

// Mock practiceScope middleware — requirePracticeProvider uses req.practiceScope
// (already injected by buildApp) and looks up provider via prisma.providerProfile.
vi.mock('../src/middleware/practiceScope.middleware.js', async () => {
  const actual = await import('../src/middleware/practiceScope.middleware.js');
  return {
    // Use the real implementations — they read req.practiceScope which buildApp injects
    requirePracticeProvider: actual.requirePracticeProvider,
    getPracticeProviderFilter: actual.getPracticeProviderFilter,
    getPracticeRelationFilter: actual.getPracticeRelationFilter,
    attachPracticeScope: (_req: any, _res: any, next: any) => next(),
    initPracticeScope: async () => {},
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
    prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-B1', practiceId: 'practice-B' } as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(403);
  });

  it('staff from Practice A CAN GET provider in Practice A → 200', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    // Both middleware and route handler call findUnique
    prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider({ id: 'provider-A1', practiceId: 'practice-A' }) as any);

    const res = await request(app).get('/api/v1/providers/provider-A1');

    expect(res.status).toBe(200);
  });

  it('practice admin from Practice A cannot GET provider in Practice B → 403', async () => {
    const app = buildApp(practiceAdminUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-B1', practiceId: 'practice-B' } as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(403);
  });

  it('provider with practiceId=null is NOT accessible to staff (security: cross-practice isolation)', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider({ id: 'unassigned', practiceId: null }) as any);

    const res = await request(app).get('/api/v1/providers/unassigned');

    expect(res.status).toBe(403);
  });

  it('provider with practiceId=null IS accessible to admin', async () => {
    const app = buildApp(adminUser, { isSuperAdmin: true, practiceIds: [] });

    prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider({ id: 'unassigned', practiceId: null }) as any);

    const res = await request(app).get('/api/v1/providers/unassigned');

    expect(res.status).toBe(200);
  });

  it('admin bypasses all practice filters → 200', async () => {
    const app = buildApp(adminUser, { isSuperAdmin: true, practiceIds: [] });

    prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider({ id: 'provider-B1', practiceId: 'practice-B' }) as any);

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

  it('provider cannot GET their own profile via /providers/:id (role gate) → 403', async () => {
    // The GET /:providerId route authorizes admin/staff/practice_admin only.
    // Providers access their own data through the portal routes instead.
    const app = buildApp(providerUser, { isSuperAdmin: false, practiceIds: [] });

    const res = await request(app).get('/api/v1/providers/provider-record-id');

    expect(res.status).toBe(403);
  });

  it('provider cannot GET another provider profile → 403', async () => {
    const app = buildApp(providerUser, { isSuperAdmin: false, practiceIds: [] });

    // Different provider ID than providerUser.providerId
    prismaMock.providerProfile.findUnique.mockResolvedValue(
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
  it('staff with no practice assignments sees no providers (no-access filter)', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: [] });

    prismaMock.providerProfile.findMany.mockResolvedValue([] as any);
    prismaMock.providerProfile.count.mockResolvedValue(0);

    const res = await request(app).get('/api/v1/providers');

    expect(res.status).toBe(200);
    // getPracticeProviderFilter with empty practiceIds returns no-access filter
    expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: '__no_access__' }),
      }),
    );
  });
});
