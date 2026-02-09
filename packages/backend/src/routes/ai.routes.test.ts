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

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/ai.service.js', () => ({
  isConfigured: vi.fn(),
  getModelInfo: vi.fn(),
  getTodayTokenUsage: vi.fn(),
  checkTokenBudget: vi.fn(),
  generateFollowUpEmail: vi.fn(),
  analyzeEnrollment: vi.fn(),
  analyzePortfolio: vi.fn(),
  getRecommendations: vi.fn(),
  updateRecommendationStatus: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { aiRoutes } from './ai.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  isConfigured,
  getModelInfo,
  getTodayTokenUsage,
  checkTokenBudget,
  generateFollowUpEmail,
  analyzeEnrollment,
  analyzePortfolio,
  getRecommendations,
  updateRecommendationStatus,
} from '../services/ai.service.js';

describe('AI Routes', () => {
  const app = createTestApp(aiRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: AI is configured and enrollment exists
    (isConfigured as any).mockReturnValue(true);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      id: 'enroll-1',
      providerId: 'provider-1-id',
    } as any);
  });

  describe('GET /status', () => {
    it('returns AI status with model info and usage', async () => {
      (getModelInfo as any).mockReturnValue({ model: 'claude-sonnet', configured: true });
      (getTodayTokenUsage as any).mockResolvedValue({ input: 100, output: 50 });

      const res = await request(app).get('/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.model).toBe('claude-sonnet');
      expect(res.body.data.todayUsage.input).toBe(100);
    });
  });

  describe('GET /usage', () => {
    it('returns usage stats and budget', async () => {
      (getTodayTokenUsage as any).mockResolvedValue({ input: 1000, output: 500 });
      (checkTokenBudget as any).mockResolvedValue({
        budget: 100000,
        used: 1500,
        remaining: 98500,
        allowed: true,
      });

      const res = await request(app).get('/usage');

      expect(res.status).toBe(200);
      expect(res.body.data.today.input).toBe(1000);
      expect(res.body.data.budget.daily).toBe(100000);
      expect(res.body.data.budget.percentUsed).toBe(2);
    });
  });

  describe('POST /enrollment/:id/generate-email', () => {
    it('generates a follow-up email', async () => {
      (generateFollowUpEmail as any).mockResolvedValue({
        subject: 'Follow-up',
        body: 'Dear Payer...',
      });

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .send({ tone: 'professional' });

      expect(res.status).toBe(200);
      expect(res.body.data.subject).toBe('Follow-up');
    });

    it('returns 503 when AI is not configured', async () => {
      (isConfigured as any).mockReturnValue(false);

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .send({});

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('not configured');
    });

    it('returns 404 when enrollment not found', async () => {
      (generateFollowUpEmail as any).mockRejectedValue(new Error('Enrollment not found'));

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .send({});

      expect(res.status).toBe(404);
    });

    it('returns 429 when token budget exceeded', async () => {
      (generateFollowUpEmail as any).mockRejectedValue(new Error('Token budget exceeded'));

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .send({});

      expect(res.status).toBe(429);
    });
  });

  describe('POST /enrollment/:id/analyze', () => {
    it('analyzes an enrollment', async () => {
      (analyzeEnrollment as any).mockResolvedValue({ score: 85, recommendations: [] });

      const res = await request(app).post('/enrollment/enroll-1/analyze');

      expect(res.status).toBe(200);
      expect(res.body.data.score).toBe(85);
    });

    it('returns 503 when AI is not configured', async () => {
      (isConfigured as any).mockReturnValue(false);

      const res = await request(app).post('/enrollment/enroll-1/analyze');

      expect(res.status).toBe(503);
    });
  });

  describe('POST /portfolio/analyze', () => {
    it('analyzes the full portfolio', async () => {
      (analyzePortfolio as any).mockResolvedValue({ total: 10, insights: [] });

      const res = await request(app).post('/portfolio/analyze');

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(10);
    });

    it('returns 503 when AI is not configured', async () => {
      (isConfigured as any).mockReturnValue(false);

      const res = await request(app).post('/portfolio/analyze');

      expect(res.status).toBe(503);
    });

    it('returns 429 when budget exceeded', async () => {
      (analyzePortfolio as any).mockRejectedValue(new Error('Token budget exceeded'));

      const res = await request(app).post('/portfolio/analyze');

      expect(res.status).toBe(429);
    });
  });

  describe('GET /recommendations', () => {
    it('returns recommendations', async () => {
      (getRecommendations as any).mockResolvedValue([
        { id: 'rec-1', type: 'followup', status: 'pending' },
      ]);

      const res = await request(app).get('/recommendations');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('passes query filters to service', async () => {
      (getRecommendations as any).mockResolvedValue([]);

      await request(app).get('/recommendations?type=followup&status=pending&enrollmentId=e1');

      expect(getRecommendations).toHaveBeenCalledWith({
        type: 'followup',
        status: 'pending',
        enrollmentId: 'e1',
      });
    });
  });

  describe('PATCH /recommendations/:id', () => {
    it('updates recommendation status to accepted', async () => {
      (updateRecommendationStatus as any).mockResolvedValue({
        id: 'rec-1',
        status: 'accepted',
      });

      const res = await request(app)
        .patch('/recommendations/rec-1')
        .send({ status: 'accepted' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('accepted');
    });

    it('updates recommendation status to dismissed', async () => {
      (updateRecommendationStatus as any).mockResolvedValue({
        id: 'rec-1',
        status: 'dismissed',
      });

      const res = await request(app)
        .patch('/recommendations/rec-1')
        .send({ status: 'dismissed' });

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app)
        .patch('/recommendations/rec-1')
        .send({ status: 'invalid' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when status is missing', async () => {
      const res = await request(app)
        .patch('/recommendations/rec-1')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 when recommendation not found', async () => {
      const prismaError = new Error('Record not found');
      (prismaError as any).code = 'P2025';
      (updateRecommendationStatus as any).mockRejectedValue(prismaError);

      const res = await request(app)
        .patch('/recommendations/nonexistent')
        .send({ status: 'accepted' });

      expect(res.status).toBe(404);
    });
  });
});
