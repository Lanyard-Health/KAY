import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../helpers/mock-prisma.js';

// ==========================================
// Mocks
// ==========================================

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/utils/cache.js', () => ({
  getCached: vi.fn(() => undefined),
  setCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

import {
  getOpsDashboardStats,
  getPracticesOverview,
  getStaffWorkload,
  getSlaSummary,
} from '../../src/services/ops.service.js';

// ==========================================
// 1. getOpsDashboardStats
// ==========================================

describe('getOpsDashboardStats', () => {
  beforeEach(() => {
    prismaMock.practice.count.mockResolvedValue(0);
    prismaMock.practice.groupBy.mockResolvedValue([]);
    prismaMock.provider.count.mockResolvedValue(0);
    prismaMock.provider.groupBy.mockResolvedValue([]);
    prismaMock.payerEnrollment.count.mockResolvedValue(0);
    prismaMock.payerEnrollment.groupBy.mockResolvedValue([]);
    prismaMock.payerEnrollment.findMany.mockResolvedValue([]);
    prismaMock.opsWorkItem.groupBy.mockResolvedValue([]);
  });

  it('returns proper structure with all zero stats', async () => {
    const result = await getOpsDashboardStats();

    expect(result).toEqual({
      totalPractices: 0,
      byServiceTier: {},
      totalProviders: 0,
      providersByStatus: {},
      totalEnrollments: 0,
      enrollmentsByStatus: {},
      slaHealth: { onTrack: 0, atRisk: 0, breached: 0 },
      workItems: { total: 0, byStatus: {} },
    });
  });

  it('returns correct counts when data exists', async () => {
    prismaMock.practice.count.mockResolvedValue(5);
    prismaMock.practice.groupBy.mockResolvedValue([
      { serviceTier: 'full_service', _count: 3 },
      { serviceTier: 'self_serve', _count: 2 },
    ] as any);
    prismaMock.provider.count.mockResolvedValue(10);
    prismaMock.provider.groupBy.mockResolvedValue([
      { status: 'active', _count: 8 },
      { status: 'inactive', _count: 2 },
    ] as any);
    prismaMock.payerEnrollment.count.mockResolvedValue(15);
    prismaMock.payerEnrollment.groupBy.mockResolvedValue([
      { status: 'approved', _count: 5 },
      { status: 'submitted', _count: 10 },
    ] as any);
    prismaMock.payerEnrollment.findMany.mockResolvedValue([]);
    prismaMock.opsWorkItem.groupBy.mockResolvedValue([
      { status: 'todo', _count: 3 },
      { status: 'in_progress', _count: 2 },
    ] as any);

    const result = await getOpsDashboardStats();

    expect(result.totalPractices).toBe(5);
    expect(result.byServiceTier).toEqual({ full_service: 3, self_serve: 2 });
    expect(result.totalProviders).toBe(10);
    expect(result.providersByStatus).toEqual({ active: 8, inactive: 2 });
    expect(result.totalEnrollments).toBe(15);
    expect(result.enrollmentsByStatus).toEqual({ approved: 5, submitted: 10 });
    expect(result.workItems).toEqual({ total: 5, byStatus: { todo: 3, in_progress: 2 } });
  });

  it('classifies SLA health correctly', async () => {
    const now = Date.now();
    const createdAt = new Date(now - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    const slaTarget = new Date(now + 10 * 24 * 60 * 60 * 1000); // 10 days from now (>75% elapsed)
    const slaTargetFar = new Date(now + 200 * 24 * 60 * 60 * 1000); // 200 days from now (<75%)

    prismaMock.payerEnrollment.findMany.mockResolvedValue([
      // breached
      { createdAt, slaTargetDate: slaTarget, slaBreachedAt: new Date() },
      // at risk (75%+ elapsed)
      { createdAt, slaTargetDate: slaTarget, slaBreachedAt: null },
      // on track (no target)
      { createdAt, slaTargetDate: null, slaBreachedAt: null },
      // on track (far target)
      { createdAt, slaTargetDate: slaTargetFar, slaBreachedAt: null },
    ] as any);

    const result = await getOpsDashboardStats();

    expect(result.slaHealth.breached).toBe(1);
    expect(result.slaHealth.atRisk).toBe(1);
    expect(result.slaHealth.onTrack).toBe(2);
  });

  it('throws when prisma query fails', async () => {
    prismaMock.practice.count.mockRejectedValue(new Error('DB connection failed'));

    await expect(getOpsDashboardStats()).rejects.toThrow('DB connection failed');
  });
});

// ==========================================
// 2. getPracticesOverview
// ==========================================

describe('getPracticesOverview', () => {
  beforeEach(() => {
    prismaMock.practice.findMany.mockResolvedValue([]);
    prismaMock.practice.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it('returns empty list with pagination metadata', async () => {
    const result = await getPracticesOverview();

    expect(result).toEqual({
      practices: [],
      total: 0,
      page: 1,
      limit: 20,
    });
  });

  it('returns practice items with correct structure', async () => {
    prismaMock.practice.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Test Practice',
        serviceTier: 'full_service',
        slaTargetDays: 30,
        primaryOpsStaffId: 'staff-1',
        _count: { providers: 3 },
        providers: [
          {
            payerEnrollments: [
              { id: 'e1', createdAt: new Date(), slaTargetDate: null, slaBreachedAt: null, status: 'submitted' },
            ],
          },
        ],
        opsWorkItems: [{ updatedAt: new Date('2026-01-15') }],
      },
    ] as any);
    prismaMock.practice.count.mockResolvedValue(1);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'staff-1', firstName: 'John', lastName: 'Doe' },
    ] as any);

    const result = await getPracticesOverview();

    expect(result.practices).toHaveLength(1);
    expect(result.practices[0]).toEqual(
      expect.objectContaining({
        id: 'p1',
        name: 'Test Practice',
        serviceTier: 'full_service',
        slaTargetDays: 30,
        providerCount: 3,
        enrollmentCount: 1,
        primaryOpsStaff: { firstName: 'John', lastName: 'Doe' },
      }),
    );
    expect(result.total).toBe(1);
  });

  it('applies search filter', async () => {
    prismaMock.practice.findMany.mockResolvedValue([]);
    prismaMock.practice.count.mockResolvedValue(0);

    await getPracticesOverview({ search: 'clinic' });

    expect(prismaMock.practice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'clinic', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('applies serviceTier filter', async () => {
    prismaMock.practice.findMany.mockResolvedValue([]);
    prismaMock.practice.count.mockResolvedValue(0);

    await getPracticesOverview({ serviceTier: 'white_glove' });

    expect(prismaMock.practice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serviceTier: 'white_glove',
        }),
      }),
    );
  });

  it('respects pagination parameters', async () => {
    prismaMock.practice.findMany.mockResolvedValue([]);
    prismaMock.practice.count.mockResolvedValue(50);

    const result = await getPracticesOverview({ page: 3, limit: 10 });

    expect(prismaMock.practice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 10,
      }),
    );
    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
  });

  it('returns null for primaryOpsStaff when no staff assigned', async () => {
    prismaMock.practice.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Test',
        serviceTier: 'self_serve',
        slaTargetDays: 30,
        primaryOpsStaffId: null,
        _count: { providers: 0 },
        providers: [],
        opsWorkItems: [],
      },
    ] as any);
    prismaMock.practice.count.mockResolvedValue(1);

    const result = await getPracticesOverview();

    expect(result.practices[0]!.primaryOpsStaff).toBeNull();
  });
});

