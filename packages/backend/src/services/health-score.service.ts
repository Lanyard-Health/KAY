import { prisma } from '../utils/prisma.js';
import { getCached, setCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

const CACHE_KEY = 'health-score:';
const CACHE_TTL = 300_000; // 5 minutes

export interface HealthScoreResult {
  credentialingHealthScore: number;
  revenueAtRisk: number;
  aiActionsToday: number;
  trendData: {
    providers7d: number[];
    enrollments7d: number[];
  };
  breakdown: {
    credentialedPct: number;
    activeEnrollmentsPct: number;
    expiredCredsPenalty: number;
    caqhCurrentPct: number;
  };
}

/**
 * Compute credentialing health score (0-100) and related metrics.
 *
 * Weights:
 * - Credentialed %     (30%) — active providers with ≥1 license + ≥1 cert
 * - Active enrollments (25%) — approved / total non-terminated enrollments
 * - Expired creds      (20%) — penalty for expired licenses/certs
 * - CAQH current       (15%) — providers with valid CAQH sync
 * - Completeness       (10%) — providers with docs + licenses + certs
 */
export async function computeHealthScore(
  practiceFilter: Record<string, unknown> = {},
): Promise<HealthScoreResult> {
  const cacheKey = CACHE_KEY + JSON.stringify(practiceFilter);
  const cached = getCached<HealthScoreResult>(cacheKey);
  if (cached) return cached;

  try {
    const providerWhere = { status: { in: ['active' as const, 'pending' as const] }, ...practiceFilter };

    // Parallel queries
    const [
      totalProviders,
      providersWithCreds,
      totalEnrollments,
      approvedEnrollments,
      expiredLicenses,
      totalLicenses,
      caqhCurrentProviders,
      completeProviders,
      aiActionsToday,
      providers7d,
      enrollments7d,
    ] = await Promise.all([
      // Total active/pending providers
      prisma.providerProfile.count({ where: providerWhere }),

      // Providers with at least 1 active license AND 1 cert
      prisma.providerProfile.count({
        where: {
          ...providerWhere,
          licenses: { some: { status: 'active' } },
          boardCertifications: { some: { status: 'active' } },
        },
      }),

      // Total non-terminated enrollments (excluding drafts)
      prisma.enrollment.count({
        where: {
          status: { not: 'terminated' },
          isDraft: false,
          provider: providerWhere,
        },
      }),

      // Approved enrollments (excluding drafts)
      prisma.enrollment.count({
        where: {
          status: 'approved',
          isDraft: false,
          provider: providerWhere,
        },
      }),

      // Expired licenses (past expiration, still marked active)
      prisma.license.count({
        where: {
          expirationDate: { lt: new Date() },
          provider: providerWhere,
        },
      }),

      // Total licenses
      prisma.license.count({
        where: { provider: providerWhere },
      }),

      // Providers with CAQH synced in last 90 days
      prisma.providerProfile.count({
        where: {
          ...providerWhere,
          caqhLastSync: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        },
      }),

      // Providers with at least 1 doc + 1 license + 1 cert
      prisma.providerProfile.count({
        where: {
          ...providerWhere,
          documents: { some: {} },
          licenses: { some: {} },
          boardCertifications: { some: {} },
        },
      }),

      // AI actions today (agent events created today)
      prisma.agentEvent.count({
        where: {
          timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),

      // 7-day provider trend
      get7DayTrend('provider', providerWhere),

      // 7-day enrollment trend
      get7DayEnrollmentTrend(providerWhere),
    ]);

    // Calculate percentages (avoid division by zero)
    const credentialedPct = totalProviders > 0
      ? Math.round((providersWithCreds / totalProviders) * 100)
      : 100;

    const activeEnrollmentsPct = totalEnrollments > 0
      ? Math.round((approvedEnrollments / totalEnrollments) * 100)
      : 100;

    const expiredCredsPenalty = totalLicenses > 0
      ? Math.round((expiredLicenses / totalLicenses) * 100)
      : 0;

    const caqhCurrentPct = totalProviders > 0
      ? Math.round((caqhCurrentProviders / totalProviders) * 100)
      : 100;

    const completenessPct = totalProviders > 0
      ? Math.round((completeProviders / totalProviders) * 100)
      : 100;

    // Weighted score
    const score = Math.round(
      credentialedPct * 0.30 +
      activeEnrollmentsPct * 0.25 +
      (100 - expiredCredsPenalty) * 0.20 +
      caqhCurrentPct * 0.15 +
      completenessPct * 0.10,
    );

    // Revenue at risk: $2,500/month per provider with expired or missing credentials
    const atRiskProviders = totalProviders - providersWithCreds;
    const revenueAtRisk = atRiskProviders * 2500;

    const result: HealthScoreResult = {
      credentialingHealthScore: Math.max(0, Math.min(100, score)),
      revenueAtRisk,
      aiActionsToday,
      trendData: {
        providers7d: providers7d,
        enrollments7d: enrollments7d,
      },
      breakdown: {
        credentialedPct,
        activeEnrollmentsPct,
        expiredCredsPenalty,
        caqhCurrentPct,
      },
    };

    setCache(cacheKey, result, CACHE_TTL);
    return result;
  } catch (error) {
    logger.error('Error computing health score:', error);
    return {
      credentialingHealthScore: 0,
      revenueAtRisk: 0,
      aiActionsToday: 0,
      trendData: { providers7d: [], enrollments7d: [] },
      breakdown: { credentialedPct: 0, activeEnrollmentsPct: 0, expiredCredsPenalty: 0, caqhCurrentPct: 0 },
    };
  }
}

/** Count providers created on each of the last 7 days */
async function get7DayTrend(
  _model: string,
  providerWhere: Record<string, unknown>,
): Promise<number[]> {
  const counts: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const count = await prisma.providerProfile.count({
      where: {
        ...providerWhere,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    });
    counts.push(count);
  }
  return counts;
}

/** Count enrollments created on each of the last 7 days */
async function get7DayEnrollmentTrend(
  providerWhere: Record<string, unknown>,
): Promise<number[]> {
  const counts: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const count = await prisma.enrollment.count({
      where: {
        provider: providerWhere,
        isDraft: false,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    });
    counts.push(count);
  }
  return counts;
}
