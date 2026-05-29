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

vi.mock('../utils/cache.js', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
}));

import dashboardRouter from './dashboard.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { getCached } from '../utils/cache.js';

const mockStatusCounts = [
  { status: 'active', _count: 10 },
  { status: 'pending', _count: 3 },
  { status: 'inactive', _count: 2 },
];

const mockIncompleteProviders = [
  {
    id: 'provider-1',
    firstName: 'Jane',
    lastName: 'Doe',
    _count: { documents: 0, licenses: 1, boardCertifications: 0 },
  },
  {
    id: 'provider-2',
    firstName: 'John',
    lastName: 'Smith',
    _count: { documents: 2, licenses: 0, boardCertifications: 1 },
  },
];

const mockNeedsFollowUp = [
  {
    id: 'enrollment-1',
    status: 'submitted',
    lastFollowUpDate: null,
    payer: { name: 'Blue Cross Blue Shield' },
    provider: { firstName: 'Jane', lastName: 'Doe' },
  },
];

describe('Dashboard Routes', () => {
  const app = createTestApp(dashboardRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /stats', () => {
    it('returns dashboard stats successfully', async () => {
      prismaMock.providerProfile.groupBy.mockResolvedValue(mockStatusCounts as any);
      prismaMock.providerProfile.findMany.mockResolvedValue(mockIncompleteProviders as any);
      prismaMock.providerProfile.count.mockResolvedValue(2);
      prismaMock.enrollment.findMany.mockResolvedValue(mockNeedsFollowUp as any);
      prismaMock.enrollment.count.mockResolvedValue(1);

      const res = await request(app).get('/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalProviders).toBe(15);
      expect(res.body.data.activeProviders).toBe(10);
      expect(res.body.data.pendingProviders).toBe(3);
      expect(res.body.data.incompleteProviders).toHaveLength(2);
      expect(res.body.data.incompleteCount).toBe(2);
      expect(res.body.data.needsFollowUp).toHaveLength(1);
      expect(res.body.data.followUpCount).toBe(1);
    });

    it('returns cached data when available', async () => {
      const cachedData = {
        totalProviders: 20,
        activeProviders: 15,
        pendingProviders: 5,
        incompleteProviders: [],
        incompleteCount: 0,
        needsFollowUp: [],
        followUpCount: 0,
      };

      vi.mocked(getCached).mockReturnValueOnce(cachedData);

      const res = await request(app).get('/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(cachedData);
      expect(prismaMock.providerProfile.groupBy).not.toHaveBeenCalled();
      expect(prismaMock.providerProfile.findMany).not.toHaveBeenCalled();
      expect(prismaMock.providerProfile.count).not.toHaveBeenCalled();
      expect(prismaMock.enrollment.findMany).not.toHaveBeenCalled();
      expect(prismaMock.enrollment.count).not.toHaveBeenCalled();
    });

    it('returns 500 on error', async () => {
      prismaMock.providerProfile.groupBy.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app).get('/stats');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Failed to fetch dashboard stats');
    });
  });
});
