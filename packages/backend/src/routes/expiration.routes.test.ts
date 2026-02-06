import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, providerUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock ExpirationService — all fns defined inside factory
vi.mock('../services/expiration.service.js', () => ({
  ExpirationService: vi.fn().mockImplementation(() => ({
    getUpcomingExpirations: vi.fn(),
    getDashboardData: vi.fn(),
    getProviderExpirations: vi.fn(),
    sendExpirationReminders: vi.fn(),
  })),
}));

import { expirationRoutes } from './expiration.routes.js';
import { ExpirationService } from '../services/expiration.service.js';

// Get the mock instance created at module level
const expirationServiceInstance = (ExpirationService as any).mock.results[0]?.value;

const mockExpiration = {
  id: 'exp-1',
  type: 'license',
  name: 'state_medical - MD-12345',
  expirationDate: new Date('2025-03-15'),
  daysUntilExpiration: 30,
  providerId: 'provider-1-id',
  providerName: 'Jane Doe',
  providerEmail: 'jane@test.com',
};

describe('Expiration Routes', () => {
  const app = createTestApp(expirationRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns upcoming expirations with default params', async () => {
      expirationServiceInstance.getUpcomingExpirations.mockResolvedValue([mockExpiration]);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(expirationServiceInstance.getUpcomingExpirations).toHaveBeenCalledWith(30, undefined);
    });

    it('respects ?days query param', async () => {
      expirationServiceInstance.getUpcomingExpirations.mockResolvedValue([]);

      await request(app).get('/?days=90');

      expect(expirationServiceInstance.getUpcomingExpirations).toHaveBeenCalledWith(90, undefined);
    });

    it('respects ?type query param', async () => {
      expirationServiceInstance.getUpcomingExpirations.mockResolvedValue([]);

      await request(app).get('/?type=license');

      expect(expirationServiceInstance.getUpcomingExpirations).toHaveBeenCalledWith(30, 'license');
    });

    it('respects both ?days and ?type params', async () => {
      expirationServiceInstance.getUpcomingExpirations.mockResolvedValue([]);

      await request(app).get('/?days=60&type=insurance');

      expect(expirationServiceInstance.getUpcomingExpirations).toHaveBeenCalledWith(60, 'insurance');
    });
  });

  describe('GET /dashboard', () => {
    it('returns dashboard data with counts', async () => {
      expirationServiceInstance.getDashboardData.mockResolvedValue({
        expiring7Days: 2,
        expiring30Days: 10,
        expiring60Days: 18,
        expiring90Days: 25,
        expired: 3,
        byType: { licenses: 5, certifications: 3, insurance: 2 },
        recentExpirations: [mockExpiration],
      });

      const res = await request(app).get('/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.expiring7Days).toBe(2);
      expect(res.body.data.expiring30Days).toBe(10);
      expect(res.body.data.byType).toBeDefined();
    });
  });

  describe('GET /provider/:providerId', () => {
    it('returns provider-specific expirations for admin', async () => {
      expirationServiceInstance.getProviderExpirations.mockResolvedValue([mockExpiration]);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(expirationServiceInstance.getProviderExpirations).toHaveBeenCalledWith('provider-1-id');
    });

    it('returns 403 for provider accessing wrong provider', async () => {
      const providerApp = createTestApp(expirationRoutes, providerUser);

      const res = await request(providerApp).get('/provider/other-provider-id');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('allows provider to access own expirations', async () => {
      const providerApp = createTestApp(expirationRoutes, providerUser);
      expirationServiceInstance.getProviderExpirations.mockResolvedValue([]);

      // providerUser.providerId = 'provider-record-id'
      const res = await request(providerApp).get('/provider/provider-record-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /send-reminders', () => {
    it('sends reminders with default thresholds', async () => {
      expirationServiceInstance.sendExpirationReminders.mockResolvedValue({
        sent: 5,
        failed: 1,
      });

      const res = await request(app).post('/send-reminders');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sent).toBe(5);
      expect(res.body.data.failed).toBe(1);
      expect(expirationServiceInstance.sendExpirationReminders).toHaveBeenCalledWith(
        [90, 60, 30, 14, 7]
      );
    });

    it('sends reminders with custom days param', async () => {
      expirationServiceInstance.sendExpirationReminders.mockResolvedValue({
        sent: 2,
        failed: 0,
      });

      const res = await request(app)
        .post('/send-reminders')
        .send({ days: 30 });

      expect(res.status).toBe(200);
      expect(expirationServiceInstance.sendExpirationReminders).toHaveBeenCalledWith([30]);
    });
  });
});
