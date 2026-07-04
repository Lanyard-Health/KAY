import { prisma } from '../utils/prisma.js';
import type { EnrollmentStatus } from '@prisma/client';
import { computeEta } from './practice-dashboard.service.js';

const MS_PER_DAY = 86_400_000;
const IN_FLIGHT: EnrollmentStatus[] = ['submitted', 'pending_review'];
const SETTLED: EnrollmentStatus[] = ['approved', 'denied', 'terminated'];
// Queue shows workable items: drafts (not_started) stay out, denied stays in
// ("Prep resubmission"). not_started still counts in the In intake tile.
const QUEUE_STATUSES: EnrollmentStatus[] = ['in_progress', 'submitted', 'pending_review', 'denied'];
const FOLLOW_UP_INACTIVITY_DAYS = 30;

// The minimal enrollment row the assembly needs — getStaffDashboard's fetch maps to exactly this.
export interface StaffEnrollmentRow {
  id: string;
  status: EnrollmentStatus;
  applicationDate: Date | null;
  nextFollowUpDate: Date | null;
  updatedAt: Date;
  payerName: string;
  providerName: string | null; // null for practice-wide (group) enrollments
  practiceName: string | null;
  timeline: { minDays: number | null; maxDays: number | null } | null;
}

export interface StaffQueueItem {
  enrollmentId: string;
  providerName: string; // 'Practice-wide' for group enrollments
  payerName: string;
  practiceName: string | null;
  status: EnrollmentStatus;
  daysInStatus: number;
  isDelayed: boolean;
  needsFollowUp: boolean;
  nextAction: string;
  dueDate: string | null; // ISO — the scheduled follow-up date
}

export type PipelineStage = 'intake' | 'in_progress' | 'submitted' | 'pending_review' | 'delayed';

export interface StaffDashboardPayload {
  tiles: {
    submittedThisWeek: number;
    needsFollowUp: number;
    delayed: number;
    inIntake: number;
  };
  queue: StaffQueueItem[];
  charts: {
    pipelineByStage: Array<{ stage: PipelineStage; count: number }>;
    submissionsByWeek: Array<{ weekStart: string; count: number }>;
  };
}

interface RowFlags {
  isDelayed: boolean;
  needsFollowUp: boolean;
  isOverdue: boolean;
  dueDate: Date | null;
}

// Verb phrases only — never a status restatement (EXPERIENCE.md work-queue rule).
// First match wins.
export function nextActionFor(row: StaffEnrollmentRow, flags: RowFlags): string {
  if (row.status === 'denied') return 'Prep resubmission';
  if (flags.isDelayed) return 'Call payer rep — escalate';
  if (flags.isOverdue) return 'Send follow-up to payer';
  if (flags.needsFollowUp) return 'Check status with payer';
  if (IN_FLIGHT.includes(row.status) && flags.dueDate) return 'Scheduled status check';
  if (row.status === 'in_progress') return 'Finish application prep';
  return 'Monitor';
}

function mondayUtc(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
}

