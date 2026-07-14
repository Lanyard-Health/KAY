import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { getAdminDashboard } from './admin-dashboard.service.js';

const enrollment = (over: Record<string, unknown>) => ({
  id: 'e1',
  status: 'submitted',
  applicationDate: new Date('2026-07-01'),
  effectiveDate: null,
  nextFollowUpDate: null,
  practice: { id: 'p1', name: 'Real Practice', isDemo: false, deletedAt: null },
  provider: null,
  payerTrack: null,
  ...over,
});

describe('getAdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts only ACTIVE, non-deleted, non-demo practices and non-draft enrollments of non-deleted providers', async () => {
    prismaMock.practice.count.mockResolvedValue(3);
    prismaMock.enrollment.findMany.mockResolvedValue([enrollment({})] as any);

    const result = await getAdminDashboard();

    expect(prismaMock.practice.count).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', deletedAt: null, isDemo: false },
    });
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isDraft: false,
          OR: [{ providerId: null }, { provider: { deletedAt: null } }],
        },
      }),
    );
    expect(result.tiles.activePractices).toBe(3);
    expect(result.tiles.openApplications).toBe(1);
  });

  it('excludes demo and soft-deleted practices from tiles and churn risk entirely', async () => {
    prismaMock.practice.count.mockResolvedValue(1);
    prismaMock.enrollment.findMany.mockResolvedValue([
      enrollment({ id: 'e1' }),
      enrollment({
        id: 'e2',
        practice: { id: 'p2', name: 'Demo Practice', isDemo: true, deletedAt: null },
        nextFollowUpDate: new Date('2020-01-01'),
      }),
      enrollment({
        id: 'e3',
        practice: { id: 'p3', name: 'Deleted Practice', isDemo: false, deletedAt: new Date('2026-01-01') },
      }),
    ] as any);

    const result = await getAdminDashboard();

    expect(result.tiles.openApplications).toBe(1);
    expect(result.churnRisk.every((c) => c.practiceId === 'p1' || c.practiceId !== 'p2')).toBe(true);
    expect(result.churnRisk.find((c) => c.practiceId === 'p2')).toBeUndefined();
    expect(result.churnRisk.find((c) => c.practiceId === 'p3')).toBeUndefined();
  });

  it('resolves the practice through the provider and still filters demo there', async () => {
    prismaMock.practice.count.mockResolvedValue(1);
    prismaMock.enrollment.findMany.mockResolvedValue([
      enrollment({
        id: 'e1',
        practice: null,
        provider: { practiceId: 'p2', practice: { id: 'p2', name: 'Demo', isDemo: true, deletedAt: null } },
      }),
    ] as any);

    const result = await getAdminDashboard();

    expect(result.tiles.openApplications).toBe(0);
  });
});
