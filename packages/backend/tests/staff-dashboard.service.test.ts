import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

import { prismaMock } from './helpers/mock-prisma.js';
import {
  assembleStaffDashboard,
  getStaffDashboard,
  nextActionFor,
  type StaffEnrollmentRow,
} from '../src/services/staff-dashboard.service.js';

const NOW = new Date('2026-07-03T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function row(overrides: Partial<StaffEnrollmentRow>): StaffEnrollmentRow {
  return {
    id: 'e1',
    status: 'submitted',
    applicationDate: daysAgo(21),
    nextFollowUpDate: null,
    updatedAt: daysAgo(2),
    payerName: 'Aetna',
    providerName: 'Dana Reyes',
    practiceName: 'Greens Health',
    timeline: { minDays: 30, maxDays: 60 },
    ...overrides,
  };
}

describe('assembleStaffDashboard — tiles', () => {
  it('counts submitted this week by applicationDate, including apps already past submitted', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'a', applicationDate: daysAgo(3) }),                             // in window
      row({ id: 'b', status: 'pending_review', applicationDate: daysAgo(5) }),   // moved on, still counts
      row({ id: 'c', applicationDate: daysAgo(8) }),                             // outside 7d
      row({ id: 'd', status: 'in_progress', applicationDate: daysAgo(1) }),      // pre-submission, excluded
      row({ id: 'e', status: 'not_started', applicationDate: daysAgo(1) }),      // draft, excluded
      row({ id: 'f', applicationDate: null }),                                   // no date, excluded
    ], NOW);
    expect(payload.tiles.submittedThisWeek).toBe(2);
  });

  it('flags needs follow-up at 30 days of inactivity, excluding settled', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'a', updatedAt: daysAgo(31) }),                        // flagged
      row({ id: 'b', updatedAt: daysAgo(29) }),                        // inside 30d
      row({ id: 'c', status: 'approved', updatedAt: daysAgo(90) }),    // settled
      row({ id: 'd', status: 'terminated', updatedAt: daysAgo(90) }),  // settled
      row({ id: 'e', status: 'in_progress', updatedAt: daysAgo(45) }), // flagged (open, stale)
    ], NOW);
    expect(payload.tiles.needsFollowUp).toBe(2);
  });

  it('counts delayed via payer window; no timeline means never delayed', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'a', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }), // delayed
      row({ id: 'b', applicationDate: daysAgo(97), timeline: null }),                          // no window
      row({ id: 'c', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: null } }),// no max
      row({ id: 'd', status: 'in_progress', applicationDate: daysAgo(97) }),                   // not in flight
    ], NOW);
    expect(payload.tiles.delayed).toBe(1);
  });

  it('counts in intake as not_started only', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'a', status: 'not_started' }),
      row({ id: 'b', status: 'not_started' }),
      row({ id: 'c', status: 'in_progress' }),
    ], NOW);
    expect(payload.tiles.inIntake).toBe(2);
  });

  it('returns zero tiles and empty queue for no rows', () => {
    const payload = assembleStaffDashboard([], NOW);
    expect(payload.tiles).toEqual({ submittedThisWeek: 0, needsFollowUp: 0, delayed: 0, inIntake: 0 });
    expect(payload.queue).toEqual([]);
    expect(payload.charts.pipelineByStage.every((s) => s.count === 0)).toBe(true);
  });
});

describe('assembleStaffDashboard — queue', () => {
  it('excludes not_started from the queue but keeps it in the intake tile', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'a', status: 'not_started' }),
      row({ id: 'b', status: 'in_progress' }),
    ], NOW);
    expect(payload.tiles.inIntake).toBe(1);
    expect(payload.queue.map((q) => q.enrollmentId)).toEqual(['b']);
  });

  it('sorts delayed → overdue follow-up → rest, then due date asc with nulls last', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'rest-no-due', updatedAt: daysAgo(1) }),
      row({ id: 'overdue-old', nextFollowUpDate: daysAgo(5) }),
      row({ id: 'delayed', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }),
      row({ id: 'overdue-new', nextFollowUpDate: daysAgo(1) }),
      row({ id: 'rest-future-due', nextFollowUpDate: daysAgo(-3) }),
    ], NOW);
    expect(payload.queue.map((q) => q.enrollmentId)).toEqual([
      'delayed', 'overdue-old', 'overdue-new', 'rest-future-due', 'rest-no-due',
    ]);
  });

  it('breaks ties in the same tier by days in status, then provider name', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'younger', providerName: 'Ann Ash', applicationDate: daysAgo(10) }),
      row({ id: 'older', providerName: 'Zoe Zed', applicationDate: daysAgo(40), timeline: { minDays: 30, maxDays: 60 } }),
      row({ id: 'same-age-a', providerName: 'Ann Ash', status: 'in_progress', updatedAt: daysAgo(10) }),
    ], NOW);
    // all tier 2 (none delayed, none overdue): older (40d) → younger/same-age-a (10d, Ann×2 stable)
    expect(payload.queue[0].enrollmentId).toBe('older');
  });

  it('labels provider-less rows Practice-wide and keeps null practice names', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'a', status: 'in_progress', providerName: null, practiceName: null }),
    ], NOW);
    expect(payload.queue[0]).toMatchObject({ providerName: 'Practice-wide', practiceName: null });
  });

  it('measures days in status from applicationDate when in flight, else updatedAt', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'flight', applicationDate: daysAgo(21), updatedAt: daysAgo(2) }),
      row({ id: 'prep', status: 'in_progress', applicationDate: daysAgo(21), updatedAt: daysAgo(4) }),
    ], NOW);
    const byId = Object.fromEntries(payload.queue.map((q) => [q.enrollmentId, q.daysInStatus]));
    expect(byId['flight']).toBe(21);
    expect(byId['prep']).toBe(4);
  });
});

