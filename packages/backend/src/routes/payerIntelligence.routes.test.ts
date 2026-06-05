import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, staffUser, mockPayer } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/payerIntelligence.service.js', () => ({
  getPayerAnalytics: vi.fn(),
  getPayerLeaderboard: vi.fn(),
  analyzePayerWithAI: vi.fn(),
  getPayerInsights: vi.fn(),
}));

import { payerIntelligenceRoutes } from './payerIntelligence.routes.js';
import {
  getPayerAnalytics,
  getPayerLeaderboard,
  analyzePayerWithAI,
  getPayerInsights,
} from '../services/payerIntelligence.service.js';

describe('Payer Intelligence Routes', () => {
  const app = createTestApp(payerIntelligenceRoutes, adminUser);
  app.set('trust proxy', 1);

  let testIpCounter = 0;
  function nextIp() {
    return `10.0.0.${++testIpCounter}`;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // GET /analytics
  // ==========================================
  describe('GET /analytics', () => {
    it('returns analytics for all payers', async () => {
      const mockAnalytics = [
        {
          payerId: 'payer-1',
          payerName: 'Blue Cross',
          payerType: 'insurance',
          totalEnrollments: 10,
          activeEnrollments: 8,
          approvalRate: 75,
          denialRate: 25,
          avgDaysToApproval: 45,
          avgDaysInCurrentStatus: 12,
          enrollmentsStuckOver60Days: 1,
          statusDistribution: { approved: 6, denied: 2, in_progress: 2 },
          insufficientData: false,
        },
      ];
      (getPayerAnalytics as any).mockResolvedValue(mockAnalytics);

      const res = await request(app).get('/analytics');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].payerName).toBe('Blue Cross');
      expect(getPayerAnalytics).toHaveBeenCalledWith(undefined);
    });

    it('returns analytics for a specific payer', async () => {
      const mockAnalytics = [{
        payerId: 'payer-1',
        payerName: 'Blue Cross',
        totalEnrollments: 5,
        insufficientData: false,
      }];
      (getPayerAnalytics as any).mockResolvedValue(mockAnalytics);

      const res = await request(app)
        .get('/analytics?payerId=550e8400-e29b-41d4-a716-446655440000');

      expect(res.status).toBe(200);
      expect(getPayerAnalytics).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
    });

    it('returns empty array when no payers have enrollments', async () => {
      (getPayerAnalytics as any).mockResolvedValue([]);

      const res = await request(app).get('/analytics');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns 500 on service error', async () => {
      (getPayerAnalytics as any).mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app).get('/analytics');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('DB connection failed');
    });
  });

  // ==========================================
  // GET /leaderboard
  // ==========================================
  describe('GET /leaderboard', () => {
    it('returns ranked payer list', async () => {
      const mockLeaderboard = [
        {
          payerId: 'payer-1',
          payerName: 'Slow Payer Inc',
          difficultyScore: 72,
          approvalRate: 40,
          denialRate: 60,
          avgDaysToApproval: 90,
          totalEnrollments: 10,
          stuckCount: 3,
        },
        {
          payerId: 'payer-2',
          payerName: 'Fast Payer LLC',
          difficultyScore: 15,
          approvalRate: 95,
          denialRate: 5,
          avgDaysToApproval: 14,
          totalEnrollments: 20,
          stuckCount: 0,
        },
      ];
      (getPayerLeaderboard as any).mockResolvedValue(mockLeaderboard);

      const res = await request(app).get('/leaderboard');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].difficultyScore).toBeGreaterThan(res.body.data[1].difficultyScore);
    });

    it('returns empty array when no eligible payers', async () => {
      (getPayerLeaderboard as any).mockResolvedValue([]);

      const res = await request(app).get('/leaderboard');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns 500 on service error', async () => {
      (getPayerLeaderboard as any).mockRejectedValue(new Error('Query failed'));

      const res = await request(app).get('/leaderboard');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // POST /:payerId/analyze
  // ==========================================
  describe('POST /:payerId/analyze', () => {
    const mockResult = {
      insight: {
        riskAssessment: 'medium',
        summary: 'This payer has moderate processing times.',
        strengths: ['Good approval rate'],
        risks: ['Slow processing'],
        recommendations: [{ action: 'Follow up weekly', priority: 'high', reasoning: 'Speed up process' }],
        optimalFollowUpStrategy: { frequencyDays: 7, bestApproach: 'Phone + email', escalationThreshold: '30 days' },
        comparisonInsight: 'Below average processing speed.',
      },
      recommendation: { id: 'rec-1' },
    };

    it('returns AI analysis for a payer', async () => {
      (analyzePayerWithAI as any).mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/payer-1/analyze')
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.insight.riskAssessment).toBe('medium');
      expect(res.body.data.recommendation.id).toBe('rec-1');
      expect(analyzePayerWithAI).toHaveBeenCalledWith('payer-1');
    });

    it('returns 429 when token budget exceeded', async () => {
      (analyzePayerWithAI as any).mockRejectedValue(new Error('Daily token budget exceeded. Used 100000/100000 tokens today.'));

      const res = await request(app)
        .post('/payer-1/analyze')
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('budget exceeded');
    });

    it('returns 500 on generic service error', async () => {
      (analyzePayerWithAI as any).mockRejectedValue(new Error('AI call failed'));

      const res = await request(app)
        .post('/payer-1/analyze')
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // GET /:payerId/insights
  // ==========================================
  describe('GET /:payerId/insights', () => {
    it('returns past AI insights for a payer', async () => {
      const mockInsights = [
        {
          id: 'rec-1',
          type: 'payer_intelligence',
          status: 'pending',
          title: 'Payer Analysis: Blue Cross',
          content: '{"riskAssessment":"low"}',
          reasoning: 'Low risk payer',
          metadata: { payerId: 'payer-1' },
          createdAt: new Date().toISOString(),
        },
      ];
      (getPayerInsights as any).mockResolvedValue(mockInsights);

      const res = await request(app).get('/payer-1/insights');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(getPayerInsights).toHaveBeenCalledWith('payer-1');
    });

    it('returns empty array when no insights exist', async () => {
      (getPayerInsights as any).mockResolvedValue([]);

      const res = await request(app).get('/payer-1/insights');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns 500 on service error', async () => {
      (getPayerInsights as any).mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/payer-1/insights');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});