// ==========================================
// 3. getStaffWorkload
// ==========================================

describe('getStaffWorkload', () => {
  beforeEach(() => {
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it('returns empty array when no ops_staff found', async () => {
    const result = await getStaffWorkload();
    expect(result).toEqual([]);
  });

  it('returns staff workload with correct structure', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'staff-1', firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com' },
    ] as any);
    prismaMock.opsWorkItem.groupBy.mockResolvedValue([]);
    prismaMock.opsWorkItem.findMany.mockResolvedValue([]);
    prismaMock.opsAssignment.groupBy.mockResolvedValue([]);

    const result = await getStaffWorkload();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'staff-1',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@test.com',
      openItems: 0,
      overdueItems: 0,
      completedThisWeek: 0,
      avgTurnaroundDays: null,
      assignedPractices: 0,
    });
  });

  it('calculates open and overdue counts correctly', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 's1', firstName: 'A', lastName: 'B', email: 'a@test.com' },
    ] as any);
    prismaMock.opsWorkItem.groupBy
      .mockResolvedValueOnce([{ assignedToId: 's1', _count: 5 }] as any) // open
      .mockResolvedValueOnce([{ assignedToId: 's1', _count: 2 }] as any) // overdue
      .mockResolvedValueOnce([{ assignedToId: 's1', _count: 3 }] as any); // completed this week
    prismaMock.opsWorkItem.findMany.mockResolvedValue([]); // recent completed
    prismaMock.opsAssignment.groupBy.mockResolvedValue([
      { staffId: 's1', _count: 4 },
    ] as any);

    const result = await getStaffWorkload();

    expect(result[0]!.openItems).toBe(5);
    expect(result[0]!.overdueItems).toBe(2);
    expect(result[0]!.completedThisWeek).toBe(3);
    expect(result[0]!.assignedPractices).toBe(4);
  });

  it('computes average turnaround days', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 's1', firstName: 'A', lastName: 'B', email: 'a@test.com' },
    ] as any);
    prismaMock.opsWorkItem.groupBy.mockResolvedValue([]);
    prismaMock.opsWorkItem.findMany.mockResolvedValue([
      {
        assignedToId: 's1',
        startedAt: new Date('2026-02-01'),
        completedAt: new Date('2026-02-03'),
      },
      {
        assignedToId: 's1',
        startedAt: new Date('2026-02-05'),
        completedAt: new Date('2026-02-10'),
      },
    ] as any);
    prismaMock.opsAssignment.groupBy.mockResolvedValue([]);

    const result = await getStaffWorkload();

    // (2 + 5) / 2 = 3.5
    expect(result[0]!.avgTurnaroundDays).toBe(3.5);
  });

  it('filters by staffId when provided', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);

    await getStaffWorkload('specific-staff-id');

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'specific-staff-id',
          role: 'ops_staff',
          isActive: true,
        }),
      }),
    );
  });
});

