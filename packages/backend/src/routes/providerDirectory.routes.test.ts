import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

const {
  mockVerifyProvider,
  mockVerifyProviderAllPayers,
  mockGetProviderDirectoryStatus,
  mockGetSnapshots,
  mockResolveAlert,
  mockGetConfiguredPayers,
} = vi.hoisted(() => ({
  mockVerifyProvider: vi.fn(),
  mockVerifyProviderAllPayers: vi.fn(),
  mockGetProviderDirectoryStatus: vi.fn(),
  mockGetSnapshots: vi.fn(),
  mockResolveAlert: vi.fn(),
  mockGetConfiguredPayers: vi.fn(),
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../services/providerDirectory.service.js', () => ({
  verifyProvider: mockVerifyProvider,
  verifyProviderAllPayers: mockVerifyProviderAllPayers,
  getProviderDirectoryStatus: mockGetProviderDirectoryStatus,
  getSnapshots: mockGetSnapshots,
  resolveAlert: mockResolveAlert,
  getConfiguredPayers: mockGetConfiguredPayers,
}));

import providerDirectoryRouter from './providerDirectory.routes.js';

describe('Provider Directory Routes', () => {
  const app = createTestApp(providerDirectoryRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /configured-payers', () => {
    it('returns list of configured payers', async () => {
      const payers = [
        { id: 'aetna', name: 'Aetna', adapter: 'aetna_web' },
        { id: 'uhc', name: 'UnitedHealthcare', adapter: 'uhc_web' },
      ];
      mockGetConfiguredPayers.mockReturnValue(payers);

      const res = await request(app).get('/configured-payers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('returns empty array when no payers configured', async () => {
      mockGetConfiguredPayers.mockReturnValue([]);

      const res = await request(app).get('/configured-payers');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('POST /:providerId/verify', () => {
    it('verifies provider against a specific payer', async () => {
      const snapshot = {
        id: 'snap-1',
        providerId: 'p1',
        payerId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'listed',
      };
      mockVerifyProvider.mockResolvedValue(snapshot);

      const res = await request(app)
        .post('/provider-1/verify')
        .send({ payerId: '550e8400-e29b-41d4-a716-446655440000' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockVerifyProvider).toHaveBeenCalledWith(
        'provider-1',
        '550e8400-e29b-41d4-a716-446655440000'
      );
    });

    it('returns error for invalid payerId (not UUID)', async () => {
      const res = await request(app)
        .post('/provider-1/verify')
        .send({ payerId: 'not-a-uuid' });

      expect(res.status).toBe(400); // Zod throws, error middleware returns 400
    });

    it('returns error when payerId is missing', async () => {
      const res = await request(app)
        .post('/provider-1/verify')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /:providerId/verify-all', () => {
    it('verifies provider against all configured payers', async () => {
      const snapshots = [
        { id: 'snap-1', payerId: 'p1', status: 'listed' },
        { id: 'snap-2', payerId: 'p2', status: 'not_listed' },
      ];
      mockVerifyProviderAllPayers.mockResolvedValue(snapshots);

      const res = await request(app).post('/provider-1/verify-all');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(mockVerifyProviderAllPayers).toHaveBeenCalledWith('provider-1');
    });

    it('returns 500 on service error', async () => {
      mockVerifyProviderAllPayers.mockRejectedValue(new Error('Network timeout'));

      const res = await request(app).post('/provider-1/verify-all');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /:providerId/status', () => {
    it('returns directory status for provider', async () => {
      const status = {
        snapshots: [{ id: 's1', status: 'listed' }],
        alerts: [],
        summary: { totalPayers: 2, listed: 1, notListed: 1 },
      };
      mockGetProviderDirectoryStatus.mockResolvedValue(status);

      const res = await request(app).get('/provider-1/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary.totalPayers).toBe(2);
    });
  });

  describe('GET /:providerId/snapshots', () => {
    it('returns paginated snapshot history', async () => {
      const snapshots = [{ id: 's1' }, { id: 's2' }];
      mockGetSnapshots.mockResolvedValue(snapshots);

      const res = await request(app).get('/provider-1/snapshots');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(mockGetSnapshots).toHaveBeenCalledWith('provider-1', undefined, 20, 0);
    });

    it('passes custom limit and offset', async () => {
      mockGetSnapshots.mockResolvedValue([]);

      await request(app).get('/provider-1/snapshots?limit=50&offset=10');

      expect(mockGetSnapshots).toHaveBeenCalledWith('provider-1', undefined, 50, 10);
    });

    it('caps limit at 100', async () => {
      mockGetSnapshots.mockResolvedValue([]);

      await request(app).get('/provider-1/snapshots?limit=999');

      expect(mockGetSnapshots).toHaveBeenCalledWith('provider-1', undefined, 100, 0);
    });

    it('filters by payerId when provided', async () => {
      mockGetSnapshots.mockResolvedValue([]);
      const payerId = '550e8400-e29b-41d4-a716-446655440000';

      await request(app).get(`/provider-1/snapshots?payerId=${payerId}`);

      expect(mockGetSnapshots).toHaveBeenCalledWith('provider-1', payerId, 20, 0);
    });
  });

  describe('POST /alerts/:alertId/resolve', () => {
    it('resolves an alert', async () => {
      const resolved = { id: 'alert-1', resolvedAt: new Date(), resolvedBy: 'admin@test.com' };
      mockResolveAlert.mockResolvedValue(resolved);

      const res = await request(app)
        .post('/alerts/alert-1/resolve')
        .send({ resolvedBy: 'admin@test.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockResolveAlert).toHaveBeenCalledWith('alert-1', 'admin@test.com');
    });

    it('resolves with user email as fallback when resolvedBy not provided', async () => {
      mockResolveAlert.mockResolvedValue({ id: 'alert-1' });

      await request(app)
        .post('/alerts/alert-1/resolve')
        .send({});

      expect(mockResolveAlert).toHaveBeenCalledWith('alert-1', 'admin@test.com');
    });

    it('returns 500 on service error', async () => {
      mockResolveAlert.mockRejectedValue(new Error('Alert not found'));

      const res = await request(app)
        .post('/alerts/alert-1/resolve')
        .send({});

      expect(res.status).toBe(500);
    });
  });
});
