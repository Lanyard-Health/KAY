import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Router } from 'express';
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

const mockValidateAccess = vi.fn().mockResolvedValue(true);
vi.mock('../middleware/practiceScope.middleware.js', () => ({
  validateProviderPracticeAccess: (...args: any[]) => mockValidateAccess(...args),
}));

vi.mock('../services/aetna/readiness.service.js', () => ({
  checkAetnaReadiness: vi.fn(),
}));

vi.mock('../services/aetna/enrollment.service.js', () => ({
  startAetnaEnrollment: vi.fn().mockReturnValue(Promise.resolve()),
  approveAndSubmit: vi.fn().mockReturnValue(Promise.resolve()),
  rejectRun: vi.fn().mockReturnValue(Promise.resolve()),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function () { return {}; }),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.test/screenshot.png'),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { aetnaRoutes } from './aetna.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { checkAetnaReadiness } from '../services/aetna/readiness.service.js';
import { startAetnaEnrollment, approveAndSubmit, rejectRun } from '../services/aetna/enrollment.service.js';

const mockEnrollment = {
  id: 'enrollment-1',
  providerId: 'provider-1',
  payerId: 'payer-1',
  status: 'not_started',
  payer: { id: 'payer-1', name: 'Aetna' },
  createdAt: new Date(),
};

const mockRun = {
  id: 'run-1',
  payerEnrollmentId: 'enrollment-1',
  status: 'awaiting_review',
  aetnaRequestId: 'REQ-123',
  screenshotDocIds: ['s3-key-1', 's3-key-2'],
  confirmationPdfId: null,
  automationLog: 'test log',
  errorMessage: null,
  errorPage: null,
  formPayload: {},
  initiatedById: 'admin-user-id',
  startedAt: new Date(),
  reviewExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
  submittedAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Aetna Routes', () => {
  // Mount with :enrollmentId param to match mergeParams usage
  const wrapper = Router();
  wrapper.use('/enrollments/:enrollmentId/aetna', aetnaRoutes);
  const app = createTestApp(wrapper, adminUser);

  beforeEach(() => {
    vi.resetAllMocks();
    mockValidateAccess.mockResolvedValue(true);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment as any);
    // Restore return values cleared by resetAllMocks
    vi.mocked(startAetnaEnrollment).mockReturnValue(Promise.resolve());
    vi.mocked(approveAndSubmit).mockReturnValue(Promise.resolve());
    vi.mocked(rejectRun).mockReturnValue(Promise.resolve());
  });

  describe('POST /readiness', () => {
    it('returns readiness result', async () => {
      const readiness = { ready: true, pages: [] };
      vi.mocked(checkAetnaReadiness).mockResolvedValue(readiness as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/readiness');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(readiness);
    });

    it('returns 404 when enrollment not found', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/readiness');
      expect(res.status).toBe(404);
    });

    it('returns 403 when practice access denied', async () => {
      mockValidateAccess.mockResolvedValue(false);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/readiness');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /start', () => {
    it('returns 409 when active run exists', async () => {
      prismaMock.aetnaEnrollmentRun.findFirst.mockResolvedValue({ id: 'existing-run' } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/start');
      expect(res.status).toBe(409);
    });

    it('returns 400 when not ready', async () => {
      prismaMock.aetnaEnrollmentRun.findFirst.mockResolvedValue(null);
      vi.mocked(checkAetnaReadiness).mockResolvedValue({ ready: false, pages: [] } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/start');
      expect(res.status).toBe(400);
    });

    it('creates run and returns 201 when ready', async () => {
      prismaMock.aetnaEnrollmentRun.findFirst.mockResolvedValue(null);
      vi.mocked(checkAetnaReadiness).mockResolvedValue({ ready: true, pages: [] } as any);
      prismaMock.aetnaEnrollmentRun.create.mockResolvedValue({ id: 'new-run', status: 'pending' } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/start');
      expect(res.status).toBe(201);
      expect(res.body.data.runId).toBe('new-run');
    });
  });

  describe('GET /runs', () => {
    it('returns list of runs', async () => {
      prismaMock.aetnaEnrollmentRun.findMany.mockResolvedValue([mockRun] as any);

      const res = await request(app).get('/enrollments/enrollment-1/aetna/runs');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /runs/:runId', () => {
    it('returns run with signed screenshot URLs', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue(mockRun as any);

      const res = await request(app).get('/enrollments/enrollment-1/aetna/runs/run-1');
      expect(res.status).toBe(200);
      expect(res.body.data.screenshotUrls).toHaveLength(2);
    });

    it('returns 404 when run not found', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/enrollments/enrollment-1/aetna/runs/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 404 when run belongs to different enrollment (ownership check)', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue({
        ...mockRun,
        payerEnrollmentId: 'other-enrollment',
      } as any);

      const res = await request(app).get('/enrollments/enrollment-1/aetna/runs/run-1');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /runs/:runId/approve', () => {
    it('approves run in awaiting_review status', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue(mockRun as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/approve');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('submitting');
    });

    it('rejects approval when run is not awaiting_review', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue({
        ...mockRun,
        status: 'completed',
      } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/approve');
      expect(res.status).toBe(400);
    });

    it('rejects approval when review window expired', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue({
        ...mockRun,
        reviewExpiresAt: new Date(Date.now() - 1000),
      } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/approve');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/expired/i);
    });

    it('returns 404 for run belonging to different enrollment', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue({
        ...mockRun,
        payerEnrollmentId: 'other-enrollment',
      } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/approve');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /runs/:runId/reject', () => {
    it('rejects run in awaiting_review status', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue(mockRun as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/reject');
      expect(res.status).toBe(200);
    });

    it('rejects when run is in completed status', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue({
        ...mockRun,
        status: 'completed',
      } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/reject');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /runs/:runId/retry', () => {
    it('retries run in failed status', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue({
        ...mockRun,
        status: 'failed',
      } as any);
      prismaMock.aetnaEnrollmentRun.update.mockResolvedValue({
        ...mockRun,
        status: 'pending',
      } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/retry');
      expect(res.status).toBe(200);
    });

    it('retries run in timed_out status', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue({
        ...mockRun,
        status: 'timed_out',
      } as any);
      prismaMock.aetnaEnrollmentRun.update.mockResolvedValue({
        ...mockRun,
        status: 'pending',
      } as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/retry');
      expect(res.status).toBe(200);
    });

    it('rejects retry for run in awaiting_review status', async () => {
      prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue(mockRun as any);

      const res = await request(app).post('/enrollments/enrollment-1/aetna/runs/run-1/retry');
      expect(res.status).toBe(400);
    });
  });
});
