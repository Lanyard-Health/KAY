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

vi.mock('../src/services/staff-dashboard.service.js', () => ({
  getStaffDashboard: vi.fn(),
}));

import dashboardRouter from '../src/routes/dashboard.routes.js';
import { getStaffDashboard } from '../src/services/staff-dashboard.service.js';
import { getPracticeProviderFilter } from '../src/middleware/practiceScope.middleware.js';

const mockGetStaffDashboard = getStaffDashboard as ReturnType<typeof vi.fn>;
const mockGetFilter = getPracticeProviderFilter as ReturnType<typeof vi.fn>;

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

const EMPTY_PAYLOAD = {
  tiles: { submittedThisWeek: 0, needsFollowUp: 0, delayed: 0, inIntake: 0 },
  queue: [],
  charts: { pipelineByStage: [], submissionsByWeek: [] },
};

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

describe('GET /staff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFilter.mockReturnValue({ deletedAt: null });
  });

  it('returns 200 for credentialing_staff, scoped to their practice', async () => {
    mockGetStaffDashboard.mockResolvedValue(EMPTY_PAYLOAD);
    const filter = { practiceId: { in: ['mine'] }, deletedAt: null };
    mockGetFilter.mockReturnValue(filter);

    const app = createScopedTestApp(staffUser, { isSuperAdmin: false, practiceIds: ['mine'] });
    const res = await request(app).get('/staff');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: EMPTY_PAYLOAD });
    expect(mockGetStaffDashboard).toHaveBeenCalledWith(filter, { practiceIds: ['mine'], isSuperAdmin: false });
  });

  it('returns 200 for lanyard_staff (all practices, not super admin)', async () => {
    mockGetStaffDashboard.mockResolvedValue(EMPTY_PAYLOAD);

    const app = createScopedTestApp(lanyardStaffUser, { isSuperAdmin: false, practiceIds: ['p1', 'p2'] });
    const res = await request(app).get('/staff');

    expect(res.status).toBe(200);
    expect(mockGetStaffDashboard).toHaveBeenCalledWith(
      { deletedAt: null },
      { practiceIds: ['p1', 'p2'], isSuperAdmin: false },
    );
  });

  it('returns 200 for admin as super admin', async () => {
    mockGetStaffDashboard.mockResolvedValue(EMPTY_PAYLOAD);

    const app = createTestApp(dashboardRouter, adminUser);
    const res = await request(app).get('/staff');

    expect(res.status).toBe(200);
    expect(mockGetStaffDashboard).toHaveBeenCalledWith(
      { deletedAt: null },
      expect.objectContaining({ isSuperAdmin: true }),
    );
  });

  it('returns 403 for practice_admin', async () => {
    const app = createTestApp(dashboardRouter, practiceAdminUser);
    const res = await request(app).get('/staff');

    expect(res.status).toBe(403);
    expect(mockGetStaffDashboard).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const app = express();
    app.use(express.json());
    app.use(dashboardRouter);
    app.use(errorHandler);
    const res = await request(app).get('/staff');

    expect(res.status).toBe(401);
    expect(mockGetStaffDashboard).not.toHaveBeenCalled();
  });

  it('returns 500 when the service throws', async () => {
    mockGetStaffDashboard.mockRejectedValue(new Error('boom'));

    const app = createTestApp(dashboardRouter, adminUser);
    const res = await request(app).get('/staff');

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Failed to fetch staff dashboard');
  });
});
