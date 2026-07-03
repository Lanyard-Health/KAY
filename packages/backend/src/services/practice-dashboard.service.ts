import { prisma } from '../utils/prisma.js';
import type { EnrollmentStatus } from '@prisma/client';

const MS_PER_DAY = 86_400_000;
const IN_FLIGHT: EnrollmentStatus[] = ['submitted', 'pending_review'];
const ATTENTION_ORDER = { delayed: 0, denied: 1 } as const;

export interface EtaInfo {
  dayCount: number | null;
  minDays: number | null;
  maxDays: number | null;
  isDelayed: boolean;
}

// The minimal enrollment row the assembly needs — Task 2's fetch selects exactly this.
export interface EnrollmentRow {
  id: string;
  status: EnrollmentStatus;
  applicationDate: Date | null;
  effectiveDate: Date | null;
  lastFollowUpDate: Date | null;
  nextFollowUpDate: Date | null;
  updatedAt: Date;
  payer: { id: string; name: string };
  provider: { id: string; firstName: string; lastName: string; providerType: string; degree: string | null };
  timeline: { minDays: number | null; maxDays: number | null } | null;
}

export interface GridCell {
  enrollmentId: string;
  status: EnrollmentStatus;
  isDelayed: boolean;
  dayCount: number | null;
  minDays: number | null;
  maxDays: number | null;
  updatedDaysAgo: number;
}

export interface InFlightItem {
  enrollmentId: string;
  providerName: string;
  payerName: string;
  status: EnrollmentStatus;
  dayCount: number;
  minDays: number | null;
  maxDays: number | null;
  isDelayed: boolean;
}

export interface AttentionItem {
  enrollmentId: string;
  providerName: string;
  payerName: string;
  kind: 'delayed' | 'denied';
  lastFollowUpDate: string | null;
  nextFollowUpDate: string | null;
}

export interface PracticeDashboardPayload {
  tiles: { inProgress: number; submitted: number; approved: number; approvedThisMonth: number; runningLong: number };
  charts: {
    approvedByPayer: Array<{ payerName: string; count: number }>;
    approvalsByMonth: Array<{ month: string; count: number }>;
  };
  grid: {
    payers: Array<{ id: string; name: string }>;
    rows: Array<{
      providerId: string;
      providerName: string;
      credential: string | null;
      approvedCount: number;
      totalCount: number;
      cells: Array<GridCell | null>;
    }>;
  };
  inFlight: InFlightItem[];
  attention: AttentionItem[];
}

