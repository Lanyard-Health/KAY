import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { composeTaskTitle, type HumanTaskGroup } from '@credential-management/shared';

export const ASSIGNABLE_ROLES = ['admin', 'lanyard_staff'] as const;

export interface CreateStaffTaskInput {
  taskGroup: HumanTaskGroup;      // 8 human groups only — CHECK_IN rejected at the route
  note?: string;                  // maps to Task.description
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueDate?: Date; assignedToId?: string;
  payerId?: string; providerId?: string; practiceId?: string; enrollmentId?: string;
}
export interface ListStaffTasksOptions {
  view: 'my' | 'pool' | 'all' | 'needs_review'; userId: string;
  status?: 'open' | 'completed' | 'all'; priority?: string; practiceId?: string;
  taskGroup?: string;             // filter by group (all 9 values legal, incl. CHECK_IN)
  limit: number; offset: number;
}

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  provider: { select: { id: true, firstName: true, lastName: true } },
  practice: { select: { id: true, name: true } },
  enrollment: { select: { id: true, payer: { select: { name: true } } } },
  payer: { select: { id: true, name: true, phone: true, contactInfo: { select: { phone: true } } } },
} as const;

export async function assertAssignableUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive || !(ASSIGNABLE_ROLES as readonly string[]).includes(user.role)) {
    throw new Error('ASSIGNEE_NOT_ALLOWED');
  }
}

/**
 * v2 link rules (relaxes v1's assertSingleLink): payer link is independent of
 * everything; provider+practice may coexist iff the provider belongs to that
 * practice; enrollment stays exclusive of provider/practice.
 * Returns the names needed for server-side title composition.
 */
async function resolveLinks(input: Pick<CreateStaffTaskInput, 'payerId' | 'providerId' | 'practiceId' | 'enrollmentId'>) {
  if (input.enrollmentId && (input.providerId || input.practiceId)) throw new Error('ENROLLMENT_LINK_EXCLUSIVE');
  let payerName: string | undefined;
  let practiceName: string | undefined;
  if (input.payerId) {
    const payer = await prisma.payer.findUnique({ where: { id: input.payerId }, select: { name: true } });
    if (!payer) throw new Error('PAYER_NOT_FOUND');
    payerName = payer.name;
  }
  if (input.practiceId) {
    const practice = await prisma.practice.findUnique({ where: { id: input.practiceId }, select: { name: true } });
    if (!practice) throw new Error('PRACTICE_NOT_FOUND');
    practiceName = practice.name;
  }
  if (input.providerId) {
    const provider = await prisma.providerProfile.findUnique({ where: { id: input.providerId }, select: { practiceId: true } });
    if (!provider) throw new Error('PROVIDER_NOT_FOUND');
    if (input.practiceId && provider.practiceId !== input.practiceId) throw new Error('PROVIDER_PRACTICE_MISMATCH');
  }
  return { payerName, practiceName };
}

/**
 * v2 guided edit (staging feedback 2026-07-20): merge the PATCH's guided
 * fields over the existing row, re-validate links with the same rules as
 * create, and recompose the title when a group is present. `patch` must
 * contain only the keys actually present in the request body — absent keys
 * keep the existing value, explicit null clears a link.
 */
export async function resolveGuidedEdit(
  existing: { taskGroup: string | null; payerId: string | null; practiceId: string | null; providerId: string | null; enrollmentId: string | null },
  patch: { taskGroup?: HumanTaskGroup; payerId?: string | null; practiceId?: string | null; providerId?: string | null },
) {
  const final = {
    taskGroup: ('taskGroup' in patch ? patch.taskGroup : existing.taskGroup) as HumanTaskGroup | null,
    payerId: 'payerId' in patch ? patch.payerId ?? null : existing.payerId,
    practiceId: 'practiceId' in patch ? patch.practiceId ?? null : existing.practiceId,
    providerId: 'providerId' in patch ? patch.providerId ?? null : existing.providerId,
  };
  const { payerName, practiceName } = await resolveLinks({
    payerId: final.payerId ?? undefined,
    practiceId: final.practiceId ?? undefined,
    providerId: final.providerId ?? undefined,
    enrollmentId: existing.enrollmentId ?? undefined,
  });
  return {
    data: final,
    title: final.taskGroup ? composeTaskTitle(final.taskGroup, payerName, practiceName) : undefined,
  };
}

export function notifyAssignee(userId: string, taskId: string, title: string) {
  prisma.inAppNotification.create({
    data: {
      userId, type: 'system_announcement',
      title: 'New task assigned',
      message: `You have been assigned: ${title}`,
      actionUrl: `/tasks?taskId=${taskId}`,
      metadata: { taskId, kind: 'task_assigned' },
    },
  }).catch((err) => logger.error(`Failed to notify assignee for task ${taskId}:`, err));
}

export async function createStaffTask(input: CreateStaffTaskInput, creatorId: string) {
  const { payerName, practiceName } = await resolveLinks(input);
  if (input.assignedToId) await assertAssignableUser(input.assignedToId);
  const title = composeTaskTitle(input.taskGroup, payerName, practiceName); // server-side — preview === persisted
  const task = await prisma.task.create({
    data: {
      title,
      description: input.note,
      taskGroup: input.taskGroup,
      type: 'CUSTOM', priority: input.priority,
      status: input.assignedToId ? 'IN_PROGRESS' : 'PENDING', // v1 behavior untouched
      dueDate: input.dueDate, assignedToId: input.assignedToId,
      payerId: input.payerId, providerId: input.providerId,
      practiceId: input.practiceId, enrollmentId: input.enrollmentId,
      createdById: creatorId,
    },
    include: TASK_INCLUDE,
  });
  if (input.assignedToId && input.assignedToId !== creatorId) notifyAssignee(input.assignedToId, task.id, title);
  return task;
}

