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
  authorize: vi.fn((..._roles: string[]) => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../services/ops.service.js', () => ({
  getOpsDashboardStats: vi.fn(),
  getPracticesOverview: vi.fn(),
  getStaffWorkload: vi.fn(),
  getSlaSummary: vi.fn(),
}));

import opsRouter from './ops.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  getOpsDashboardStats,
  getPracticesOverview,
  getStaffWorkload,
  getSlaSummary,
} from '../services/ops.service.js';

describe('Ops Routes', () => {
  const app = createTestApp(opsRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /dashboard', () => {
    it('returns dashboard stats', async () => {
      const mockStats = { totalPractices: 5, totalProviders: 20, activeSla: 15 };
      vi.mocked(getOpsDashboardStats).mockResolvedValue(mockStats);

      const res = await request(app).get('/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockStats);
    });

    it('returns 500 on error', async () => {
      vi.mocked(getOpsDashboardStats).mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/dashboard');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /practices', () => {
    it('returns practices list', async () => {
      const mockData = { items: [{ id: 'p1', name: 'Test Practice' }], total: 1 };
      vi.mocked(getPracticesOverview).mockResolvedValue(mockData);

      const res = await request(app).get('/practices');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockData);
    });

    it('passes query params to service', async () => {
      vi.mocked(getPracticesOverview).mockResolvedValue({ items: [], total: 0 });

      await request(app).get('/practices?search=clinic&serviceTier=premium&page=2&limit=10');

      expect(getPracticesOverview).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'clinic', serviceTier: 'premium', page: 2, limit: 10 }),
      );
    });
  });

  describe('GET /practices/:id', () => {
    it('returns practice detail', async () => {
      const mockPractice = {
        id: 'p1',
        name: 'Test Practice',
        providers: [],
        opsAssignments: [],
        opsWorkItems: [],
      };
      prismaMock.practice.findUnique.mockResolvedValue(mockPractice as any);

      const res = await request(app).get('/practices/p1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('p1');
    });

    it('returns 404 for unknown practice', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/practices/unknown');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /staff', () => {
    it('returns staff list', async () => {
      const mockStaff = [
        { id: 's1', firstName: 'Alice', lastName: 'Smith', openItems: 5 },
      ];
      vi.mocked(getStaffWorkload).mockResolvedValue(mockStaff);

      const res = await request(app).get('/staff');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /staff/:id/workload', () => {
    it('returns individual workload', async () => {
      const mockWorkload = { id: 's1', firstName: 'Alice', openItems: 5 };
      vi.mocked(getStaffWorkload).mockResolvedValue(mockWorkload);

      const res = await request(app).get('/staff/s1/workload');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for unknown staff', async () => {
      vi.mocked(getStaffWorkload).mockResolvedValue([]);

      const res = await request(app).get('/staff/unknown/workload');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /sla', () => {
    it('returns SLA summary', async () => {
      const mockSla = { totalActive: 10, onTrack: 7, atRisk: 2, breached: 1, breachedEnrollments: [] };
      vi.mocked(getSlaSummary).mockResolvedValue(mockSla);

      const res = await request(app).get('/sla');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalActive).toBe(10);
    });

    it('passes filter params', async () => {
      vi.mocked(getSlaSummary).mockResolvedValue({ totalActive: 0, onTrack: 0, atRisk: 0, breached: 0, breachedEnrollments: [] });

      await request(app).get('/sla?practiceId=p1&payerId=pay1');

      expect(getSlaSummary).toHaveBeenCalledWith({ practiceId: 'p1', payerId: 'pay1' });
    });
  });

  describe('GET /sla/breaches', () => {
    it('returns breach list', async () => {
      const mockBreaches = [{ id: 'e1', status: 'breached' }];
      vi.mocked(getSlaSummary).mockResolvedValue({
        totalActive: 1, onTrack: 0, atRisk: 0, breached: 1,
        breachedEnrollments: mockBreaches,
      });

      const res = await request(app).get('/sla/breaches');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });
});
