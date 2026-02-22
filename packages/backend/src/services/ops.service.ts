import { prisma } from '../utils/prisma.js';
import { getCached, setCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import type { EnrollmentStatus, OpsWorkItemStatus, Prisma } from '@prisma/client';

const CACHE_PREFIX = 'ops:';
const CACHE_TTL = 60_000; // 60 seconds

// Terminal enrollment statuses — not actively being worked
const TERMINAL_STATUSES: EnrollmentStatus[] = ['approved', 'denied', 'terminated'];
const CLOSED_WORK_STATUSES: OpsWorkItemStatus[] = ['done', 'cancelled'];

// ─── Helpers ────────────────────────────────────────────────────────

function startOfWeek(): Date {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const start = new Date(now.getFullYear(), now.getMonth(), diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function thirtyDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Compute SLA health for a set of enrollments.
 * - onTrack: no slaTargetDate OR elapsed < 75%
 * - atRisk: slaTargetDate exists, not breached, elapsed >= 75%
 * - breached: slaBreachedAt IS NOT NULL
 */
function classifySlaHealth(
  enrollments: Array<{
    createdAt: Date;
    slaTargetDate: Date | null;
    slaBreachedAt: Date | null;
  }>,
): { onTrack: number; atRisk: number; breached: number } {
  const now = Date.now();
  let onTrack = 0;
  let atRisk = 0;
  let breached = 0;

  for (const e of enrollments) {
    if (e.slaBreachedAt) {
      breached++;
    } else if (e.slaTargetDate) {
      const total = e.slaTargetDate.getTime() - e.createdAt.getTime();
      const elapsed = now - e.createdAt.getTime();
      if (total > 0 && elapsed / total >= 0.75) {
        atRisk++;
      } else {
        onTrack++;
      }
    } else {
      onTrack++;
    }
  }

  return { onTrack, atRisk, breached };
}

// ─── 1. Dashboard Stats ────────────────────────────────────────────

export interface OpsDashboardStats {
  totalPractices: number;
  byServiceTier: Record<string, number>;
  totalProviders: number;
  providersByStatus: Record<string, number>;
  totalEnrollments: number;
  enrollmentsByStatus: Record<string, number>;
  slaHealth: { onTrack: number; atRisk: number; breached: number };
  workItems: { total: number; byStatus: Record<string, number> };
}

export async function getOpsDashboardStats(): Promise<OpsDashboardStats> {
  const cacheKey = CACHE_PREFIX + 'dashboard-stats';
  const cached = getCached<OpsDashboardStats>(cacheKey);
  if (cached) return cached;

  try {
    const [
      totalPractices,
      practicesByTier,
      totalProviders,
      providersByStatus,
      totalEnrollments,
      enrollmentsByStatus,
      activeEnrollments,
      workItemsByStatus,
    ] = await Promise.all([
      prisma.practice.count(),
      prisma.practice.groupBy({ by: ['serviceTier'], _count: true }),
      prisma.provider.count(),
      prisma.provider.groupBy({ by: ['status'], _count: true }),
      prisma.payerEnrollment.count(),
      prisma.payerEnrollment.groupBy({ by: ['status'], _count: true }),
      prisma.payerEnrollment.findMany({
        where: { status: { notIn: TERMINAL_STATUSES } },
        select: { createdAt: true, slaTargetDate: true, slaBreachedAt: true },
      }),
      prisma.opsWorkItem.groupBy({
        by: ['status'],
        where: { status: { notIn: CLOSED_WORK_STATUSES } },
        _count: true,
      }),
    ]);

    const byServiceTier: Record<string, number> = {};
    for (const row of practicesByTier) {
      byServiceTier[row.serviceTier] = row._count;
    }

    const provByStatus: Record<string, number> = {};
    for (const row of providersByStatus) {
      provByStatus[row.status] = row._count;
    }

    const enrByStatus: Record<string, number> = {};
    for (const row of enrollmentsByStatus) {
      enrByStatus[row.status] = row._count;
    }

    const slaHealth = classifySlaHealth(activeEnrollments);

    const workItemStatusMap: Record<string, number> = {};
    let workItemTotal = 0;
    for (const row of workItemsByStatus) {
      workItemStatusMap[row.status] = row._count;
      workItemTotal += row._count;
    }

    const result: OpsDashboardStats = {
      totalPractices,
      byServiceTier,
      totalProviders,
      providersByStatus: provByStatus,
      totalEnrollments,
      enrollmentsByStatus: enrByStatus,
      slaHealth,
      workItems: { total: workItemTotal, byStatus: workItemStatusMap },
    };

    setCache(cacheKey, result, CACHE_TTL);
    return result;
  } catch (error) {
    logger.error('Failed to fetch ops dashboard stats', { error });
    throw error;
  }
}

// ─── 2. Practices Overview ─────────────────────────────────────────

export interface PracticeOverviewItem {
  id: string;
  name: string;
  serviceTier: string;
  slaTargetDays: number;
  providerCount: number;
  enrollmentCount: number;
  primaryOpsStaff: { firstName: string; lastName: string } | null;
  lastActivity: Date | null;
  slaHealth: { atRisk: number; breached: number };
}

export interface PracticesOverviewResult {
  practices: PracticeOverviewItem[];
  total: number;
  page: number;
  limit: number;
}

export async function getPracticesOverview(filters?: {
  search?: string;
  serviceTier?: string;
  page?: number;
  limit?: number;
}): Promise<PracticesOverviewResult> {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  try {
    const where: Prisma.PracticeWhereInput = {};

    if (filters?.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    if (filters?.serviceTier) {
      where.serviceTier = filters.serviceTier as Prisma.EnumServiceTierFilter['equals'];
    }

    const [practices, total] = await Promise.all([
      prisma.practice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          serviceTier: true,
          slaTargetDays: true,
          primaryOpsStaffId: true,
          _count: {
            select: { providers: true },
          },
          providers: {
            select: {
              payerEnrollments: {
                select: {
                  id: true,
                  createdAt: true,
                  slaTargetDate: true,
                  slaBreachedAt: true,
                  status: true,
                },
              },
            },
          },
          opsWorkItems: {
            select: { updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.practice.count({ where }),
    ]);

    // Fetch primary ops staff names for all practices that have one
    const staffIds = practices
      .map((p) => p.primaryOpsStaffId)
      .filter((id): id is string => id !== null);

    const staffMap = new Map<string, { firstName: string; lastName: string }>();
    if (staffIds.length > 0) {
      const staffUsers = await prisma.user.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      for (const u of staffUsers) {
        staffMap.set(u.id, { firstName: u.firstName, lastName: u.lastName });
      }
    }

    const items: PracticeOverviewItem[] = practices.map((p) => {
      // Count enrollments across all providers
      let enrollmentCount = 0;
      const activeEnrollments: Array<{
        createdAt: Date;
        slaTargetDate: Date | null;
        slaBreachedAt: Date | null;
      }> = [];

      for (const prov of p.providers) {
        enrollmentCount += prov.payerEnrollments.length;
        for (const enr of prov.payerEnrollments) {
          if (!TERMINAL_STATUSES.includes(enr.status)) {
            activeEnrollments.push(enr);
          }
        }
      }

      const slaHealth = classifySlaHealth(activeEnrollments);

      return {
        id: p.id,
        name: p.name,
        serviceTier: p.serviceTier,
        slaTargetDays: p.slaTargetDays,
        providerCount: p._count.providers,
        enrollmentCount,
        primaryOpsStaff: p.primaryOpsStaffId
          ? staffMap.get(p.primaryOpsStaffId) ?? null
          : null,
        lastActivity: p.opsWorkItems[0]?.updatedAt ?? null,
        slaHealth: { atRisk: slaHealth.atRisk, breached: slaHealth.breached },
      };
    });

    return { practices: items, total, page, limit };
  } catch (error) {
    logger.error('Failed to fetch practices overview', { error });
    throw error;
  }
}

// ─── 3. Staff Workload ─────────────────────────────────────────────

export interface StaffWorkloadItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  openItems: number;
  overdueItems: number;
  completedThisWeek: number;
  avgTurnaroundDays: number | null;
  assignedPractices: number;
}

export async function getStaffWorkload(
  staffId?: string,
): Promise<StaffWorkloadItem[]> {
  const cacheKey = CACHE_PREFIX + 'staff-workload:' + (staffId ?? 'all');
  const cached = getCached<StaffWorkloadItem[]>(cacheKey);
  if (cached) return cached;

  try {
    const staffWhere: Prisma.UserWhereInput = { role: 'ops_staff', isActive: true };
    if (staffId) {
      staffWhere.id = staffId;
    }

    const staffUsers = await prisma.user.findMany({
      where: staffWhere,
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { lastName: 'asc' },
    });

    if (staffUsers.length === 0) {
      return [];
    }

    const staffUserIds = staffUsers.map((u) => u.id);
    const now = new Date();
    const weekStart = startOfWeek();
    const thirtyDays = thirtyDaysAgo();

    // Batch queries for all staff at once
    const [openCounts, overdueCounts, completedCounts, recentCompleted, assignmentCounts] =
      await Promise.all([
        // Open items per staff
        prisma.opsWorkItem.groupBy({
          by: ['assignedToId'],
          where: {
            assignedToId: { in: staffUserIds },
            status: { notIn: CLOSED_WORK_STATUSES },
          },
          _count: true,
        }),

        // Overdue items per staff
        prisma.opsWorkItem.groupBy({
          by: ['assignedToId'],
          where: {
            assignedToId: { in: staffUserIds },
            status: { notIn: CLOSED_WORK_STATUSES },
            dueDate: { lt: now },
          },
          _count: true,
        }),

        // Completed this week per staff
        prisma.opsWorkItem.groupBy({
          by: ['assignedToId'],
          where: {
            assignedToId: { in: staffUserIds },
            status: 'done',
            completedAt: { gte: weekStart },
          },
          _count: true,
        }),

        // Recent completed items for turnaround calc (last 30 days)
        prisma.opsWorkItem.findMany({
          where: {
            assignedToId: { in: staffUserIds },
            status: 'done',
            completedAt: { gte: thirtyDays },
            startedAt: { not: null },
          },
          select: { assignedToId: true, startedAt: true, completedAt: true },
        }),

        // Active assignments with practiceId
        prisma.opsAssignment.groupBy({
          by: ['staffId'],
          where: {
            staffId: { in: staffUserIds },
            practiceId: { not: null },
            unassignedAt: null,
          },
          _count: true,
        }),
      ]);

    // Build lookup maps
    const openMap = new Map(
      openCounts.map((r) => [r.assignedToId, r._count]),
    );
    const overdueMap = new Map(
      overdueCounts.map((r) => [r.assignedToId, r._count]),
    );
    const completedMap = new Map(
      completedCounts.map((r) => [r.assignedToId, r._count]),
    );
    const assignmentMap = new Map(
      assignmentCounts.map((r) => [r.staffId, r._count]),
    );

    // Compute avg turnaround per staff
    const turnaroundMap = new Map<string, number | null>();
    const turnaroundAccum = new Map<string, number[]>();

    for (const item of recentCompleted) {
      if (!item.assignedToId || !item.startedAt || !item.completedAt) continue;
      const days =
        (item.completedAt.getTime() - item.startedAt.getTime()) /
        (1000 * 60 * 60 * 24);
      const list = turnaroundAccum.get(item.assignedToId) ?? [];
      list.push(days);
      turnaroundAccum.set(item.assignedToId, list);
    }

    for (const [sid, daysList] of turnaroundAccum) {
      const avg = daysList.reduce((a, b) => a + b, 0) / daysList.length;
      turnaroundMap.set(sid, Math.round(avg * 10) / 10);
    }

    const result: StaffWorkloadItem[] = staffUsers.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      openItems: openMap.get(u.id) ?? 0,
      overdueItems: overdueMap.get(u.id) ?? 0,
      completedThisWeek: completedMap.get(u.id) ?? 0,
      avgTurnaroundDays: turnaroundMap.get(u.id) ?? null,
      assignedPractices: assignmentMap.get(u.id) ?? 0,
    }));

    setCache(cacheKey, result, CACHE_TTL);
    return result;
  } catch (error) {
    logger.error('Failed to fetch staff workload', { error });
    throw error;
  }
}

// ─── 4. SLA Summary ────────────────────────────────────────────────

export interface BreachedEnrollmentDetail {
  enrollmentId: string;
  providerName: string;
  payerName: string;
  practiceName: string;
  slaTargetDate: Date | null;
  slaBreachedAt: Date | null;
}

export interface SlaSummaryResult {
  totalActive: number;
  onTrack: number;
  atRisk: number;
  breached: number;
  breachedEnrollments: BreachedEnrollmentDetail[];
}

export async function getSlaSummary(filters?: {
  practiceId?: string;
  payerId?: string;
}): Promise<SlaSummaryResult> {
  const cacheKey =
    CACHE_PREFIX +
    'sla-summary:' +
    (filters?.practiceId ?? '') +
    ':' +
    (filters?.payerId ?? '');
  const cached = getCached<SlaSummaryResult>(cacheKey);
  if (cached) return cached;

  try {
    const where: Prisma.PayerEnrollmentWhereInput = {
      status: { notIn: TERMINAL_STATUSES },
    };

    if (filters?.payerId) {
      where.payerId = filters.payerId;
    }

    if (filters?.practiceId) {
      where.provider = { practiceId: filters.practiceId };
    }

    const activeEnrollments = await prisma.payerEnrollment.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        slaTargetDate: true,
        slaBreachedAt: true,
        status: true,
        provider: {
          select: {
            firstName: true,
            lastName: true,
            practice: { select: { name: true } },
          },
        },
        payer: { select: { name: true } },
      },
    });

    const totalActive = activeEnrollments.length;
    let onTrack = 0;
    let atRisk = 0;
    let breached = 0;
    const breachedEnrollments: BreachedEnrollmentDetail[] = [];
    const now = Date.now();

    for (const e of activeEnrollments) {
      if (e.slaBreachedAt) {
        breached++;
        breachedEnrollments.push({
          enrollmentId: e.id,
          providerName: `${e.provider.firstName} ${e.provider.lastName}`,
          payerName: e.payer.name,
          practiceName: e.provider.practice?.name ?? 'Unassigned',
          slaTargetDate: e.slaTargetDate,
          slaBreachedAt: e.slaBreachedAt,
        });
      } else if (e.slaTargetDate) {
        const total = e.slaTargetDate.getTime() - e.createdAt.getTime();
        const elapsed = now - e.createdAt.getTime();
        if (total > 0 && elapsed / total >= 0.75) {
          atRisk++;
        } else {
          onTrack++;
        }
      } else {
        onTrack++;
      }
    }

    const result: SlaSummaryResult = {
      totalActive,
      onTrack,
      atRisk,
      breached,
      breachedEnrollments,
    };

    setCache(cacheKey, result, CACHE_TTL);
    return result;
  } catch (error) {
    logger.error('Failed to fetch SLA summary', { error });
    throw error;
  }
}
