import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/cache.js', () => ({
  getCached: vi.fn().mockReturnValue(undefined),
  setCache: vi.fn(),
}));

import { computeHealthScore } from './health-score.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { getCached, setCache } from '../utils/cache.js';

/**
 * Helper to set up all the mockResolvedValueOnce chains needed by computeHealthScore.
 *
 * The Promise.all in the service fires these concurrently, but vitest-mock-extended
 * tracks call order, so mockResolvedValueOnce is consumed in invocation order:
 *
 * provider.count calls (in order):
 *   1. totalProviders
 *   2. providersWithCreds
 *   3. caqhCurrentProviders
 *   4. completeProviders
 *   5-11. 7 × get7DayTrend (provider trend)
 *
 * payerEnrollment.count calls:
 *   1. totalEnrollments
 *   2. approvedEnrollments
 *   3-9. 7 × get7DayEnrollmentTrend
 *
 * license.count calls:
 *   1. expiredLicenses
 *   2. totalLicenses
 *
 * agentEvent.count calls:
 *   1. aiActionsToday
 */
function mockCounts({
  totalProviders = 10,
  providersWithCreds = 8,
  totalEnrollments = 20,
  approvedEnrollments = 15,
  expiredLicenses = 2,
  totalLicenses = 30,
  caqhCurrent = 7,
  completeProviders = 9,
  aiActions = 5,
  providerTrend = [1, 1, 1, 1, 1, 1, 1],
  enrollmentTrend = [2, 2, 2, 2, 2, 2, 2],
}: {
  totalProviders?: number;
  providersWithCreds?: number;
  totalEnrollments?: number;
  approvedEnrollments?: number;
  expiredLicenses?: number;
  totalLicenses?: number;
  caqhCurrent?: number;
  completeProviders?: number;
  aiActions?: number;
  providerTrend?: number[];
  enrollmentTrend?: number[];
} = {}) {
  // Provider counts: totalProviders, providersWithCreds, caqhCurrent, completeProviders
  prismaMock.provider.count
    .mockResolvedValueOnce(totalProviders)
    .mockResolvedValueOnce(providersWithCreds)
    .mockResolvedValueOnce(caqhCurrent)
    .mockResolvedValueOnce(completeProviders);
  // Then 7 trend days for providers
  for (const val of providerTrend) {
    prismaMock.provider.count.mockResolvedValueOnce(val);
  }

  // Enrollment counts: totalEnrollments, approvedEnrollments
  prismaMock.enrollment.count
    .mockResolvedValueOnce(totalEnrollments)
    .mockResolvedValueOnce(approvedEnrollments);
  // Then 7 trend days for enrollments
  for (const val of enrollmentTrend) {
    prismaMock.enrollment.count.mockResolvedValueOnce(val);
  }

  // License counts: expiredLicenses, totalLicenses
  prismaMock.license.count
    .mockResolvedValueOnce(expiredLicenses)
    .mockResolvedValueOnce(totalLicenses);

  // Agent event count
  prismaMock.agentEvent.count.mockResolvedValueOnce(aiActions);
}

beforeEach(() => {
  vi.mocked(getCached).mockReturnValue(undefined);
  vi.mocked(setCache).mockClear();
});

