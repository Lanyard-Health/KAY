import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

export const ASSIGNABLE_ROLES = ['admin', 'lanyard_staff'] as const;

export interface CreateStaffTaskInput {
  title: string; description?: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueDate?: Date; assignedToId?: string;
  providerId?: string; practiceId?: string; enrollmentId?: string;
}
export interface ListStaffTasksOptions {
  view: 'my' | 'pool' | 'all'; userId: string;
  status?: 'open' | 'completed' | 'all'; priority?: string; practiceId?: string;
  limit: number; offset: number;
}

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  provider: { select: { id: true, firstName: true, lastName: true } },
  practice: { select: { id: true, name: true } },
  enrollment: { select: { id: true, payer: { select: { name: true } } } },
} as const;

export async function assertAssignableUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive || !(ASSIGNABLE_ROLES as readonly string[]).includes(user.role)) {
    throw new Error('ASSIGNEE_NOT_ALLOWED');
  }
}

function assertSingleLink(input: Pick<CreateStaffTaskInput, 'providerId' | 'practiceId' | 'enrollmentId'>) {
  const links = [input.providerId, input.practiceId, input.enrollmentId].filter(Boolean);
  if (links.length > 1) throw new Error('MULTIPLE_LINKS');
}

function notifyAssignee(userId: string, taskId: string, title: string) {
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
  assertSingleLink(input);
  if (input.assignedToId) await assertAssignableUser(input.assignedToId);
  const task = await prisma.task.create({
    data: {
      title: input.title, description: input.description,
      type: 'CUSTOM', priority: input.priority,
      status: input.assignedToId ? 'IN_PROGRESS' : 'PENDING', // spec: auto-status on assignment
      dueDate: input.dueDate, assignedToId: input.assignedToId,
      providerId: input.providerId, practiceId: input.practiceId, enrollmentId: input.enrollmentId,
      createdById: creatorId,
    },
    include: TASK_INCLUDE,
  });
  if (input.assignedToId && input.assignedToId !== creatorId) notifyAssignee(input.assignedToId, task.id, input.title);
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
  const where: Record<string, unknown> = {};
  if (opts.view === 'my') where['assignedToId'] = opts.userId;
  if (opts.view === 'pool') where['assignedToId'] = null;
  const status = opts.status ?? 'open';
  if (status === 'open') where['status'] = { in: ['PENDING', 'IN_PROGRESS'] };
  if (status === 'completed') where['status'] = { in: ['COMPLETED', 'SKIPPED'] };
  if (opts.priority) where['priority'] = opts.priority;
  if (opts.practiceId) where['practiceId'] = opts.practiceId;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where, include: TASK_INCLUDE,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: opts.limit, skip: opts.offset,
    }),
    prisma.task.count({ where }),
  ]);

  // ponytail: in-page sort (overdue first, then priority rank) on the fetched window;
  // move to raw SQL ordering if pages ever feel wrong at large volumes.
  const now = Date.now();
  tasks.sort((a, b) => {
    const aOver = a.dueDate && a.dueDate.getTime() < now && a.status !== 'COMPLETED' ? 0 : 1;
    const bOver = b.dueDate && b.dueDate.getTime() < now && b.status !== 'COMPLETED' ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    const pr = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    if (pr !== 0) return pr;
    return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
  });
  return { tasks, total };
}

export async function getMyTaskCounts(userId: string) {
  const [open, overdue] = await Promise.all([
    prisma.task.count({ where: { assignedToId: userId, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
    prisma.task.count({ where: { assignedToId: userId, status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { lt: new Date() } } }),
  ]);
  return { open, overdue };
}

export async function listAssignees() {
  return prisma.user.findMany({
    where: { role: { in: [...ASSIGNABLE_ROLES] }, isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: { firstName: 'asc' },
  });
}