describe('nextActionFor', () => {
  const flags = { isDelayed: false, needsFollowUp: false, isOverdue: false, dueDate: null as Date | null };
  it('covers every branch in priority order', () => {
    expect(nextActionFor(row({ status: 'denied' }), { ...flags, isDelayed: true })).toBe('Prep resubmission');
    expect(nextActionFor(row({}), { ...flags, isDelayed: true, isOverdue: true })).toBe('Call payer rep — escalate');
    expect(nextActionFor(row({}), { ...flags, isOverdue: true, needsFollowUp: true })).toBe('Send follow-up to payer');
    expect(nextActionFor(row({}), { ...flags, needsFollowUp: true })).toBe('Check status with payer');
    expect(nextActionFor(row({}), { ...flags, dueDate: daysAgo(-5) })).toBe('Scheduled status check');
    expect(nextActionFor(row({ status: 'in_progress' }), flags)).toBe('Finish application prep');
    expect(nextActionFor(row({}), flags)).toBe('Monitor');
  });
});

describe('assembleStaffDashboard — charts', () => {
  it('buckets the pipeline with delayed broken out so bars sum to open total', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'a', status: 'not_started' }),
      row({ id: 'b', status: 'in_progress' }),
      row({ id: 'c' }),                                                                        // submitted, in window
      row({ id: 'd', status: 'pending_review' }),
      row({ id: 'e', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }),   // delayed
      row({ id: 'f', status: 'approved' }),                                                    // settled, excluded
    ], NOW);
    expect(payload.charts.pipelineByStage).toEqual([
      { stage: 'intake', count: 1 },
      { stage: 'in_progress', count: 1 },
      { stage: 'submitted', count: 1 },
      { stage: 'pending_review', count: 1 },
      { stage: 'delayed', count: 1 },
    ]);
  });

  it('buckets submissions into 8 Monday-keyed weeks and drops pre-submission rows', () => {
    const payload = assembleStaffDashboard([
      row({ id: 'a', applicationDate: daysAgo(1) }),
      row({ id: 'b', status: 'approved', applicationDate: daysAgo(1) }),        // past submitted still counts
      row({ id: 'c', status: 'in_progress', applicationDate: daysAgo(1) }),     // pre-submission, dropped
      row({ id: 'd', applicationDate: daysAgo(70) }),                           // older than 8 weeks
    ], NOW);
    expect(payload.charts.submissionsByWeek).toHaveLength(8);
    const total = payload.charts.submissionsByWeek.reduce((s, w) => s + w.count, 0);
    expect(total).toBe(2);
    expect(payload.charts.submissionsByWeek[7]).toMatchObject({ weekStart: '2026-06-29', count: 2 }); // NOW is Fri Jul 3
    // Monday-keyed
    for (const w of payload.charts.submissionsByWeek) {
      expect(new Date(`${w.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });
});

describe('getStaffDashboard', () => {
  it('passes the scoped OR-shaped where and resolves practice via the provider', async () => {
    prismaMock.enrollment.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        status: 'submitted',
        applicationDate: daysAgo(97),
        nextFollowUpDate: null,
        updatedAt: daysAgo(2),
        payer: { name: 'Cigna' },
        practice: null,
        provider: { firstName: 'Dana', lastName: 'Reyes', practice: { name: 'Via Provider LLC' } },
        payerTrack: { timelines: [{ minDays: 45, maxDays: 90 }] },
      },
    ] as any);

    const filter = { practiceId: { in: ['prac1'] } };
    const payload = await getStaffDashboard(filter, { practiceIds: ['prac1'], isSuperAdmin: false });

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { providerId: { not: null }, provider: filter },
            { providerId: null, practiceId: { in: ['prac1'] } },
          ],
        },
      }),
    );
    expect(payload.queue[0]).toMatchObject({
      providerName: 'Dana Reyes',
      practiceName: 'Via Provider LLC',
      isDelayed: true,
      nextAction: 'Call payer rep — escalate',
    });
  });

  it('omits the practiceId scope for super admins', async () => {
    prismaMock.enrollment.findMany.mockResolvedValueOnce([] as any);
    await getStaffDashboard({}, { practiceIds: [], isSuperAdmin: true });
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ providerId: { not: null }, provider: {} }, { providerId: null }] },
      }),
    );
  });
});