describe('computeHealthScore', () => {
  // ─── Score calculation ──────────────────────────────────────────────

  describe('score calculation', () => {
    it('computes correct score with typical values', async () => {
      mockCounts();

      const result = await computeHealthScore();

      // credentialedPct = round(8/10 * 100) = 80
      // activeEnrollmentsPct = round(15/20 * 100) = 75
      // expiredCredsPenalty = round(2/30 * 100) = 7
      // caqhCurrentPct = round(7/10 * 100) = 70
      // completenessPct = round(9/10 * 100) = 90
      //
      // score = round(80*0.30 + 75*0.25 + (100-7)*0.20 + 70*0.15 + 90*0.10)
      //       = round(24 + 18.75 + 18.6 + 10.5 + 9)
      //       = round(80.85)
      //       = 81
      expect(result.credentialingHealthScore).toBe(81);

      expect(result.breakdown).toEqual({
        credentialedPct: 80,
        activeEnrollmentsPct: 75,
        expiredCredsPenalty: 7,
        caqhCurrentPct: 70,
      });
    });

    it('returns perfect 100 when all metrics are perfect', async () => {
      mockCounts({
        totalProviders: 10,
        providersWithCreds: 10,
        totalEnrollments: 20,
        approvedEnrollments: 20,
        expiredLicenses: 0,
        totalLicenses: 30,
        caqhCurrent: 10,
        completeProviders: 10,
      });

      const result = await computeHealthScore();

      // 100*0.30 + 100*0.25 + 100*0.20 + 100*0.15 + 100*0.10 = 100
      expect(result.credentialingHealthScore).toBe(100);
      expect(result.breakdown.credentialedPct).toBe(100);
      expect(result.breakdown.activeEnrollmentsPct).toBe(100);
      expect(result.breakdown.expiredCredsPenalty).toBe(0);
      expect(result.breakdown.caqhCurrentPct).toBe(100);
    });

    it('returns 0 when everything is bad', async () => {
      mockCounts({
        totalProviders: 10,
        providersWithCreds: 0,
        totalEnrollments: 20,
        approvedEnrollments: 0,
        expiredLicenses: 30,
        totalLicenses: 30,
        caqhCurrent: 0,
        completeProviders: 0,
      });

      const result = await computeHealthScore();

      // credentialedPct = 0, activeEnrollmentsPct = 0, penalty = 100, caqh = 0, complete = 0
      // score = round(0*0.30 + 0*0.25 + (100-100)*0.20 + 0*0.15 + 0*0.10) = 0
      expect(result.credentialingHealthScore).toBe(0);
      expect(result.breakdown.credentialedPct).toBe(0);
      expect(result.breakdown.activeEnrollmentsPct).toBe(0);
      expect(result.breakdown.expiredCredsPenalty).toBe(100);
      expect(result.breakdown.caqhCurrentPct).toBe(0);
    });

    it('handles zero providers gracefully (no division by zero)', async () => {
      mockCounts({
        totalProviders: 0,
        providersWithCreds: 0,
        totalEnrollments: 0,
        approvedEnrollments: 0,
        expiredLicenses: 0,
        totalLicenses: 0,
        caqhCurrent: 0,
        completeProviders: 0,
        aiActions: 0,
      });

      const result = await computeHealthScore();

      // When totalProviders = 0: credentialedPct=100, caqhCurrentPct=100, completenessPct=100
      // When totalEnrollments = 0: activeEnrollmentsPct=100
      // When totalLicenses = 0: expiredCredsPenalty=0
      // score = round(100*0.30 + 100*0.25 + 100*0.20 + 100*0.15 + 100*0.10) = 100
      expect(result.credentialingHealthScore).toBe(100);
      expect(result.breakdown.credentialedPct).toBe(100);
      expect(result.breakdown.activeEnrollmentsPct).toBe(100);
      expect(result.breakdown.expiredCredsPenalty).toBe(0);
      expect(result.breakdown.caqhCurrentPct).toBe(100);
    });

    it('handles zero enrollments gracefully (defaults to 100%)', async () => {
      mockCounts({
        totalProviders: 10,
        providersWithCreds: 10,
        totalEnrollments: 0,
        approvedEnrollments: 0,
        expiredLicenses: 0,
        totalLicenses: 30,
        caqhCurrent: 10,
        completeProviders: 10,
      });

      const result = await computeHealthScore();

      // activeEnrollmentsPct defaults to 100 when totalEnrollments=0
      expect(result.breakdown.activeEnrollmentsPct).toBe(100);
      expect(result.credentialingHealthScore).toBe(100);
    });

    it('handles zero licenses gracefully (penalty defaults to 0%)', async () => {
      mockCounts({
        totalProviders: 10,
        providersWithCreds: 5,
        totalEnrollments: 10,
        approvedEnrollments: 5,
        expiredLicenses: 0,
        totalLicenses: 0,
        caqhCurrent: 5,
        completeProviders: 5,
      });

      const result = await computeHealthScore();

      // expiredCredsPenalty defaults to 0 when totalLicenses=0
      expect(result.breakdown.expiredCredsPenalty).toBe(0);
    });

    it('clamps score to max 100', async () => {
      // Even with all perfect metrics, score should not exceed 100
      mockCounts({
        totalProviders: 1,
        providersWithCreds: 1,
        totalEnrollments: 1,
        approvedEnrollments: 1,
        expiredLicenses: 0,
        totalLicenses: 1,
        caqhCurrent: 1,
        completeProviders: 1,
      });

      const result = await computeHealthScore();

      expect(result.credentialingHealthScore).toBeLessThanOrEqual(100);
      expect(result.credentialingHealthScore).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Revenue at risk ────────────────────────────────────────────────

  describe('revenue at risk', () => {
    it('calculates revenue at risk as (totalProviders - providersWithCreds) * $2500', async () => {
      mockCounts({
        totalProviders: 10,
        providersWithCreds: 8,
      });

      const result = await computeHealthScore();

      // (10 - 8) * 2500 = 5000
      expect(result.revenueAtRisk).toBe(5000);
    });

    it('returns 0 revenue at risk when all providers are credentialed', async () => {
      mockCounts({
        totalProviders: 10,
        providersWithCreds: 10,
      });

      const result = await computeHealthScore();

      expect(result.revenueAtRisk).toBe(0);
    });
  });

  // ─── Caching ────────────────────────────────────────────────────────

  describe('caching', () => {
    it('returns cached result when available', async () => {
      const cachedResult = {
        credentialingHealthScore: 85,
        revenueAtRisk: 7500,
        aiActionsToday: 3,
        trendData: { providers7d: [1, 2, 3, 4, 5, 6, 7], enrollments7d: [2, 3, 4, 5, 6, 7, 8] },
        breakdown: {
          credentialedPct: 90,
          activeEnrollmentsPct: 80,
          expiredCredsPenalty: 5,
          caqhCurrentPct: 75,
        },
      };

      vi.mocked(getCached).mockReturnValueOnce(cachedResult);

      const result = await computeHealthScore();

      expect(result).toEqual(cachedResult);
      // Should NOT have queried Prisma at all
      expect(prismaMock.provider.count).not.toHaveBeenCalled();
    });

    it('calls setCache after computing a fresh result', async () => {
      mockCounts();

      await computeHealthScore();

      expect(setCache).toHaveBeenCalledTimes(1);
      expect(setCache).toHaveBeenCalledWith(
        expect.stringContaining('health-score:'),
        expect.objectContaining({ credentialingHealthScore: expect.any(Number) }),
        300_000, // 5 minute TTL
      );
    });
  });

  // ─── Error handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns zeros object when Prisma throws an error', async () => {
      prismaMock.provider.count.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await computeHealthScore();

      expect(result).toEqual({
        credentialingHealthScore: 0,
        revenueAtRisk: 0,
        aiActionsToday: 0,
        trendData: { providers7d: [], enrollments7d: [] },
        breakdown: {
          credentialedPct: 0,
          activeEnrollmentsPct: 0,
          expiredCredsPenalty: 0,
          caqhCurrentPct: 0,
        },
      });
    });
  });

  // ─── Trend data ─────────────────────────────────────────────────────

  describe('trend data', () => {
    it('returns 7-element arrays for both providers7d and enrollments7d', async () => {
      const providerTrend = [3, 5, 2, 4, 6, 1, 7];
      const enrollmentTrend = [10, 8, 12, 9, 11, 7, 13];

      mockCounts({ providerTrend, enrollmentTrend });

      const result = await computeHealthScore();

      expect(result.trendData.providers7d).toHaveLength(7);
      expect(result.trendData.providers7d).toEqual(providerTrend);
      expect(result.trendData.enrollments7d).toHaveLength(7);
      expect(result.trendData.enrollments7d).toEqual(enrollmentTrend);
    });
  });

  // ─── AI actions ─────────────────────────────────────────────────────

  describe('aiActionsToday', () => {
    it('passes through the agentEvent count', async () => {
      mockCounts({ aiActions: 42 });

      const result = await computeHealthScore();

      expect(result.aiActionsToday).toBe(42);
    });
  });

  // ─── Practice filter ────────────────────────────────────────────────

  describe('practice filter', () => {
    it('uses a distinct cache key per practice filter', async () => {
      mockCounts();

      await computeHealthScore({ practiceId: 'abc-123' });

      expect(getCached).toHaveBeenCalledWith(
        'health-score:{"practiceId":"abc-123"}',
      );
    });

    it('uses empty-object cache key when no filter provided', async () => {
      mockCounts();

      await computeHealthScore();

      expect(getCached).toHaveBeenCalledWith('health-score:{}');
    });
  });
});
