import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { prismaMock } from '../helpers/mock-prisma.js';
import {
  UnauthorizedError,
  ForbiddenError,
} from '../../src/middleware/error.middleware.js';

// ==========================================
// Mocks
// ==========================================

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

vi.mock('../../src/utils/cache.js', () => ({
  getCached: vi.fn(() => undefined),
  setCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

import opsActivityRoutes from '../../src/routes/ops-activity.routes.js';
import { createTestApp } from '../helpers/test-app.js';
import { adminUser, providerUser, staffUser } from '../helpers/fixtures.js';

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

const mockAuditLogEntry = {
  id: 'log-1',
  userId: 'user-1',
  action: 'update',
  resourceType: 'enrollment',
  resourceId: 'enr-1',
  changes: {},
  timestamp: new Date('2026-02-15T10:00:00Z'),
  user: {
    id: 'user-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@test.com',
  },
};

// ==========================================
// Tests
// ==========================================

describe('Ops Activity Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.findMany.mockResolvedValue([mockAuditLogEntry] as any);
    prismaMock.auditLog.count.mockResolvedValue(1);
  });

  // ==========================================
  // Authorization
  // ==========================================

  describe('Authorization', () => {
    it('returns 200 for admin role', async () => {
      const app = createTestApp(opsActivityRoutes, adminUser);
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('returns 200 for ops_staff role', async () => {
      const app = createTestApp(opsActivityRoutes, opsStaffUser);
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('returns 403 for provider role', async () => {
      const app = createTestApp(opsActivityRoutes, providerUser);
      const res = await request(app).get('/');
      expect(res.status).toBe(403);
    });

    it('returns 403 for credentialing_staff role', async () => {
      const app = createTestApp(opsActivityRoutes, staffUser);
      const res = await request(app).get('/');
      expect(res.status).toBe(403);
    });

    it('returns 401 when no user is set', async () => {
      const app = createTestApp(opsActivityRoutes);
      const res = await request(app).get('/');
      expect(res.status).toBe(401);
    });
  });

  // ==========================================
  // GET / — paginated activity log
  // ==========================================

  describe('GET /', () => {
    it('returns paginated results', async () => {
      const app = createTestApp(opsActivityRoutes, adminUser);
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('items');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('page');
      expect(res.body.data).toHaveProperty('limit');
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
    });

    it('returns default pagination when no query params', async () => {
      const app = createTestApp(opsActivityRoutes, adminUser);
      const res = await request(app).get('/');

      expect(res.body.data.page).toBe(1);
      expect(res.body.data.limit).toBe(50);
    });

    it('accepts custom page and limit', async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      prismaMock.auditLog.count.mockResolvedValue(100);

      const app = createTestApp(opsActivityRoutes, adminUser);
      const res = await request(app).get('/?page=3&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.data.page).toBe(3);
      expect(res.body.data.limit).toBe(10);

      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });

    it('validates page must be >= 1', async () => {
      const app = createTestApp(opsActivityRoutes, adminUser);
      const res = await request(app).get('/?page=0');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('validates limit must be >= 1', async () => {
      const app = createTestApp(opsActivityRoutes, adminUser);
      const res = await request(app).get('/?limit=0');

      expect(res.status).toBe(400);
    });

    it('validates limit must be <= 100', async () => {
      const app = createTestApp(opsActivityRoutes, adminUser);
      const res = await request(app).get('/?limit=200');

      expect(res.status).toBe(400);
    });

    it('filters by staffId', async () => {
      const staffId = '00000000-0000-0000-0000-000000000001';
      const app = createTestApp(opsActivityRoutes, adminUser);
      await request(app).get(`/?staffId=${staffId}`);

      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: staffId,
          }),
        }),
      );
    });

    it('filters by actionType', async () => {
      const app = createTestApp(opsActivityRoutes, adminUser);
      await request(app).get('/?actionType=update');

      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: 'update',
          }),
        }),
      );
    });

    it('filters by date range', async () => {
      const app = createTestApp(opsActivityRoutes, adminUser);
      await request(app).get('/?startDate=2026-02-01&endDate=2026-02-28');

      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });

    it('returns 500 when database query fails', async () => {
      prismaMock.auditLog.findMany.mockRejectedValueOnce(new Error('DB error'));

      const app = createTestApp(opsActivityRoutes, adminUser);
      const res = await request(app).get('/');

      expect(res.status).toBe(500);
    });
  });
});
