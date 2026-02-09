import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { auditRoutes } from './audit.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const mockAuditLog = {
  id: 'audit-1',
  userId: 'admin-user-id',
  action: 'CREATE',
  resourceType: 'provider',
  resourceId: 'provider-1',
  details: null,
  ipAddress: null,
  timestamp: new Date(),
  user: {
    id: 'admin-user-id',
    email: 'admin@test.com',
    firstName: 'Admin',
    lastName: 'User',
  },
};

describe('Audit Routes', () => {
  const app = createTestApp(auditRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns paginated audit logs', async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([mockAuditLog] as any);
      prismaMock.auditLog.count.mockResolvedValue(1);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.page).toBe(1);
    });

    it('supports filtering by userId', async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      prismaMock.auditLog.count.mockResolvedValue(0);

      await request(app).get('/?userId=admin-user-id');

      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'admin-user-id' }),
        })
      );
    });

    it('supports filtering by resourceType', async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      prismaMock.auditLog.count.mockResolvedValue(0);

      await request(app).get('/?resourceType=provider');

      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceType: 'provider' }),
        })
      );
    });

    it('supports pagination parameters', async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      prismaMock.auditLog.count.mockResolvedValue(0);

      const res = await request(app).get('/?page=2&pageSize=10');

      expect(res.status).toBe(200);
      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
    });
  });

  describe('GET /resource/:type/:id', () => {
    it('returns audit history for a specific resource', async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([mockAuditLog] as any);

      const res = await request(app).get('/resource/provider/provider-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resourceType: 'provider', resourceId: 'provider-1' },
        })
      );
    });

    it('returns empty array when no history exists', async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([]);

      const res = await request(app).get('/resource/provider/unknown');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('GET /user/:userId', () => {
    it('returns paginated audit history for a user', async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([mockAuditLog] as any);
      prismaMock.auditLog.count.mockResolvedValue(1);

      const res = await request(app).get('/user/admin-user-id');

      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
    });
  });

  describe('GET /stats', () => {
    it('returns audit statistics', async () => {
      prismaMock.auditLog.groupBy.mockResolvedValueOnce([
        { action: 'CREATE', _count: { action: 5 } },
        { action: 'UPDATE', _count: { action: 3 } },
      ] as any);
      prismaMock.auditLog.groupBy.mockResolvedValueOnce([
        { resourceType: 'provider', _count: { resourceType: 4 } },
      ] as any);
      prismaMock.auditLog.count.mockResolvedValue(8);

      const res = await request(app).get('/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.byAction).toEqual({ CREATE: 5, UPDATE: 3 });
      expect(res.body.data.byResource).toEqual({ provider: 4 });
      expect(res.body.data.last24Hours).toBe(8);
    });
  });
});
