import { prisma } from '../utils/prisma.js';
import type { EnrollmentStatus } from '@prisma/client';
import { computeEta } from './practice-dashboard.service.js';

const OPEN: EnrollmentStatus[] = ['in_progress', 'submitted', 'pending_review'];
const IN_FLIGHT: EnrollmentStatus[] = ['submitted', 'pending_review'];
const SETTLED: EnrollmentStatus[] = ['approved', 'denied', 'terminated'];

// The minimal enrollment row the assembly needs — getAdminDashboard's fetch maps to exactly this.
export interface AdminEnrollmentRow {
  id: string;
  status: EnrollmentStatus;
  applicationDate: Date | null;
  effectiveDate: Date | null;
  nextFollowUpDate: Date | null;
  practiceId: string | null;
  practiceName: string | null;
  timeline: { minDays: number | null; maxDays: number | null } | null;
}

export interface ChurnRiskRow {
  practiceId: string;
  practiceName: string;
  delayedCount: number;
  overdueFollowUps: number;
  openCount: number;
}

export interface AdminDashboardPayload {
  tiles: {
    activePractices: number;
    openApplications: number;
    approvedThisQuarter: number;
    delayedPlatformWide: number;
  };
  churnRisk: ChurnRiskRow[];
}

function quarterStart(now: Date): Date {
  const q = Math.floor(now.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), q, 1));
}

export function assembleAdminDashboard(
  activePractices: number,
  rows: AdminEnrollmentRow[],
  now: Date,
): AdminDashboardPayload {
  const qStart = quarterStart(now);
  let openApplications = 0, approvedThisQuarter = 0, delayedPlatformWide = 0;
  const byPractice = new Map<string, ChurnRiskRow>();

  for (const r of rows) {
    const isDelayed = computeEta(
      IN_FLIGHT.includes(r.status) ? r.applicationDate : null,
      r.timeline?.minDays ?? null,
      r.timeline?.maxDays ?? null,
      now,
    ).isDelayed;
    const isOverdue = !SETTLED.includes(r.status) && r.nextFollowUpDate !== null && r.nextFollowUpDate < now;
    const isOpen = OPEN.includes(r.status);

    if (isOpen) openApplications++;
    if (r.status === 'approved' && r.effectiveDate && r.effectiveDate >= qStart) approvedThisQuarter++;
    if (isDelayed) delayedPlatformWide++;

    if (!r.practiceId || !r.practiceName) continue; // platform totals only
    let entry = byPractice.get(r.practiceId);
    if (!entry) {
      entry = { practiceId: r.practiceId, practiceName: r.practiceName, delayedCount: 0, overdueFollowUps: 0, openCount: 0 };
      byPractice.set(r.practiceId, entry);
    }
    if (isDelayed) entry.delayedCount++;
    if (isOverdue) entry.overdueFollowUps++;
    if (isOpen) entry.openCount++;
  }

  // "Needing attention" = at least one delayed item or overdue follow-up.
  // Ranking omits "days since last update sent" (notifications are phase 2 — no data source).
  const churnRisk = [...byPractice.values()]
    .filter((c) => c.delayedCount > 0 || c.overdueFollowUps > 0)
    .sort((a, b) =>
      b.delayedCount - a.delayedCount ||
      b.overdueFollowUps - a.overdueFollowUps ||
      b.openCount - a.openCount ||
      a.practiceName.localeCompare(b.practiceName));

  return {
    tiles: { activePractices, openApplications, approvedThisQuarter, delayedPlatformWide },
    churnRisk,
  };
}

// Platform-wide fetch — admin/lanyard_staff only (enforced by the route).
// An enrollment's practice is its own practiceId when set, else its provider's.
export async function getAdminDashboard(): Promise<AdminDashboardPayload> {
  const practiceSelect = { id: true, name: true, isDemo: true, deletedAt: true } as const;
  const [activePractices, enrollments] = await Promise.all([
    prisma.practice.count({ where: { status: 'ACTIVE', deletedAt: null, isDemo: false } }),
    prisma.enrollment.findMany({
      where: {
        isDraft: false,
        OR: [{ providerId: null }, { provider: { deletedAt: null } }],
      },
      select: {
        id: true,
        status: true,
        applicationDate: true,
        effectiveDate: true,
        nextFollowUpDate: true,
        practice: { select: practiceSelect },
        provider: { select: { practiceId: true, practice: { select: practiceSelect } } },
        payerTrack: {
          select: {
            timelines: { where: { processType: 'Initial' }, select: { minDays: true, maxDays: true }, take: 1 },
          },
        },
      },
    }),
  ]);

  const rows: AdminEnrollmentRow[] = [];
  for (const e of enrollments) {
    const practice = e.practice ?? e.provider?.practice ?? null;
    // Demo and soft-deleted practices don't count anywhere, not even platform totals.
    if (practice && (practice.isDemo || practice.deletedAt !== null)) continue;
    rows.push({
      id: e.id,
      status: e.status,
      applicationDate: e.applicationDate,
      effectiveDate: e.effectiveDate,
      nextFollowUpDate: e.nextFollowUpDate,
      practiceId: practice?.id ?? null,
      practiceName: practice?.name ?? null,
      timeline: e.payerTrack?.timelines[0] ?? null,
    });
  }

  return assembleAdminDashboard(activePractices, rows, new Date());
}
