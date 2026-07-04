import express from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/test-app.js';
import { adminUser, staffUser, practiceAdminUser } from './helpers/fixtures.js';
import { errorHandler } from '../src/middleware/error.middleware.js';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../src/utils/cache.js', () => ({
  getCached: vi.fn().mockReturnValue(null),
  setCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/middleware/auth.middleware.js', async () => {
  const { UnauthorizedError, ForbiddenError } = await import('../src/middleware/error.middleware.js');
  return {
    authenticate: (req: any, _res: any, next: any) => {
      if (!req.user) {
        return next(new UnauthorizedError('Not authenticated'));
      }
      next();
    },
    authorize: (...allowedRoles: string[]) => (req: any, _res: any, next: any) => {
      if (!req.user) {
        return next(new UnauthorizedError('Not authenticated'));
      }
      const role = req.user.role;
      const allowed = allowedRoles.includes(role)
        || (role === 'lanyard_staff' && allowedRoles.includes('credentialing_staff'));
      if (!allowed) {
        return next(new ForbiddenError('Insufficient permissions'));
      }
      next();
    },
  };
});

vi.mock('../src/middleware/practiceScope.middleware.js', () => ({
  getPracticeProviderFilter: vi.fn().mockReturnValue({ deletedAt: null }),
}));

vi.mock('../src/services/admin-dashboard.service.js', () => ({
  getAdminDashboard: vi.fn(),
}));

vi.mock('../src/services/practice-dashboard.service.js', () => ({
  getPracticeDashboard: vi.fn(),
}));

import dashboardRouter from '../src/routes/dashboard.routes.js';
import { getAdminDashboard } from '../src/services/admin-dashboard.service.js';
import { getPracticeDashboard } from '../src/services/practice-dashboard.service.js';

const mockGetAdminDashboard = getAdminDashboard as ReturnType<typeof vi.fn>;
const mockGetPracticeDashboard = getPracticeDashboard as ReturnType<typeof vi.fn>;

const lanyardStaffUser = {
  id: 'lanyard-staff-user-id',
  cognitoId: 'lanyard-staff-cognito-id',
  email: 'lanyardstaff@test.com',
  firstName: 'Lanyard',
  lastName: 'Staff',
  role: 'lanyard_staff' as const,
  isActive: true,
  providerId: undefined,
};

/**
 * Builds a test app with a fully custom practiceScope (createTestApp only derives
 * scope from role: admin -> super admin, everyone else -> empty practiceIds).
 * Needed for the view-as authorization test, where a practice_admin's scope
 * must contain a specific practiceId ('mine').
 */
function createScopedTestApp(
  user: Record<string, unknown>,
  practiceScope: { isSuperAdmin: boolean; practiceIds: string[] },
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user as any;
    req.practiceScope = practiceScope;
    next();
  });
  app.use(dashboardRouter);
  app.use(errorHandler);
  return app;
}

describe('GET /admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with admin dashboard payload for role admin', async () => {
    const mockPayload = {
      tiles: { activePractices: 1, openApplications: 2, approvedThisQuarter: 3, delayedPlatformWide: 0 },
      churnRisk: [],
    };
    mockGetAdminDashboard.mockResolvedValue(mockPayload);

    const app = createTestApp(dashboardRouter, adminUser);
    const res = await request(app).get('/admin');

    expect(res.status).toBe(200);
    expect(res.body.data.tiles).toEqual(mockPayload.tiles);
  });

  it('returns 200 for role lanyard_staff', async () => {
    const mockPayload = {
      tiles: { activePractices: 1, openApplications: 0, approvedThisQuarter: 0, delayedPlatformWide: 0 },
      churnRisk: [],
    };
    mockGetAdminDashboard.mockResolvedValue(mockPayload);

    const app = createScopedTestApp(lanyardStaffUser, { isSuperAdmin: false, practiceIds: ['p1', 'p2'] });
    const res = await request(app).get('/admin');

    expect(res.status).toBe(200);
  });

  it('returns 403 for role practice_admin', async () => {
    const app = createTestApp(dashboardRouter, practiceAdminUser);
    const res = await request(app).get('/admin');

    expect(res.status).toBe(403);
    expect(mockGetAdminDashboard).not.toHaveBeenCalled();
  });
});

describe('GET /practice — view-as practiceId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403s when a practice_admin passes a practiceId outside their own scope', async () => {
    const app = createScopedTestApp(practiceAdminUser, { isSuperAdmin: false, practiceIds: ['mine'] });
    const res = await request(app).get('/practice?practiceId=other');

    expect(res.status).toBe(403);
    expect(mockGetPracticeDashboard).not.toHaveBeenCalled();
  });

  it('200s for an admin viewing-as a specific practice, scoping the provider filter', async () => {
    const mockPayload = { tiles: {}, providers: [] };
    mockGetPracticeDashboard.mockResolvedValue(mockPayload);

    const app = createTestApp(dashboardRouter, adminUser);
    const res = await request(app).get('/practice?practiceId=p1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: mockPayload });
    expect(mockGetPracticeDashboard).toHaveBeenCalledWith(
      { practiceId: { in: ['p1'] }, deletedAt: null },
      { practiceIds: ['p1'], isSuperAdmin: false },
    );
  });
});