export function computeEta(
  applicationDate: Date | null,
  minDays: number | null,
  maxDays: number | null,
  now: Date,
): EtaInfo {
  const dayCount = applicationDate
    ? Math.max(0, Math.floor((now.getTime() - applicationDate.getTime()) / MS_PER_DAY))
    : null;
  const isDelayed = dayCount !== null && maxDays !== null && dayCount > maxDays;
  return { dayCount, minDays, maxDays, isDelayed };
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function assemblePracticeDashboard(rows: EnrollmentRow[], now: Date): PracticeDashboardPayload {
  const etaFor = (r: EnrollmentRow): EtaInfo =>
    computeEta(
      IN_FLIGHT.includes(r.status) ? r.applicationDate : null,
      r.timeline?.minDays ?? null,
      r.timeline?.maxDays ?? null,
      now,
    );

  // Tiles
  const nowMonth = monthKey(now);
  let inProgress = 0, submitted = 0, approved = 0, approvedThisMonth = 0, runningLong = 0;
  for (const r of rows) {
    if (r.status === 'in_progress') inProgress++;
    if (r.status === 'submitted' || r.status === 'pending_review') submitted++;
    if (r.status === 'approved') {
      approved++;
      if (r.effectiveDate && monthKey(r.effectiveDate) === nowMonth) approvedThisMonth++;
    }
    if (etaFor(r).isDelayed) runningLong++;
  }

  // Grid: payer columns = distinct payers among this practice's enrollments, alphabetical
  const payerMap = new Map<string, string>();
  for (const r of rows) payerMap.set(r.payer.id, r.payer.name);
  const payers = [...payerMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const payerIndex = new Map(payers.map((p, i) => [p.id, i]));

  const providerMap = new Map<string, { row: PracticeDashboardPayload['grid']['rows'][number] }>();
  for (const r of rows) {
    const name = `${r.provider.firstName} ${r.provider.lastName}`;
    let entry = providerMap.get(r.provider.id);
    if (!entry) {
      entry = {
        row: {
          providerId: r.provider.id,
          providerName: name,
          credential: r.provider.degree ?? r.provider.providerType ?? null,
          approvedCount: 0,
          totalCount: 0,
          cells: payers.map(() => null),
        },
      };
      providerMap.set(r.provider.id, entry);
    }
    const eta = etaFor(r);
    entry.row.cells[payerIndex.get(r.payer.id)!] = {
      enrollmentId: r.id,
      status: r.status,
      isDelayed: eta.isDelayed,
      dayCount: eta.dayCount,
      minDays: eta.minDays,
      maxDays: eta.maxDays,
      updatedDaysAgo: Math.max(0, Math.floor((now.getTime() - r.updatedAt.getTime()) / MS_PER_DAY)),
    };
    entry.row.totalCount++;
    if (r.status === 'approved') entry.row.approvedCount++;
  }
  const gridRows = [...providerMap.values()]
    .map((e) => e.row)
    .sort((a, b) => a.providerName.localeCompare(b.providerName));

  // In flight
  const inFlight: InFlightItem[] = rows
    .filter((r) => IN_FLIGHT.includes(r.status) && r.applicationDate)
    .map((r) => {
      const eta = etaFor(r);
      return {
        enrollmentId: r.id,
        providerName: `${r.provider.firstName} ${r.provider.lastName}`,
        payerName: r.payer.name,
        status: r.status,
        dayCount: eta.dayCount as number,
        minDays: eta.minDays,
        maxDays: eta.maxDays,
        isDelayed: eta.isDelayed,
      };
    })
    .sort((a, b) => Number(b.isDelayed) - Number(a.isDelayed) || b.dayCount - a.dayCount);

  // Attention: delayed + denied only on this surface (decision log #15/#18)
  const attention: AttentionItem[] = rows
    .filter((r) => r.status === 'denied' || etaFor(r).isDelayed)
    .map((r) => ({
      enrollmentId: r.id,
      providerName: `${r.provider.firstName} ${r.provider.lastName}`,
      payerName: r.payer.name,
      kind: r.status === 'denied' ? 'denied' as const : 'delayed' as const,
      lastFollowUpDate: r.lastFollowUpDate?.toISOString() ?? null,
      nextFollowUpDate: r.nextFollowUpDate?.toISOString() ?? null,
    }))
    .sort((a, b) => ATTENTION_ORDER[a.kind] - ATTENTION_ORDER[b.kind]);

  // Charts
  const byPayer = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'approved') continue;
    byPayer.set(r.payer.name, (byPayer.get(r.payer.name) ?? 0) + 1);
  }
  const rankedPayers = [...byPayer.entries()].sort((a, b) => b[1] - a[1]);
  const approvedByPayer = rankedPayers.slice(0, 4).map(([payerName, count]) => ({ payerName, count }));
  const otherCount = rankedPayers.slice(4).reduce((s, [, c]) => s + c, 0);
  if (otherCount > 0) approvedByPayer.push({ payerName: 'Other', count: otherCount });

  const approvalsByMonth: Array<{ month: string; count: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    approvalsByMonth.push({ month: monthKey(d), count: 0 });
  }
  const monthIdx = new Map(approvalsByMonth.map((m, i) => [m.month, i]));
  for (const r of rows) {
    if (r.status !== 'approved' || !r.effectiveDate) continue;
    const idx = monthIdx.get(monthKey(r.effectiveDate));
    const bucket = idx !== undefined ? approvalsByMonth[idx] : undefined;
    if (bucket) bucket.count++;
  }

  return {
    tiles: { inProgress, submitted, approved, approvedThisMonth, runningLong },
    charts: { approvedByPayer, approvalsByMonth },
    grid: { payers, rows: gridRows },
    inFlight,
    attention,
  };
}

// Prisma fetch wrapper — used by the route (Task 2). practiceFilter comes from
// getPracticeProviderFilter(req) and scopes providers to the caller's practice(s).
export async function getPracticeDashboard(
  practiceFilter: Record<string, unknown>,
): Promise<PracticeDashboardPayload> {
  const enrollments = await prisma.enrollment.findMany({
    // Drafts stay IN: they're the auto-created target-payer placeholders and
    // render as honest "Not started" dots (EXPERIENCE.md providers-but-zero-
    // enrollments state). Their default status is not_started, so they don't
    // inflate the In progress / Submitted / Approved tiles.
    where: { providerId: { not: null }, provider: practiceFilter },
    select: {
      id: true,
      status: true,
      applicationDate: true,
      effectiveDate: true,
      lastFollowUpDate: true,
      nextFollowUpDate: true,
      updatedAt: true,
      payer: { select: { id: true, name: true } },
      provider: { select: { id: true, firstName: true, lastName: true, providerType: true, degree: true } },
      payerTrack: {
        select: {
          timelines: { where: { processType: 'Initial' }, select: { minDays: true, maxDays: true }, take: 1 },
        },
      },
    },
  });

  // Provider-optional enrollments (migration 20260628000000) can have a null
  // provider relation, but this dashboard is provider-centric — exclude them
  // here. The where-clause above should already filter providerId, but this
  // guard is belt-and-braces (and proves the narrowed type to the checker)
  // in case Prisma's relation shorthand doesn't exclude nulls as expected.
  const withProvider = enrollments.filter(
    (e): e is typeof e & { provider: NonNullable<typeof e['provider']> } => e.provider !== null,
  );

  const rows: EnrollmentRow[] = withProvider.map((e) => ({
    id: e.id,
    status: e.status,
    applicationDate: e.applicationDate,
    effectiveDate: e.effectiveDate,
    lastFollowUpDate: e.lastFollowUpDate,
    nextFollowUpDate: e.nextFollowUpDate,
    updatedAt: e.updatedAt,
    payer: e.payer,
    provider: { ...e.provider, providerType: String(e.provider.providerType), degree: e.provider.degree ? String(e.provider.degree) : null },
    timeline: e.payerTrack?.timelines[0] ?? null,
  }));

  return assemblePracticeDashboard(rows, new Date());
}
