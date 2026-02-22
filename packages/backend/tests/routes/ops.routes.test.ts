import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  UnauthorizedError,
  ForbiddenError,
} from '../../src/middleware/error.middleware.js';

// ==========================================
// Hoisted mocks
// ==========================================

const {
  mockGetOpsDashboardStats,
  mockGetPracticesOverview,
  mockGetStaffWorkload,
  mockGetSlaSummary,
} = vi.hoisted(() => ({
  mockGetOpsDashboardStats: vi.fn(),
  mockGetPracticesOverview: vi.fn(),
  mockGetStaffWorkload: vi.fn(),
  mockGetSlaSummary: vi.fn(),
}));

vi.mock('../../src/services/ops.service.js', () => ({
  getOpsDashboardStats: mockGetOpsDashboardStats,
  getPracticesOverview: mockGetPracticesOverview,
  getStaffWorkload: mockGetStaffWorkload,
  getSlaSummary: mockGetSlaSummary,
}));

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  authorize:
    (...allowedRoles: string[]) =>
    (req: any, _res: any, next: any) => {
      if (!req.user) return next(new UnauthorizedError('Not authenticated'));
      if (!allowedRoles.includes(req.user.role))
        return next(new ForbiddenError('Insufficient permissions'));
      next();
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import opsRoutes from '../../src/routes/ops.routes.js';
import { createTestApp } from '../helpers/test-app.js';
import { adminUser, staffUser, providerUser } from '../helpers/fixtures.js';

// ==========================================
// Fixtures
// ==========================================

const opsStaffUser = {
  id: 'ops-staff-id',
  cognitoId: 'ops-cognito-id',
  email: 'ops@test.com',
  firstName: 'Ops',
  lastName: 'Staff',
  role: 'ops_staff' as const,
  isActive: true,
  providerId: undefined,
};

const dashboardStats = {
  totalPractices: 5,
  byServiceTier: { full_service: 3, self_serve: 2 },
  totalProviders: 10,
  providersByStatus: { active: 8, inactive: 2 },
  totalEnrollments: 15,
  enrollmentsByStatus: { approved: 5, submitted: 10 },
  slaHealth: { onTrack: 10, atRisk: 3, breached: 2 },
  workItems: { total: 8, byStatus: { todo: 5, in_progress: 3 } },
};

const practicesOverview = {
  practices: [
    {
      id: 'p1',
      name: 'Test Practice',
      serviceTier: 'full_service',
      slaTargetDays: 30,
      providerCount: 3,
      enrollmentCount: 5,
      primaryOpsStaff: { firstName: 'John', lastName: 'Doe' },
      lastActivity: new Date().toISOString(),
      slaHealth: { atRisk: 1, breached: 0 },
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
};

// ==========================================
// Tests
// ==========================================

describe('Ops Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOpsDashboardStats.mockResolvedValue(dashboardStats);
    mockGetPracticesOverview.mockResolvedValue(practicesOverview);
    mockGetStaffWorkload.mockResolvedValue([]);
    mockGetSlaSummary.mockResolvedValue({
      totalActive: 0,
      onTrack: 0,
      atRisk: 0,
      breached: 0,
      breachedEnrollments: [],
    });
  });

  // ==========================================
  // Authorization
  // ==========================================

  describe('Authorization', () => {
    it('returns 200 for admin user on /dashboard', async () => {
      const app = createTestApp(opsRoutes, adminUser);
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(200);
    });

    it('returns 200 for ops_staff user on /dashboard', async () => {
      const app = createTestApp(opsRoutes, opsStaffUser);
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(200);
    });

    it('returns 403 for provider role on /dashboard', async () => {
      const app = createTestApp(opsRoutes, providerUser);
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(403);
    });

    it('returns 403 for credentialing_staff role on /dashboard', async () => {
      const app = createTestApp(opsRoutes, staffUser);
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(403);
    });

    it('returns 401 when no user is set', async () => {
      const app = createTestApp(opsRoutes);
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(401);
    });

    it('returns 403 for provider role on /practices', async () => {
      const app = createTestApp(opsRoutes, providerUser);
      const res = await request(app).get('/practices');
      expect(res.status).toBe(403);
    });

    it('returns 403 for credentialing_staff role on /practices', async () => {
      const app = createTestApp(opsRoutes, staffUser);
      const res = await request(app).get('/practices');
      expect(res.status).toBe(403);
    });
  });

  // ==========================================
  // GET /dashboard
  // ==========================================

  describe('GET /dashboard', () => {
    it('returns stats for admin', async () => {
      const app = createTestApp(opsRoutes, adminUser);
      const res = await request(app).get('/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(dashboardStats);
    });

    it('returns 500 when service throws', async () => {
      mockGetOpsDashboardStats.mockRejectedValueOnce(new Error('DB error'));
      const app = createTestApp(opsRoutes, adminUser);
      const res = await request(app).get('/dashboard');

      expect(res.status).toBe(500);
    });
  });

  // ==========================================
  // GET /practices
  // ==========================================

  describe('GET /practices', () => {
    it('returns paginated practice list', async () => {
      const app = createTestApp(opsRoutes, adminUser);
      const res = await request(app).get('/practices');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.practices).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
    });

    it('passes search and serviceTier query params to service', async () => {
      const app = createTestApp(opsRoutes, adminUser);
      await request(app).get('/practices?search=clinic&serviceTier=full_service&page=2&limit=10');

      expect(mockGetPracticesOverview).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'clinic',
          serviceTier: 'full_service',
          page: 2,
          limit: 10,
        }),
      );
    });

    it('returns 400 for invalid page (page=0)', async () => {
      const app = createTestApp(opsRoutes, adminUser);
      const res = await request(app).get('/practices?page=0');

      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // GET /staff
  // ==========================================

  describe('GET /staff', () => {
    it('returns staff workload list', async () => {
      mockGetStaffWorkload.mockResolvedValue([
        { id: 's1', firstName: 'Jane', lastName: 'Smith', openItems: 5 },
      ]);
      const app = createTestApp(opsRoutes, adminUser);
      const res = await request(app).get('/staff');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  // ==========================================
  // GET /sla
  // ==========================================

  describe('GET /sla', () => {
    it('returns SLA summary', async () => {
      const app = createTestApp(opsRoutes, adminUser);
      const res = await request(app).get('/sla');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('totalActive');
      expect(res.body.data).toHaveProperty('onTrack');
      expect(res.body.data).toHaveProperty('breached');
    });

    it('passes practiceId and payerId filters', async () => {
      const app = createTestApp(opsRoutes, adminUser);
      await request(app).get('/sla?practiceId=p1&payerId=payer-1');

      expect(mockGetSlaSummary).toHaveBeenCalledWith({
        practiceId: 'p1',
        payerId: 'payer-1',
      });
    });
  });
});
