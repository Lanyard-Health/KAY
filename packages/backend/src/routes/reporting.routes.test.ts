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

vi.mock('../services/reporting.service.js', () => ({
  getEnrollmentPipeline: vi.fn(),
  getExpirationForecast: vi.fn(),
  getProviderReadiness: vi.fn(),
  getGettingStartedStatus: vi.fn(),
}));

import reportingRouter from './reporting.routes.js';
import {
  getEnrollmentPipeline,
  getExpirationForecast,
  getProviderReadiness,
  getGettingStartedStatus,
} from '../services/reporting.service.js';

const mockEnrollmentPipelineData = {
  byPayer: [
    {
      payerName: 'Blue Cross',
      payerId: 'payer-1',
      statuses: { not_started: 2, in_progress: 1, approved: 3 },
    },
  ],
  total: { not_started: 2, in_progress: 1, approved: 3 },
};

const mockExpirationForecastData = {
  buckets: {
    critical: [
      {
        providerId: 'provider-1',
        providerName: 'Jane Doe',
        credentialType: 'license',
        credentialName: 'State Medical License',
        expirationDate: '2025-04-01',
        daysRemaining: 10,
      },
    ],
    warning: [],
    upcoming: [],
  },
  counts: { critical: 1, warning: 0, upcoming: 0 },
};

const mockProviderReadinessData = {
  providers: [
    {
      providerId: 'provider-1',
      providerName: 'Jane Doe',
      hasActiveLicense: true,
      hasMalpractice: true,
      hasActiveEnrollment: false,
      readinessScore: 67,
    },
  ],
  summary: { fullyReady: 0, partiallyReady: 1, notReady: 0 },
};

const mockGettingStartedData = {
  providerCount: 3,
  documentCount: 5,
  enrollmentCount: 2,
  isOnboarded: true,
};

describe('Reporting Routes', () => {
  const app = createTestApp(reportingRouter, adminUser);
  const practiceId = 'practice-1-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // GET /enrollment-pipeline
  // ==========================================

  describe('GET /enrollment-pipeline', () => {
    it('returns enrollment pipeline data with valid practiceId', async () => {
      vi.mocked(getEnrollmentPipeline).mockResolvedValue(mockEnrollmentPipelineData as any);

      const res = await request(app)
        .get('/enrollment-pipeline')
        .query({ practiceId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockEnrollmentPipelineData);
      expect(getEnrollmentPipeline).toHaveBeenCalledWith(practiceId, undefined, undefined);
    });

    it('passes optional startDate and endDate to the service', async () => {
      vi.mocked(getEnrollmentPipeline).mockResolvedValue(mockEnrollmentPipelineData as any);

      const res = await request(app)
        .get('/enrollment-pipeline')
        .query({ practiceId, startDate: '2025-01-01', endDate: '2025-06-30' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(getEnrollmentPipeline).toHaveBeenCalledWith(
        practiceId,
        new Date('2025-01-01'),
        new Date('2025-06-30'),
      );
    });

    it('returns 400 when practiceId is missing', async () => {
      const res = await request(app).get('/enrollment-pipeline');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getEnrollmentPipeline).not.toHaveBeenCalled();
    });

    it('returns 500 when service throws an unexpected error', async () => {
      vi.mocked(getEnrollmentPipeline).mockRejectedValue(new Error('DB connection lost'));

      const res = await request(app)
        .get('/enrollment-pipeline')
        .query({ practiceId });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to load report data');
    });
  });

  // ==========================================
  // GET /expiration-forecast
  // ==========================================

  describe('GET /expiration-forecast', () => {
    it('returns expiration forecast data with valid practiceId', async () => {
      vi.mocked(getExpirationForecast).mockResolvedValue(mockExpirationForecastData as any);

      const res = await request(app)
        .get('/expiration-forecast')
        .query({ practiceId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockExpirationForecastData);
      // default days = 90
      expect(getExpirationForecast).toHaveBeenCalledWith(practiceId, 90);
    });

    it('passes custom days parameter to the service', async () => {
      vi.mocked(getExpirationForecast).mockResolvedValue(mockExpirationForecastData as any);

      const res = await request(app)
        .get('/expiration-forecast')
        .query({ practiceId, days: '60' });

      expect(res.status).toBe(200);
      expect(getExpirationForecast).toHaveBeenCalledWith(practiceId, 60);
    });

    it('returns 400 when practiceId is missing', async () => {
      const res = await request(app).get('/expiration-forecast');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getExpirationForecast).not.toHaveBeenCalled();
    });

    it('returns 500 when service throws an unexpected error', async () => {
      vi.mocked(getExpirationForecast).mockRejectedValue(new Error('Query timeout'));

      const res = await request(app)
        .get('/expiration-forecast')
        .query({ practiceId });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to load report data');
    });
  });

  // ==========================================
  // GET /provider-readiness
  // ==========================================

  describe('GET /provider-readiness', () => {
    it('returns provider readiness data with valid practiceId', async () => {
      vi.mocked(getProviderReadiness).mockResolvedValue(mockProviderReadinessData as any);

      const res = await request(app)
        .get('/provider-readiness')
        .query({ practiceId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockProviderReadinessData);
      expect(getProviderReadiness).toHaveBeenCalledWith(practiceId);
    });

    it('returns 400 when practiceId is missing', async () => {
      const res = await request(app).get('/provider-readiness');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getProviderReadiness).not.toHaveBeenCalled();
    });

    it('returns 500 when service throws an unexpected error', async () => {
      vi.mocked(getProviderReadiness).mockRejectedValue(new Error('Unexpected failure'));

      const res = await request(app)
        .get('/provider-readiness')
        .query({ practiceId });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to load report data');
    });
  });

  // ==========================================
  // GET /getting-started
  // ==========================================

  describe('GET /getting-started', () => {
    it('returns getting-started status with valid practiceId', async () => {
      vi.mocked(getGettingStartedStatus).mockResolvedValue(mockGettingStartedData as any);

      const res = await request(app)
        .get('/getting-started')
        .query({ practiceId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockGettingStartedData);
      expect(getGettingStartedStatus).toHaveBeenCalledWith(practiceId);
    });

    it('returns 400 when practiceId is missing', async () => {
      const res = await request(app).get('/getting-started');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getGettingStartedStatus).not.toHaveBeenCalled();
    });

    it('returns 500 when service throws an unexpected error', async () => {
      vi.mocked(getGettingStartedStatus).mockRejectedValue(new Error('Service down'));

      const res = await request(app)
        .get('/getting-started')
        .query({ practiceId });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to load report data');
    });
  });
});