// ==========================================
// 4. getSlaSummary
// ==========================================

describe('getSlaSummary', () => {
  it('returns all zeros when no active enrollments', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

    const result = await getSlaSummary();

    expect(result).toEqual({
      totalActive: 0,
      onTrack: 0,
      atRisk: 0,
      breached: 0,
      breachedEnrollments: [],
    });
  });

  it('classifies enrollments correctly and returns breached details', async () => {
    const now = Date.now();
    const createdAt = new Date(now - 100 * 24 * 60 * 60 * 1000);
    const slaTargetNear = new Date(now + 5 * 24 * 60 * 60 * 1000);
    const slaTargetFar = new Date(now + 300 * 24 * 60 * 60 * 1000);

    prismaMock.payerEnrollment.findMany.mockResolvedValue([
      // breached
      {
        id: 'e1',
        createdAt,
        slaTargetDate: slaTargetNear,
        slaBreachedAt: new Date(),
        status: 'submitted',
        provider: { firstName: 'Jane', lastName: 'Doe', practice: { name: 'Test Practice' } },
        payer: { name: 'Aetna' },
      },
      // on track (no target)
      {
        id: 'e2',
        createdAt,
        slaTargetDate: null,
        slaBreachedAt: null,
        status: 'submitted',
        provider: { firstName: 'John', lastName: 'Smith', practice: null },
        payer: { name: 'BCBS' },
      },
      // on track (far target)
      {
        id: 'e3',
        createdAt,
        slaTargetDate: slaTargetFar,
        slaBreachedAt: null,
        status: 'in_progress',
        provider: { firstName: 'A', lastName: 'B', practice: { name: 'Clinic' } },
        payer: { name: 'Cigna' },
      },
    ] as any);

    const result = await getSlaSummary();

    expect(result.totalActive).toBe(3);
    expect(result.breached).toBe(1);
    expect(result.onTrack).toBe(2);
    expect(result.breachedEnrollments).toHaveLength(1);
    expect(result.breachedEnrollments[0]).toEqual(
      expect.objectContaining({
        enrollmentId: 'e1',
        providerName: 'Jane Doe',
        payerName: 'Aetna',
        practiceName: 'Test Practice',
      }),
    );
  });

  it('filters by practiceId when provided', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

    await getSlaSummary({ practiceId: 'p1' });

    expect(prismaMock.payerEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: { practiceId: 'p1' },
        }),
      }),
    );
  });

  it('filters by payerId when provided', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

    await getSlaSummary({ payerId: 'payer-1' });

    expect(prismaMock.payerEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payerId: 'payer-1',
        }),
      }),
    );
  });

  it('returns "Unassigned" for practice name when practice is null', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([
      {
        id: 'e1',
        createdAt: new Date(),
        slaTargetDate: new Date(),
        slaBreachedAt: new Date(),
        status: 'submitted',
        provider: { firstName: 'Jane', lastName: 'Doe', practice: null },
        payer: { name: 'Aetna' },
      },
    ] as any);

    const result = await getSlaSummary();

    expect(result.breachedEnrollments[0]!.practiceName).toBe('Unassigned');
  });
});
