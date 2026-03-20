import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getCached, setCache } from '../utils/cache.js';
import { getPracticeProviderFilter } from '../middleware/practiceScope.middleware.js';
import { computeHealthScore } from '../services/health-score.service.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'credentialing_staff', 'practice_admin'));

const CACHE_KEY = 'dashboard:stats';
const CACHE_TTL = 60_000; // 60 seconds

/**
 * GET /api/v1/dashboard/stats
 * Lightweight aggregated stats for the dashboard
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const cached = getCached<Record<string, unknown>>(CACHE_KEY);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }

    const practiceFilter = getPracticeProviderFilter(req);

    // Provider counts by status — single groupBy query
    const statusCounts = await prisma.providerProfile.groupBy({
      by: ['status'],
      _count: true,
    });

    let totalProviders = 0;
    let activeProviders = 0;
    let pendingProviders = 0;
    for (const row of statusCounts) {
      totalProviders += row._count;
      if (row.status === 'active') activeProviders = row._count;
      if (row.status === 'pending') pendingProviders = row._count;
    }

    // Incomplete providers: active/pending providers missing documents, licenses, or certs
    const incompleteProviders = await prisma.providerProfile.findMany({
      where: {
        status: { in: ['active', 'pending'] },
        OR: [
          { documents: { none: {} } },
          { licenses: { none: {} } },
          { boardCertifications: { none: {} } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        _count: { select: { documents: true, licenses: true, boardCertifications: true } },
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    const incompleteCount = await prisma.providerProfile.count({
      where: {
        status: { in: ['active', 'pending'] },
        OR: [
          { documents: { none: {} } },
          { licenses: { none: {} } },
          { boardCertifications: { none: {} } },
        ],
      },
    });

    // Follow-up enrollments: not approved/terminated, stale or no follow-up, top 5
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const needsFollowUp = await prisma.payerEnrollment.findMany({
      where: {
        status: { notIn: ['approved', 'terminated'] },
        OR: [
          { lastFollowUpDate: null },
          { lastFollowUpDate: { lt: sevenDaysAgo } },
        ],
      },
      select: {
        id: true,
        status: true,
        lastFollowUpDate: true,
        payer: { select: { name: true } },
        provider: { select: { firstName: true, lastName: true } },
      },
      take: 5,
      orderBy: { updatedAt: 'asc' },
    });

    const followUpCount = await prisma.payerEnrollment.count({
      where: {
        status: { notIn: ['approved', 'terminated'] },
        OR: [
          { lastFollowUpDate: null },
          { lastFollowUpDate: { lt: sevenDaysAgo } },
        ],
      },
    });

    // Active enrollment count
    const activeEnrollments = await prisma.payerEnrollment.count({
      where: {
        status: { notIn: ['terminated', 'denied'] },
        provider: practiceFilter,
      },
    });

    // Health score + trends (cached separately at 5min TTL)
    const healthData = await computeHealthScore(practiceFilter);

    const result = {
      totalProviders,
      activeProviders,
      pendingProviders,
      activeEnrollments,
      incompleteProviders,
      incompleteCount,
      needsFollowUp,
      followUpCount,
      credentialingHealthScore: healthData.credentialingHealthScore,
      revenueAtRisk: healthData.revenueAtRisk,
      aiActionsToday: healthData.aiActionsToday,
      trendData: healthData.trendData,
      healthBreakdown: healthData.breakdown,
    };

    setCache(CACHE_KEY, result, CACHE_TTL);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' });
  }
});

export default router;
