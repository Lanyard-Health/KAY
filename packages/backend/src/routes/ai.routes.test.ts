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
  // Enable trust proxy so X-Forwarded-For is respected for rate limit buckets
  app.set('trust proxy', 1);

  // Each describe block uses a unique IP to avoid rate limit bleed
  let testIpCounter = 0;
  function nextIp() {
    return `10.0.0.${++testIpCounter}`;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (isConfigured as any).mockReturnValue(true);
    prismaMock.enrollment.findUnique.mockResolvedValue({
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
    // Use a shared IP for this group; tests below are within the 10-request limit
    const ip = '10.1.0.1';

    it('generates a follow-up email', async () => {
      (generateFollowUpEmail as any).mockResolvedValue({
        subject: 'Follow-up',
        body: 'Dear Payer...',
      });

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .set('X-Forwarded-For', ip)
        .send({ tone: 'professional' });

      expect(res.status).toBe(200);
      expect(res.body.data.subject).toBe('Follow-up');
    });

    it('returns 503 when AI is not configured', async () => {
      (isConfigured as any).mockReturnValue(false);

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .set('X-Forwarded-For', ip)
        .send({});

      expect(res.status).toBe(503);
      expect(res.body.error.message).toContain('not available');
    });

    it('returns 500 when enrollment not found', async () => {
      (generateFollowUpEmail as any).mockRejectedValue(new Error('Enrollment not found'));

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .set('X-Forwarded-For', ip)
        .send({});

      expect(res.status).toBe(500);
    });

    it('returns 500 when token budget exceeded', async () => {
      (generateFollowUpEmail as any).mockRejectedValue(new Error('Token budget exceeded'));

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .set('X-Forwarded-For', ip)
        .send({});

      expect(res.status).toBe(500);
    });

    it('passes valid tone ("polite") through to service', async () => {
      (generateFollowUpEmail as any).mockResolvedValue({ subject: 'test', body: 'test' });

      await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .set('X-Forwarded-For', ip)
        .send({ tone: 'polite' });

      expect(generateFollowUpEmail).toHaveBeenCalledWith('enroll-1', {
        tone: 'polite',
        additionalContext: undefined,
      });
    });

    it('replaces invalid tone ("rude") with undefined', async () => {
      (generateFollowUpEmail as any).mockResolvedValue({ subject: 'test', body: 'test' });

      await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .set('X-Forwarded-For', ip)
        .send({ tone: 'rude' });

      expect(generateFollowUpEmail).toHaveBeenCalledWith('enroll-1', {
        tone: undefined,
        additionalContext: undefined,
      });
    });

    it('defaults missing tone to undefined', async () => {
      (generateFollowUpEmail as any).mockResolvedValue({ subject: 'test', body: 'test' });

      await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .set('X-Forwarded-For', ip)
        .send({});

      expect(generateFollowUpEmail).toHaveBeenCalledWith('enroll-1', {
        tone: undefined,
        additionalContext: undefined,
      });
    });
  });

  describe('POST /enrollment/:id/analyze', () => {
    const ip = '10.1.0.2';

    it('analyzes an enrollment', async () => {
      (analyzeEnrollment as any).mockResolvedValue({ score: 85, recommendations: [] });

      const res = await request(app)
        .post('/enrollment/enroll-1/analyze')
        .set('X-Forwarded-For', ip);

      expect(res.status).toBe(200);
      expect(res.body.data.score).toBe(85);
    });

    it('returns 503 when AI is not configured', async () => {
      (isConfigured as any).mockReturnValue(false);

      const res = await request(app)
        .post('/enrollment/enroll-1/analyze')
        .set('X-Forwarded-For', ip);

      expect(res.status).toBe(503);
    });
  });

  describe('POST /portfolio/analyze', () => {
    const ip = '10.1.0.3';

    it('analyzes the full portfolio', async () => {
      (analyzePortfolio as any).mockResolvedValue({ total: 10, insights: [] });

      const res = await request(app)
        .post('/portfolio/analyze')
        .set('X-Forwarded-For', ip);

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(10);
    });

    it('returns 503 when AI is not configured', async () => {
      (isConfigured as any).mockReturnValue(false);

      const res = await request(app)
        .post('/portfolio/analyze')
        .set('X-Forwarded-For', ip);

      expect(res.status).toBe(503);
    });

    it('returns 500 when budget exceeded', async () => {
      (analyzePortfolio as any).mockRejectedValue(new Error('Token budget exceeded'));

      const res = await request(app)
        .post('/portfolio/analyze')
        .set('X-Forwarded-For', ip);

      expect(res.status).toBe(500);
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
      prismaError.name = 'PrismaClientKnownRequestError';
      (prismaError as any).code = 'P2025';
      (updateRecommendationStatus as any).mockRejectedValue(prismaError);

      const res = await request(app)
        .patch('/recommendations/nonexistent')
        .send({ status: 'accepted' });

      expect(res.status).toBe(404);
    });
  });

  describe('Rate limiting', () => {
    // Isolated IP just for rate limit testing
    const rateLimitIp = '10.99.99.99';

    it('allows 10 requests within the rate limit window', async () => {
      (generateFollowUpEmail as any).mockResolvedValue({ subject: 'ok', body: 'ok' });

      const results = [];
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/enrollment/enroll-1/generate-email')
          .set('X-Forwarded-For', rateLimitIp)
          .send({});
        results.push(res.status);
      }

      expect(results.every((s) => s === 200)).toBe(true);
    });

    it('returns 429 on the 11th request', async () => {
      (generateFollowUpEmail as any).mockResolvedValue({ subject: 'ok', body: 'ok' });

      const res = await request(app)
        .post('/enrollment/enroll-1/generate-email')
        .set('X-Forwarded-For', rateLimitIp)
        .send({});

      expect(res.status).toBe(429);
      expect(res.body.error.message).toContain('Too many AI requests');
    });
  });
});
