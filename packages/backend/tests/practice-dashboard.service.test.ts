import { describe, it, expect } from 'vitest';
import {
  computeEta,
  assemblePracticeDashboard,
  type EnrollmentRow,
} from '../src/services/practice-dashboard.service.js';

const NOW = new Date('2026-07-03T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function row(overrides: Partial<EnrollmentRow>): EnrollmentRow {
  return {
    id: 'e1',
    status: 'submitted',
    applicationDate: daysAgo(21),
    effectiveDate: null,
    lastFollowUpDate: null,
    nextFollowUpDate: null,
    updatedAt: daysAgo(2),
    payer: { id: 'p1', name: 'Optum' },
    provider: { id: 'pr1', firstName: 'Amara', lastName: 'Osei', providerType: 'physician', degree: 'MD' },
    timeline: { minDays: 30, maxDays: 60 },
    ...overrides,
  };
}

describe('computeEta', () => {
  it('computes day count and window, not delayed inside window', () => {
    expect(computeEta(daysAgo(21), 30, 60, NOW)).toEqual({
      dayCount: 21, minDays: 30, maxDays: 60, isDelayed: false,
    });
  });
  it('flags delayed past the window max', () => {
    expect(computeEta(daysAgo(97), 45, 90, NOW).isDelayed).toBe(true);
  });
  it('never delayed without a max (no typical timeline on file)', () => {
    expect(computeEta(daysAgo(200), null, null, NOW)).toEqual({
      dayCount: 200, minDays: null, maxDays: null, isDelayed: false,
    });
  });
  it('null day count without an application date', () => {
    expect(computeEta(null, 30, 60, NOW).dayCount).toBeNull();
    expect(computeEta(null, 30, 60, NOW).isDelayed).toBe(false);
  });
});

describe('assemblePracticeDashboard', () => {
  it('counts tiles: pending_review folds into submitted; delayed counted', () => {
    const payload = assemblePracticeDashboard([
      row({ id: 'a', status: 'in_progress' }),
      row({ id: 'b', status: 'submitted' }),
      row({ id: 'c', status: 'pending_review' }),
      row({ id: 'd', status: 'approved', effectiveDate: new Date('2026-07-01') }),
      row({ id: 'e', status: 'submitted', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 } }),
    ], NOW);
    expect(payload.tiles).toEqual({
      inProgress: 1, submitted: 3, approved: 1, approvedThisMonth: 1, runningLong: 1,
    });
  });

  it('builds the grid: rows per provider, cells aligned to the payer column list, row summary counts', () => {
    const payload = assemblePracticeDashboard([
      row({ id: 'a', payer: { id: 'p1', name: 'Aetna' }, status: 'approved' }),
      row({ id: 'b', payer: { id: 'p2', name: 'Cigna' }, status: 'submitted' }),
      row({
        id: 'c',
        provider: { id: 'pr2', firstName: 'Devon', lastName: 'Marsh', providerType: 'counselor', degree: null },
        payer: { id: 'p1', name: 'Aetna' },
        status: 'denied',
      }),
    ], NOW);
    expect(payload.grid.payers.map((p) => p.name)).toEqual(['Aetna', 'Cigna']);
    const osei = payload.grid.rows.find((r) => r.providerName === 'Amara Osei')!;
    expect(osei.approvedCount).toBe(1);
    expect(osei.totalCount).toBe(2);
    expect(osei.cells[0]?.status).toBe('approved');
    expect(osei.cells[1]?.status).toBe('submitted');
    const marsh = payload.grid.rows.find((r) => r.providerName === 'Devon Marsh')!;
    expect(marsh.cells[0]?.status).toBe('denied');
    expect(marsh.cells[1]).toBeNull(); // no Cigna enrollment for Marsh
  });

  it('in-flight list has only submitted/pending_review with an application date', () => {
    const payload = assemblePracticeDashboard([
      row({ id: 'a', status: 'submitted' }),
      row({ id: 'b', status: 'pending_review' }),
      row({ id: 'c', status: 'submitted', applicationDate: null }),
      row({ id: 'd', status: 'approved' }),
    ], NOW);
    expect(payload.inFlight.map((i) => i.enrollmentId).sort()).toEqual(['a', 'b']);
  });

  it('attention: delayed and denied items only (needs-follow-up is not a practice-surface flag)', () => {
    const payload = assemblePracticeDashboard([
      row({ id: 'late', status: 'submitted', applicationDate: daysAgo(97), timeline: { minDays: 45, maxDays: 90 }, lastFollowUpDate: daysAgo(5), nextFollowUpDate: daysAgo(-5) }),
      row({ id: 'no', status: 'denied' }),
      row({ id: 'fine', status: 'submitted' }),
      row({ id: 'stale', status: 'in_progress', updatedAt: daysAgo(45) }),
    ], NOW);
    expect(payload.attention.map((a) => `${a.enrollmentId}:${a.kind}`).sort())
      .toEqual(['late:delayed', 'no:denied']);
    const late = payload.attention.find((a) => a.kind === 'delayed')!;
    expect(late.lastFollowUpDate).not.toBeNull();
    expect(late.nextFollowUpDate).not.toBeNull();
  });

  it('charts: approved-by-payer top-4 + Other; approvals bucketed by effectiveDate month, last 7 months, missing dates excluded', () => {
    const approvedFor = (payerName: string, i: number, eff: Date | null) =>
      row({ id: `ap${payerName}${i}`, status: 'approved', effectiveDate: eff, payer: { id: `pp${payerName}`, name: payerName } });
    const payload = assemblePracticeDashboard([
      approvedFor('Medicare', 1, new Date('2026-06-15')),
      approvedFor('Medicare', 2, new Date('2026-06-20')),
      approvedFor('Aetna', 1, new Date('2026-07-01')),
      approvedFor('Cigna', 1, new Date('2026-05-10')),
      approvedFor('UHC', 1, new Date('2026-04-10')),
      approvedFor('Humana', 1, new Date('2026-03-10')),
      approvedFor('NoDate', 1, null),
    ], NOW);
    // Medicare(2) then four 1-count payers; top 4 by count + Other bucket
    expect(payload.charts.approvedByPayer[0]).toEqual({ payerName: 'Medicare', count: 2 });
    expect(payload.charts.approvedByPayer.reduce((s, e) => s + e.count, 0)).toBe(7); // NoDate still counts toward payer totals
    expect(payload.charts.approvalsByMonth).toHaveLength(7);
    expect(payload.charts.approvalsByMonth.at(-1)).toEqual({ month: '2026-07', count: 1 });
    expect(payload.charts.approvalsByMonth.at(-2)).toEqual({ month: '2026-06', count: 2 });
  });
});
