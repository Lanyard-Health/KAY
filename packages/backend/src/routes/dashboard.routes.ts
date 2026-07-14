import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getCached, setCache } from '../utils/cache.js';
import { getPracticeProviderFilter } from '../middleware/practiceScope.middleware.js';
import { computeHealthScore } from '../services/health-score.service.js';
import { getPracticeDashboard } from '../services/practice-dashboard.service.js';
import { getAdminDashboard } from '../services/admin-dashboard.service.js';
import { getStaffDashboard } from '../services/staff-dashboard.service.js';

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
    const practiceFilter = getPracticeProviderFilter(req);

    // Scope cache per practice so different practices don't share results
    const practiceIds = req.practiceScope?.practiceIds ?? [];
    const cacheKeySuffix = req.practiceScope?.isSuperAdmin
      ? 'global'
      : [...practiceIds].sort().join(',');
    const scopedCacheKey = `${CACHE_KEY}:${cacheKeySuffix}`;

    const cached = getCached<Record<string, unknown>>(scopedCacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }

    // Provider counts by status — single groupBy query
    const statusCounts = await prisma.providerProfile.groupBy({
      by: ['status'],
      where: practiceFilter,
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
        ...practiceFilter,
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
        ...practiceFilter,
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

    const needsFollowUp = await prisma.enrollment.findMany({
      where: {
        provider: practiceFilter,
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

    const followUpCount = await prisma.enrollment.count({
      where: {
        provider: practiceFilter,
        status: { notIn: ['approved', 'terminated'] },
        OR: [
          { lastFollowUpDate: null },
          { lastFollowUpDate: { lt: sevenDaysAgo } },
        ],
      },
    });

    // Active enrollment count
    const activeEnrollments = await prisma.enrollment.count({
      where: {
        status: { notIn: ['terminated', 'denied'] },
        provider: practiceFilter,
      },
    });

    // Follow-up engagement count: total FollowUpRun records for this practice's enrollments
    const followUpEngagementCount = await prisma.followUpRun.count({
      where: {
        enrollment: {
          provider: practiceFilter,
        },
      },
    });

    // Practice profile for practice_admin / credentialing_staff dashboard card
    let practiceProfile = null;
    if (practiceIds.length === 1) {
      practiceProfile = await prisma.practice.findUnique({
        where: { id: practiceIds[0] },
        select: {
          id: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          zipCode: true,
          states: true,
        },
      });
    }


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
      followUpEngagementCount,
      practiceProfile,
      credentialingHealthScore: healthData.credentialingHealthScore,
      aiActionsToday: healthData.aiActionsToday,
      trendData: healthData.trendData,
      healthBreakdown: healthData.breakdown,
    };

    setCache(scopedCacheKey, result, CACHE_TTL);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch dashboard stats' } });
  }
});

/**
 * GET /api/v1/dashboard/practice
 * Practice Admin transparency dashboard: tiles, charts, provider × payer grid,
 * in-flight ETA list, attention items. Practice-scoped.
 */
router.get('/practice', async (req: Request, res: Response) => {
  try {
    const isPlatformRole = req.practiceScope?.isSuperAdmin || req.user?.role === 'lanyard_staff';
    const viewAs = typeof req.query['practiceId'] === 'string' ? req.query['practiceId'] : null;

    // View-as: admin/lanyard_staff may render any single practice's dashboard.
    // Everyone else may only pass a practiceId inside their own scope.
    if (viewAs && !isPlatformRole && !(req.practiceScope?.practiceIds ?? []).includes(viewAs)) {
      res.status(403).json({ success: false, error: { message: 'Not authorized to view this practice' } });
      return;
    }

    const practiceFilter = viewAs
      ? { practiceId: { in: [viewAs] }, deletedAt: null } // same shape getPracticeProviderFilter produces
      : getPracticeProviderFilter(req);
    const scope = viewAs
      ? { practiceIds: [viewAs], isSuperAdmin: false }
      : { practiceIds: req.practiceScope?.practiceIds ?? [], isSuperAdmin: req.practiceScope?.isSuperAdmin ?? false };

    const cacheKey = `dashboard:practice:${viewAs ?? (scope.isSuperAdmin ? 'global' : [...scope.practiceIds].sort().join(','))}`;

    const cached = getCached<Record<string, unknown>>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }

    const data = await getPracticeDashboard(practiceFilter, scope);
    setCache(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error fetching practice dashboard:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch practice dashboard' } });
  }
});

/**
 * GET /api/v1/dashboard/staff
 * Credentialing Staff workload dashboard: tiles, urgency-sorted work queue,
 * pipeline + submissions charts. Practice-scoped (staff → own practice(s),
 * lanyard_staff/admin → all). practice_admin is blocked: the staff surface
 * uses shop-talk vocabulary banned on client surfaces.
 */
router.get('/staff', async (req: Request, res: Response) => {
  try {
    if (req.user?.role === 'practice_admin') {
      res.status(403).json({ success: false, error: { message: 'Not authorized' } });
      return;
    }
    const practiceFilter = getPracticeProviderFilter(req);
    const scope = {
      practiceIds: req.practiceScope?.practiceIds ?? [],
      isSuperAdmin: req.practiceScope?.isSuperAdmin ?? false,
    };
    // Scoped like /stats — credentialing_staff results are per-practice.
    const cacheKey = `dashboard:staff:${scope.isSuperAdmin ? 'global' : [...scope.practiceIds].sort().join(',')}`;

    const cached = getCached<Record<string, unknown>>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }
    const data = await getStaffDashboard(practiceFilter, scope);
    setCache(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error fetching staff dashboard:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch staff dashboard' } });
  }
});

/**
 * GET /api/v1/dashboard/admin
 * Lanyard Admin platform dashboard: platform tiles + churn-risk table.
 * admin + lanyard_staff only.
 */
router.get('/admin', async (req: Request, res: Response) => {
  try {
    if (!(req.practiceScope?.isSuperAdmin || req.user?.role === 'lanyard_staff')) {
      res.status(403).json({ success: false, error: { message: 'Not authorized' } });
      return;
    }
    const cacheKey = 'dashboard:admin';
    const cached = getCached<Record<string, unknown>>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }
    const data = await getAdminDashboard();
    setCache(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error fetching admin dashboard:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch admin dashboard' } });
  }
});

/**
 * GET /api/v1/dashboard/attestations
 * CAQH re-attestation board (B1): every tracked provider bucketed by urgency,
 * with the "nothing changed" diff verdict. Practice-scoped like /stats.
 */
router.get('/attestations', async (req: Request, res: Response) => {
  try {
    const practiceFilter = getPracticeProviderFilter(req);

    const trackers = await prisma.caqhAttestationTracker.findMany({
      where: { providerProfile: practiceFilter },
      select: {
        providerProfileId: true,
        providerStatus: true,
        lastAttestationDate: true,
        nextDueDate: true,
        diffVerdict: true,
        changedSections: true,
        providerProfile: {
          select: {
            firstName: true,
            lastName: true,
            practice: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { nextDueDate: 'asc' },
    });

    const todayUtc = Date.UTC(
      new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
    );

    const rows = trackers.map((t) => {
      const daysUntilDue = t.nextDueDate
        ? Math.round((Date.UTC(
            t.nextDueDate.getUTCFullYear(), t.nextDueDate.getUTCMonth(), t.nextDueDate.getUTCDate(),
          ) - todayUtc) / 86_400_000)
        : null;
      const isExpired = t.providerStatus === 'Expired Attestation'
        || (daysUntilDue !== null && daysUntilDue < 0);
      const bucket = isExpired
        ? 'overdue'
        : daysUntilDue === null
          ? 'untracked'
          : daysUntilDue <= 21
            ? 'dueSoon'
            : 'onTrack';
      return {
        providerId: t.providerProfileId,
        providerName: `${t.providerProfile.firstName} ${t.providerProfile.lastName}`,
        practice: t.providerProfile.practice,
        providerStatus: t.providerStatus,
        lastAttestationDate: t.lastAttestationDate,
        nextDueDate: t.nextDueDate,
        daysUntilDue,
        diffVerdict: t.diffVerdict,
        changedSections: t.changedSections,
        bucket,
      };
    });

    const counts = {
      overdue: rows.filter((r) => r.bucket === 'overdue').length,
      dueSoon: rows.filter((r) => r.bucket === 'dueSoon').length,
      onTrack: rows.filter((r) => r.bucket === 'onTrack').length,
      untracked: rows.filter((r) => r.bucket === 'untracked').length,
    };

    res.json({ success: true, data: { counts, providers: rows } });
  } catch (error) {
    logger.error('Error fetching attestation board:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch attestation board' } });
  }
});

export default router;
