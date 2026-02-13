import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('./ai.service.js', () => ({
  getClient: vi.fn(),
  checkTokenBudget: vi.fn(),
  sanitizeUserInput: vi.fn((s: string) => s),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { getClient, checkTokenBudget } from './ai.service.js';
import {
  getPayerAnalytics,
  getPayerLeaderboard,
  analyzePayerWithAI,
  getPayerInsights,
} from './payerIntelligence.service.js';
import { invalidateCache } from '../utils/cache.js';

const mockPayers = [
  { id: 'payer-1', name: 'Blue Cross', payerType: 'insurance' },
  { id: 'payer-2', name: 'Aetna', payerType: 'insurance' },
  { id: 'payer-3', name: 'Cigna', payerType: 'insurance' },
];

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

describe('PayerIntelligence Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache(''); // clear all cached data between tests
  });

  // ==========================================
  // getPayerAnalytics
  // ==========================================
  describe('getPayerAnalytics', () => {
    it('returns analytics for payers with enrollments', async () => {
      prismaMock.payer.findMany.mockResolvedValue(mockPayers as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([
        { id: 'e1', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(60), effectiveDate: daysAgo(30), updatedAt: daysAgo(30) },
        { id: 'e2', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(50), effectiveDate: daysAgo(20), updatedAt: daysAgo(20) },
        { id: 'e3', payerId: 'payer-1', status: 'denied', applicationDate: daysAgo(40), effectiveDate: null, updatedAt: daysAgo(10) },
        { id: 'e4', payerId: 'payer-1', status: 'in_progress', applicationDate: daysAgo(90), effectiveDate: null, updatedAt: daysAgo(70) },
      ] as any);

      const result = await getPayerAnalytics();

      expect(result).toHaveLength(1); // only payer-1 has enrollments
      expect(result[0]!.payerName).toBe('Blue Cross');
      expect(result[0]!.totalEnrollments).toBe(4);
      expect(result[0]!.approvalRate).toBe(67); // 2/(2+1) = 67%
      expect(result[0]!.denialRate).toBe(33);
      expect(result[0]!.avgDaysToApproval).toBeDefined();
      expect(result[0]!.enrollmentsStuckOver60Days).toBe(1); // e4 updated 70 days ago
      expect(result[0]!.insufficientData).toBe(false);
    });

    it('marks payers with < 3 enrollments as insufficient data', async () => {
      prismaMock.payer.findMany.mockResolvedValue([mockPayers[0]] as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([
        { id: 'e1', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(30), effectiveDate: daysAgo(10), updatedAt: daysAgo(10) },
        { id: 'e2', payerId: 'payer-1', status: 'denied', applicationDate: daysAgo(20), effectiveDate: null, updatedAt: daysAgo(5) },
      ] as any);

      const result = await getPayerAnalytics();

      expect(result[0]!.insufficientData).toBe(true);
      expect(result[0]!.approvalRate).toBeNull();
      expect(result[0]!.denialRate).toBeNull();
    });

    it('returns empty array when no payers exist', async () => {
      prismaMock.payer.findMany.mockResolvedValue([]);

      const result = await getPayerAnalytics();

      expect(result).toHaveLength(0);
    });

    it('handles null applicationDate/effectiveDate gracefully', async () => {
      prismaMock.payer.findMany.mockResolvedValue([mockPayers[0]] as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([
        { id: 'e1', payerId: 'payer-1', status: 'approved', applicationDate: null, effectiveDate: null, updatedAt: daysAgo(10) },
        { id: 'e2', payerId: 'payer-1', status: 'approved', applicationDate: null, effectiveDate: null, updatedAt: daysAgo(5) },
        { id: 'e3', payerId: 'payer-1', status: 'denied', applicationDate: null, effectiveDate: null, updatedAt: daysAgo(2) },
      ] as any);

      const result = await getPayerAnalytics();

      expect(result[0]!.avgDaysToApproval).toBeNull(); // no approved with both dates
      expect(result[0]!.approvalRate).toBe(67);
      expect(result[0]!.insufficientData).toBe(false);
    });

    it('filters by specific payerId when provided', async () => {
      prismaMock.payer.findMany.mockResolvedValue([mockPayers[0]] as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([
        { id: 'e1', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(30), effectiveDate: daysAgo(10), updatedAt: daysAgo(10) },
        { id: 'e2', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(20), effectiveDate: daysAgo(5), updatedAt: daysAgo(5) },
        { id: 'e3', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(40), effectiveDate: daysAgo(20), updatedAt: daysAgo(20) },
      ] as any);

      const result = await getPayerAnalytics('payer-1');

      expect(prismaMock.payer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'payer-1' } })
      );
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================
  // getPayerLeaderboard
  // ==========================================
  describe('getPayerLeaderboard', () => {
    it('returns scored and ranked payers', async () => {
      prismaMock.payer.findMany.mockResolvedValue(mockPayers as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([
        // Payer 1: high denial, slow
        { id: 'e1', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(90), effectiveDate: daysAgo(10), updatedAt: daysAgo(10) },
        { id: 'e2', payerId: 'payer-1', status: 'denied', applicationDate: daysAgo(60), effectiveDate: null, updatedAt: daysAgo(5) },
        { id: 'e3', payerId: 'payer-1', status: 'denied', applicationDate: daysAgo(50), effectiveDate: null, updatedAt: daysAgo(3) },
        // Payer 2: good approval, fast
        { id: 'e4', payerId: 'payer-2', status: 'approved', applicationDate: daysAgo(20), effectiveDate: daysAgo(10), updatedAt: daysAgo(10) },
        { id: 'e5', payerId: 'payer-2', status: 'approved', applicationDate: daysAgo(15), effectiveDate: daysAgo(5), updatedAt: daysAgo(5) },
        { id: 'e6', payerId: 'payer-2', status: 'approved', applicationDate: daysAgo(25), effectiveDate: daysAgo(15), updatedAt: daysAgo(15) },
      ] as any);

      const result = await getPayerLeaderboard();

      expect(result.length).toBeGreaterThan(0);
      // Payer 1 should have higher difficulty score (more denials, slower)
      const payer1 = result.find(p => p.payerId === 'payer-1');
      const payer2 = result.find(p => p.payerId === 'payer-2');
      expect(payer1).toBeDefined();
      expect(payer2).toBeDefined();
      expect(payer1!.difficultyScore).toBeGreaterThan(payer2!.difficultyScore);
    });

    it('returns empty array when no payers have sufficient data', async () => {
      prismaMock.payer.findMany.mockResolvedValue(mockPayers as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([
        { id: 'e1', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(10), effectiveDate: daysAgo(5), updatedAt: daysAgo(5) },
      ] as any);

      const result = await getPayerLeaderboard();

      expect(result).toHaveLength(0); // only 1 enrollment = insufficient
    });
  });

  // ==========================================
  // analyzePayerWithAI
  // ==========================================
  describe('analyzePayerWithAI', () => {
    const mockAIResponse = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          riskAssessment: 'medium',
          summary: 'Moderate processing payer.',
          strengths: ['Good approval rate'],
          risks: ['Slow processing times'],
          recommendations: [{ action: 'Increase follow-up frequency', priority: 'high', reasoning: 'Speed matters' }],
          optimalFollowUpStrategy: { frequencyDays: 7, bestApproach: 'Phone', escalationThreshold: '30 days' },
          comparisonInsight: 'Below average speed.',
        }),
      }],
      usage: { input_tokens: 500, output_tokens: 300 },
    };

    it('returns AI insight and stores recommendation', async () => {
      (checkTokenBudget as any).mockResolvedValue({ allowed: true, used: 1000, budget: 100000, remaining: 99000 });
      prismaMock.payer.findMany.mockResolvedValue([mockPayers[0]] as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([
        { id: 'e1', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(30), effectiveDate: daysAgo(10), updatedAt: daysAgo(10) },
        { id: 'e2', payerId: 'payer-1', status: 'approved', applicationDate: daysAgo(20), effectiveDate: daysAgo(5), updatedAt: daysAgo(5) },
        { id: 'e3', payerId: 'payer-1', status: 'denied', applicationDate: daysAgo(40), effectiveDate: null, updatedAt: daysAgo(3) },
      ] as any);

      const mockClient = { messages: { create: vi.fn().mockResolvedValue(mockAIResponse) } };
      (getClient as any).mockReturnValue(mockClient);
      prismaMock.aiRecommendation.create.mockResolvedValue({ id: 'rec-1' } as any);

      const result = await analyzePayerWithAI('payer-1');

      expect(result.insight.riskAssessment).toBe('medium');
      expect(result.insight.recommendations).toHaveLength(1);
      expect(result.recommendation.id).toBe('rec-1');
      expect(prismaMock.aiRecommendation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'payer_intelligence',
            status: 'pending',
          }),
        })
      );
    });

    it('throws when token budget exceeded', async () => {
      (checkTokenBudget as any).mockResolvedValue({ allowed: false, used: 100000, budget: 100000, remaining: 0 });

      await expect(analyzePayerWithAI('payer-1')).rejects.toThrow('budget exceeded');
    });

    it('throws when payer has no enrollments', async () => {
      (checkTokenBudget as any).mockResolvedValue({ allowed: true, used: 0, budget: 100000, remaining: 100000 });
      prismaMock.payer.findMany.mockResolvedValue([]);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

      await expect(analyzePayerWithAI('nonexistent')).rejects.toThrow('No enrollment data found');
    });
  });

  // ==========================================
  // getPayerInsights
  // ==========================================
  describe('getPayerInsights', () => {
    it('queries recommendations filtered by payer_intelligence type and payerId', async () => {
      const mockInsights = [
        { id: 'rec-1', type: 'payer_intelligence', title: 'Analysis: Blue Cross', createdAt: new Date() },
      ];
      prismaMock.aiRecommendation.findMany.mockResolvedValue(mockInsights as any);

      const result = await getPayerInsights('payer-1');

      expect(result).toHaveLength(1);
      expect(prismaMock.aiRecommendation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: 'payer_intelligence',
            metadata: { path: ['payerId'], equals: 'payer-1' },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
      );
    });

    it('returns empty array when no insights exist', async () => {
      prismaMock.aiRecommendation.findMany.mockResolvedValue([]);

      const result = await getPayerInsights('payer-1');

      expect(result).toHaveLength(0);
    });
  });
});
