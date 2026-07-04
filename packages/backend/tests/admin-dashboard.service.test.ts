import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

import { prismaMock } from './helpers/mock-prisma.js';
import {
  assembleAdminDashboard,
  getAdminDashboard,
  type AdminEnrollmentRow,
} from '../src/services/admin-dashboard.service.js';

const NOW = new Date('2026-07-03T12:00:00Z'); // Q3: Jul 1 – Sep 30
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function row(overrides: Partial<AdminEnrollmentRow>): AdminEnrollmentRow {
  return {
    id: 'e1',
    status: 'submitted',
    applicationDate: daysAgo(21),
    effectiveDate: null,
    nextFollowUpDate: null,
    practiceId: 'prac1',
    practiceName: 'Greens Health',
    timeline: { minDays: 30, maxDays: 60 },
    ...overrides,
  };
}

describe('assembleAdminDashboard', () => {
  it('counts platform tiles: open, approved this quarter, delayed', () => {
    const payload = assembleAdminDashboard(3, [
      row({ id: 'a', status: 'in_progress' }),
      row({ id: 'b', status: 'submitted' }),
      row({ id: 'c', status: 'pending_review' }),
      // approved INSIDE current quarter (Jul 2)
      row({ id: 'd', status: 'approved', effectiveDate: new Date('2026-07-02') }),
      // approved BEFORE current quarter (Jun 30) — excluded from quarter count
      row({ id: 'e', status: 'approved', effectiveDate: new Date('2026-06-30') }),
      // delayed: day 97 vs max 90
      row({ id: 'f', status: 'submitted', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }),
      // not_started is not "open"
      row({ id: 'g', status: 'not_started' }),
    ], NOW);
    expect(payload.tiles).toEqual({
      activePractices: 3,
      openApplications: 4, // a, b, c, f
      approvedThisQuarter: 1,
      delayedPlatformWide: 1,
    });
  });

  it('ranks churn-risk practices by delayed, then overdue follow-ups, and omits healthy practices', () => {
    const payload = assembleAdminDashboard(3, [
      // prac1: 1 delayed
      row({ id: 'a', practiceId: 'prac1', practiceName: 'Greens Health', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }),
      // prac2: 2 overdue follow-ups, 0 delayed
      row({ id: 'b', practiceId: 'prac2', practiceName: 'Juna Health', nextFollowUpDate: daysAgo(3) }),
      row({ id: 'c', practiceId: 'prac2', practiceName: 'Juna Health', nextFollowUpDate: daysAgo(1) }),
      // prac3: healthy — in flight but inside window, no overdue follow-up
      row({ id: 'd', practiceId: 'prac3', practiceName: 'Lott PT' }),
    ], NOW);
    expect(payload.churnRisk.map((c) => c.practiceName)).toEqual(['Greens Health', 'Juna Health']);
    expect(payload.churnRisk[0]).toMatchObject({ practiceId: 'prac1', delayedCount: 1, overdueFollowUps: 0, openCount: 1 });
    expect(payload.churnRisk[1]).toMatchObject({ practiceId: 'prac2', delayedCount: 0, overdueFollowUps: 2, openCount: 2 });
  });

  it('does not count follow-ups on settled enrollments as overdue', () => {
    const payload = assembleAdminDashboard(1, [
      row({ id: 'a', status: 'approved', nextFollowUpDate: daysAgo(5), effectiveDate: new Date('2026-01-05') }),
      row({ id: 'b', status: 'denied', nextFollowUpDate: daysAgo(5) }),
      row({ id: 'c', status: 'terminated', nextFollowUpDate: daysAgo(5) }),
    ], NOW);
    expect(payload.churnRisk).toEqual([]);
  });

  it('enrollments with no practice attach to nothing and never crash the rollup', () => {
    const payload = assembleAdminDashboard(1, [
      row({ id: 'a', practiceId: null, practiceName: null, applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }),
    ], NOW);
    expect(payload.tiles.delayedPlatformWide).toBe(1); // still counted platform-wide
    expect(payload.churnRisk).toEqual([]);             // but no practice row
  });

  it('sorts churn-risk by all four levels: delayed desc → overdue desc → open desc → name asc', () => {
    const payload = assembleAdminDashboard(5, [
      // pracA: 1 delayed, 0 overdue
      row({ id: 'a1', practiceId: 'pracA', practiceName: 'Alpha Health', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }),
      // pracB: 1 delayed, 1 overdue (sorts before A on overdue count)
      row({ id: 'b1', practiceId: 'pracB', practiceName: 'Beta Health', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }),
      row({ id: 'b2', practiceId: 'pracB', practiceName: 'Beta Health', nextFollowUpDate: daysAgo(2) }),
      // pracC: 0 delayed, 1 overdue, 2 open (1 overdue + 1 other)
      row({ id: 'c1', practiceId: 'pracC', practiceName: 'Gamma Health', nextFollowUpDate: daysAgo(2) }),
      row({ id: 'c2', practiceId: 'pracC', practiceName: 'Gamma Health', applicationDate: daysAgo(21), timeline: { minDays: 30, maxDays: 60 } }),
      // pracD: 0 delayed, 1 overdue, 1 open (just the overdue)
      row({ id: 'd1', practiceId: 'pracD', practiceName: 'Delta Health', nextFollowUpDate: daysAgo(2) }),
      // pracE: 0 delayed, 1 overdue, 1 open (same as D, sorts after D alphabetically)
      row({ id: 'e1', practiceId: 'pracE', practiceName: 'Echo Health', nextFollowUpDate: daysAgo(2) }),
    ], NOW);
    expect(payload.churnRisk.map(c => c.practiceName)).toEqual([
      'Beta Health',   // 1 delayed, 1 overdue
      'Alpha Health',  // 1 delayed, 0 overdue
      'Gamma Health',  // 0 delayed, 1 overdue, 2 open
      'Delta Health',  // 0 delayed, 1 overdue, 1 open
      'Echo Health',   // 0 delayed, 1 overdue, 1 open (Echo > Delta alphabetically)
    ]);
  });
});

describe('getAdminDashboard', () => {
  it('derives practiceId from the provider when the enrollment itself has none', async () => {
    prismaMock.practice.count.mockResolvedValueOnce(2);
    prismaMock.enrollment.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        status: 'submitted',
        applicationDate: daysAgo(97),
        effectiveDate: null,
        nextFollowUpDate: null,
        practiceId: null,
        practice: null,
        provider: { practiceId: 'prac9', practice: { id: 'prac9', name: 'Via Provider LLC' } },
        payerTrack: { timelines: [{ minDays: 45, maxDays: 90 }] },
      },
    ] as any);

    const payload = await getAdminDashboard();
    expect(payload.churnRisk[0]).toMatchObject({ practiceId: 'prac9', practiceName: 'Via Provider LLC', delayedCount: 1 });
  });
});
