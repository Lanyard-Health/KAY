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
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../services/pdm.service.js', () => ({
  getAttestationStatuses: vi.fn(),
  getEnrollmentsNeedingAttestation: vi.fn(),
  recordAttestation: vi.fn(),
  getAttestationSummary: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { pdmRoutes } from './pdm.routes.js';
import {
  getAttestationStatuses,
  getEnrollmentsNeedingAttestation,
  recordAttestation,
  getAttestationSummary,
} from '../services/pdm.service.js';

describe('PDM Routes', () => {
  const app = createTestApp(pdmRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /provider/:providerId/status', () => {
    it('returns attestation statuses and summary', async () => {
      (getAttestationStatuses as any).mockResolvedValue([
        { enrollmentId: 'e1', status: 'current' },
      ]);
      (getAttestationSummary as any).mockResolvedValue({ total: 1, current: 1, overdue: 0 });

      const res = await request(app).get('/provider/provider-1-id/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.statuses).toHaveLength(1);
      expect(res.body.data.summary.total).toBe(1);
    });

    it('returns 500 on service error', async () => {
      (getAttestationStatuses as any).mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/provider/provider-1-id/status');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /provider/:providerId/alerts', () => {
    it('returns alerts with default warning days', async () => {
      (getEnrollmentsNeedingAttestation as any).mockResolvedValue([
        { enrollmentId: 'e1', reason: 'overdue' },
      ]);

      const res = await request(app).get('/provider/provider-1-id/alerts');

      expect(res.status).toBe(200);
      expect(res.body.data.alerts).toHaveLength(1);
      expect(res.body.data.count).toBe(1);
      expect(getEnrollmentsNeedingAttestation).toHaveBeenCalledWith('provider-1-id', 14);
    });

    it('accepts custom warningDays parameter', async () => {
      (getEnrollmentsNeedingAttestation as any).mockResolvedValue([]);

      await request(app).get('/provider/provider-1-id/alerts?warningDays=30');

      expect(getEnrollmentsNeedingAttestation).toHaveBeenCalledWith('provider-1-id', 30);
    });

    it('returns 500 on service error', async () => {
      (getEnrollmentsNeedingAttestation as any).mockRejectedValue(new Error('fail'));

      const res = await request(app).get('/provider/provider-1-id/alerts');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /provider/:providerId/attest', () => {
    it('records attestation for enrollments', async () => {
      (recordAttestation as any).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/provider/provider-1-id/attest')
        .send({ enrollmentIds: ['e1', 'e2'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('2 enrollment(s)');
      expect(res.body.data.attestedBy).toBe('admin@test.com');
    });

    it('returns 400 when enrollmentIds is missing', async () => {
      const res = await request(app)
        .post('/provider/provider-1-id/attest')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('enrollmentIds');
    });

    it('returns 400 when enrollmentIds is empty array', async () => {
      const res = await request(app)
        .post('/provider/provider-1-id/attest')
        .send({ enrollmentIds: [] });

      expect(res.status).toBe(400);
    });

    it('returns 500 on service error', async () => {
      (recordAttestation as any).mockRejectedValue(new Error('fail'));

      const res = await request(app)
        .post('/provider/provider-1-id/attest')
        .send({ enrollmentIds: ['e1'] });

      expect(res.status).toBe(500);
    });
  });
});