export async function claimTask(taskId: string, userId: string): Promise<boolean> {
  const result = await prisma.task.updateMany({
    where: { id: taskId, assignedToId: null, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    data: { assignedToId: userId, status: 'IN_PROGRESS' },
  });
  return result.count === 1;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export async function listStaffTasks(opts: ListStaffTasksOptions) {
  if (opts.view === 'needs_review') {
    const where: Record<string, unknown> = {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueDate: { lt: new Date() },
    };
    if (opts.priority) where['priority'] = opts.priority;
    if (opts.practiceId) where['practiceId'] = opts.practiceId;
    if (opts.taskGroup) where['taskGroup'] = opts.taskGroup;
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where, include: TASK_INCLUDE,
        orderBy: { dueDate: 'asc' }, // most overdue first
        take: opts.limit, skip: opts.offset,
      }),
      prisma.task.count({ where }),
    ]);
    return { tasks, total };
  }
  const where: Record<string, unknown> = {};
  if (opts.view === 'my') where['assignedToId'] = opts.userId;
  if (opts.view === 'pool') where['assignedToId'] = null;
  const status = opts.status ?? 'open';
  if (status === 'open') where['status'] = { in: ['PENDING', 'IN_PROGRESS'] };
  if (status === 'completed') where['status'] = { in: ['COMPLETED', 'SKIPPED'] };
  if (opts.priority) where['priority'] = opts.priority;
  if (opts.practiceId) where['practiceId'] = opts.practiceId;
  if (opts.taskGroup) where['taskGroup'] = opts.taskGroup;

  // ponytail: full-window in-memory sort (bounded); switch to raw SQL ordering if open tasks ever exceed the window
  const MAX_SORT_WINDOW = 1000;

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where, include: TASK_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: MAX_SORT_WINDOW,
    }),
    prisma.task.count({ where }),
  ]);

  const now = Date.now();
  rows.sort((a, b) => {
    const aOver = a.dueDate && a.dueDate.getTime() < now && a.status !== 'COMPLETED' ? 0 : 1;
    const bOver = b.dueDate && b.dueDate.getTime() < now && b.status !== 'COMPLETED' ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    const pr = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    if (pr !== 0) return pr;
    return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
  });
  const tasks = rows.slice(opts.offset, opts.offset + opts.limit);
  return { tasks, total };
}

export async function getMyTaskCounts(userId: string) {
  const [open, overdue, pool] = await Promise.all([
    prisma.task.count({ where: { assignedToId: userId, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
    prisma.task.count({ where: { assignedToId: userId, status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { lt: new Date() } } }),
    // Unassigned open tasks were invisible everywhere (staging feedback
    // 2026-07-20) — the nav badge now surfaces the pool as ambient signal.
    prisma.task.count({ where: { assignedToId: null, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
  ]);
  return { open, overdue, pool };
}

export async function listAssignees() {
  return prisma.user.findMany({
    where: { role: { in: [...ASSIGNABLE_ROLES] }, isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: { firstName: 'asc' },
  });
}

export interface ReviewStats {
  needsReviewCount: number;
  missedLast30: number;
  mostMissedBy: { name: string; count: number } | null;
  slowestPayer: { name: string; count: number } | null;
}

/**
 * Patterns strip + tab badge (D12, D16, D21). "Missed" = dueDate in
 * [now-30d, now) AND (open past due OR completed late). One findMany + JS
 * derivation — Prisma can't compare two columns (completedAt > dueDate) and
 * the volume is tiny (3-person team).
 */
export async function getReviewStats(now: Date = new Date()): Promise<ReviewStats> {
  const windowStart = new Date(now.getTime() - 30 * 86_400_000);
  const [needsReviewCount, windowTasks] = await Promise.all([
    prisma.task.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { lt: now } } }),
    prisma.task.findMany({
      where: { dueDate: { gte: windowStart, lt: now } },
      select: {
        id: true, status: true, dueDate: true, completedAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        payer: { select: { id: true, name: true } },
      },
    }),
  ]);

  const missed = windowTasks.filter((t) => {
    const openPastDue = t.status === 'PENDING' || t.status === 'IN_PROGRESS';
    const completedLate = t.completedAt != null && t.dueDate != null && t.completedAt.getTime() > t.dueDate.getTime();
    return openPastDue || completedLate;
  });

  const top = (entries: Map<string, { name: string; count: number }>) => {
    let best: { name: string; count: number } | null = null;
    for (const value of entries.values()) if (!best || value.count > best.count) best = value;
    return best;
  };

  const byAssignee = new Map<string, { name: string; count: number }>();
  const byPayer = new Map<string, { name: string; count: number }>();
  for (const t of missed) {
    if (t.assignedTo) {
      const entry = byAssignee.get(t.assignedTo.id) ?? { name: `${t.assignedTo.firstName} ${t.assignedTo.lastName}`, count: 0 };
      entry.count++; byAssignee.set(t.assignedTo.id, entry);
    }
    if (t.payer) {
      const entry = byPayer.get(t.payer.id) ?? { name: t.payer.name, count: 0 };
      entry.count++; byPayer.set(t.payer.id, entry);
    }
  }

  return { needsReviewCount, missedLast30: missed.length, mostMissedBy: top(byAssignee), slowestPayer: top(byPayer) };
}

/** Feeds the prompt-on-arrival dialog (D18): my open overdue tasks with no reason yet. */
export async function listMyOverdueUnanswered(userId: string, now: Date = new Date()) {
  return prisma.task.findMany({
    where: {
      assignedToId: userId,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueDate: { lt: now },
      overdueReason: null,
    },
    select: { id: true, title: true, description: true, dueDate: true },
    orderBy: { dueDate: 'asc' },
  });
}