export function assembleStaffDashboard(rows: StaffEnrollmentRow[], now: Date): StaffDashboardPayload {
  const weekAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
  const inactivityCutoff = new Date(now.getTime() - FOLLOW_UP_INACTIVITY_DAYS * MS_PER_DAY);

  const flagsFor = (r: StaffEnrollmentRow): RowFlags => {
    const isDelayed = computeEta(
      IN_FLIGHT.includes(r.status) ? r.applicationDate : null,
      r.timeline?.minDays ?? null,
      r.timeline?.maxDays ?? null,
      now,
    ).isDelayed;
    return {
      isDelayed,
      // "Needs follow-up" = no status activity in 30 days (EXPERIENCE.md flag
      // definition; updatedAt is the only status-activity proxy available).
      needsFollowUp: !SETTLED.includes(r.status) && r.updatedAt < inactivityCutoff,
      isOverdue: !SETTLED.includes(r.status) && r.nextFollowUpDate !== null && r.nextFollowUpDate < now,
      dueDate: r.nextFollowUpDate,
    };
  };

  // Tiles
  let submittedThisWeek = 0, needsFollowUp = 0, delayed = 0, inIntake = 0;
  for (const r of rows) {
    const f = flagsFor(r);
    // applicationDate is the submission-date proxy — there is no submittedAt
    // column; computeEta makes the same assumption. Counts anything that left
    // prep in the last 7 days even if it already moved past 'submitted'.
    if (r.applicationDate && r.applicationDate >= weekAgo && !['not_started', 'in_progress'].includes(r.status)) {
      submittedThisWeek++;
    }
    if (f.needsFollowUp) needsFollowUp++;
    if (f.isDelayed) delayed++;
    if (r.status === 'not_started') inIntake++; // "In intake" = not yet worked (Kay 2026-07-04)
  }

  // Queue
  const queue: StaffQueueItem[] = rows
    .filter((r) => QUEUE_STATUSES.includes(r.status))
    .map((r) => {
      const f = flagsFor(r);
      // In-flight: days since submission (matches EtaBar's day count);
      // otherwise days since last update — no status-transition timestamp exists.
      const clock = IN_FLIGHT.includes(r.status) && r.applicationDate ? r.applicationDate : r.updatedAt;
      return {
        enrollmentId: r.id,
        providerName: r.providerName ?? 'Practice-wide',
        payerName: r.payerName,
        practiceName: r.practiceName,
        status: r.status,
        daysInStatus: Math.max(0, Math.floor((now.getTime() - clock.getTime()) / MS_PER_DAY)),
        isDelayed: f.isDelayed,
        needsFollowUp: f.needsFollowUp,
        nextAction: nextActionFor(r, f),
        dueDate: f.dueDate?.toISOString() ?? null,
      };
    });

  // Urgency sort (EXPERIENCE.md): delayed first, then overdue follow-ups, then by due date.
  const tierOf = (q: StaffQueueItem): number =>
    q.isDelayed ? 0 : q.dueDate && new Date(q.dueDate) < now ? 1 : 2;
  queue.sort((a, b) =>
    tierOf(a) - tierOf(b) ||
    (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity) ||
    b.daysInStatus - a.daysInStatus ||
    a.providerName.localeCompare(b.providerName));

  // Pipeline: delayed broken out into its own bucket so each open application
  // appears exactly once and the bars sum to the open total.
  const pipeline: Record<PipelineStage, number> = {
    intake: 0, in_progress: 0, submitted: 0, pending_review: 0, delayed: 0,
  };
  for (const r of rows) {
    if (SETTLED.includes(r.status)) continue;
    if (flagsFor(r).isDelayed) pipeline.delayed++;
    else if (r.status === 'not_started') pipeline.intake++;
    else pipeline[r.status as 'in_progress' | 'submitted' | 'pending_review']++;
  }
  const pipelineByStage = (Object.keys(pipeline) as PipelineStage[])
    .map((stage) => ({ stage, count: pipeline[stage] }));

  // Submissions by week — last 8 weeks, Monday UTC, bucketed by applicationDate.
  const submissionsByWeek: Array<{ weekStart: string; count: number }> = [];
  const thisMonday = mondayUtc(now);
  for (let i = 7; i >= 0; i--) {
    submissionsByWeek.push({
      weekStart: new Date(thisMonday.getTime() - i * 7 * MS_PER_DAY).toISOString().slice(0, 10),
      count: 0,
    });
  }
  const weekIdx = new Map(submissionsByWeek.map((w, i) => [w.weekStart, i]));
  for (const r of rows) {
    if (!r.applicationDate || ['not_started', 'in_progress'].includes(r.status)) continue;
    const idx = weekIdx.get(mondayUtc(r.applicationDate).toISOString().slice(0, 10));
    const bucket = idx !== undefined ? submissionsByWeek[idx] : undefined;
    if (bucket) bucket.count++;
  }

  return {
    tiles: { submittedThisWeek, needsFollowUp, delayed, inIntake },
    queue,
    charts: { pipelineByStage, submissionsByWeek },
  };
}

// Prisma fetch wrapper — where-shape identical to getPracticeDashboard so
// scoping is automatic: admin → all, lanyard_staff → all practice ids,
// credentialing_staff → own practice(s). Provider-less (group) enrollments are
// scoped directly by practiceId.
export async function getStaffDashboard(
  practiceFilter: Record<string, unknown>,
  scope: { practiceIds: string[]; isSuperAdmin: boolean },
): Promise<StaffDashboardPayload> {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      OR: [
        { providerId: { not: null }, provider: practiceFilter },
        { providerId: null, ...(scope.isSuperAdmin ? {} : { practiceId: { in: scope.practiceIds } }) },
      ],
    },
    select: {
      id: true,
      status: true,
      applicationDate: true,
      nextFollowUpDate: true,
      updatedAt: true,
      payer: { select: { name: true } },
      practice: { select: { name: true } },
      provider: { select: { firstName: true, lastName: true, practice: { select: { name: true } } } },
      payerTrack: {
        select: {
          timelines: { where: { processType: 'Initial' }, select: { minDays: true, maxDays: true }, take: 1 },
        },
      },
    },
  });

  const rows: StaffEnrollmentRow[] = enrollments.map((e) => ({
    id: e.id,
    status: e.status,
    applicationDate: e.applicationDate,
    nextFollowUpDate: e.nextFollowUpDate,
    updatedAt: e.updatedAt,
    payerName: e.payer.name,
    providerName: e.provider ? `${e.provider.firstName} ${e.provider.lastName}` : null,
    practiceName: e.practice?.name ?? e.provider?.practice?.name ?? null,
    timeline: e.payerTrack?.timelines[0] ?? null,
  }));

  return assembleStaffDashboard(rows, new Date());
}
