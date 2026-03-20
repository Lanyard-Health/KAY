import {
  OpsWorkItemCategory,
  OpsWorkItemPriority,
  OpsWorkItemStatus,
  WorkflowActionType,
  Prisma,
} from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { invalidateCache } from '../utils/cache.js';
import { notificationService } from './notification.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<OpsWorkItemPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const workItemIncludes = {
  practice: { select: { id: true, name: true } },
  provider: { select: { id: true, firstName: true, lastName: true } },
  enrollment: {
    include: {
      payer: { select: { id: true, name: true } },
    },
  },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  comments: {
    include: { author: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.OpsWorkItemInclude;

/**
 * Look up an active OpsAssignment for a given context (enrollment > provider > practice).
 * Returns the staffId if found, otherwise undefined.
 */
async function findAutoAssignee(
  practiceId?: string,
  providerId?: string,
  enrollmentId?: string,
): Promise<string | undefined> {
  if (!practiceId && !providerId && !enrollmentId) return undefined;

  // Try most specific first: enrollment, then provider, then practice
  const conditions: Prisma.OpsAssignmentWhereInput[] = [];
  if (enrollmentId) conditions.push({ enrollmentId, unassignedAt: null });
  if (providerId) conditions.push({ providerId, enrollmentId: null, unassignedAt: null });
  if (practiceId) conditions.push({ practiceId, providerId: null, enrollmentId: null, unassignedAt: null });

  for (const where of conditions) {
    const assignment = await prisma.opsAssignment.findFirst({
      where,
      orderBy: { assignedAt: 'desc' },
      select: { staffId: true },
    });
    if (assignment) return assignment.staffId;
  }

  return undefined;
}

/**
 * Map a WorkflowActionType to an OpsWorkItemCategory.
 */
function mapActionToCategory(actionType: WorkflowActionType): OpsWorkItemCategory {
  switch (actionType) {
    case 'form_submission':
    case 'portal_registration':
    case 'account_creation':
      return OpsWorkItemCategory.data_entry;
    case 'phone_call':
    case 'payer_outreach':
    case 'payer_internal':
    case 'payer_review':
      return OpsWorkItemCategory.payer_outreach;
    case 'document_upload':
    case 'document_review':
      return OpsWorkItemCategory.document_collection;
    case 'follow_up':
    case 'waiting_period':
      return OpsWorkItemCategory.follow_up;
    case 'verification':
    case 'caqh_update':
      return OpsWorkItemCategory.verification;
    default:
      return OpsWorkItemCategory.general;
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ---------------------------------------------------------------------------
// 1. createWorkItem
// ---------------------------------------------------------------------------

export async function createWorkItem(data: {
  title: string;
  description?: string;
  category: OpsWorkItemCategory;
  priority?: OpsWorkItemPriority;
  practiceId?: string;
  providerId?: string;
  enrollmentId?: string;
  assignedToId?: string;
  dueDate?: Date;
  slaDeadline?: Date;
  estimatedMinutes?: number;
}) {
  let assignedToId = data.assignedToId;

  if (!assignedToId) {
    assignedToId = await findAutoAssignee(data.practiceId, data.providerId, data.enrollmentId);
  }

  const item = await prisma.opsWorkItem.create({
    data: {
      title: data.title,
      description: data.description,
      category: data.category,
      priority: data.priority ?? OpsWorkItemPriority.normal,
      practiceId: data.practiceId,
      providerId: data.providerId,
      enrollmentId: data.enrollmentId,
      assignedToId,
      dueDate: data.dueDate,
      slaDeadline: data.slaDeadline,
      estimatedMinutes: data.estimatedMinutes,
    },
    include: workItemIncludes,
  });

  invalidateCache('ops:');
  return item;
}

// ---------------------------------------------------------------------------
// 2. getWorkQueue
// ---------------------------------------------------------------------------

export async function getWorkQueue(filters: {
  assigneeId?: string;
  practiceId?: string;
  status?: string[];
  priority?: string[];
  category?: string[];
  dueDateFrom?: Date;
  dueDateTo?: Date;
  slaStatus?: 'on_track' | 'at_risk' | 'breached';
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;

  const where: Prisma.OpsWorkItemWhereInput = {};

  if (filters.assigneeId) where.assignedToId = filters.assigneeId;
  if (filters.practiceId) where.practiceId = filters.practiceId;
  if (filters.status && filters.status.length > 0) {
    where.status = { in: filters.status as OpsWorkItemStatus[] };
  }
  if (filters.priority && filters.priority.length > 0) {
    where.priority = { in: filters.priority as OpsWorkItemPriority[] };
  }
  if (filters.category && filters.category.length > 0) {
    where.category = { in: filters.category as OpsWorkItemCategory[] };
  }

  if (filters.dueDateFrom || filters.dueDateTo) {
    where.dueDate = {};
    if (filters.dueDateFrom) where.dueDate.gte = filters.dueDateFrom;
    if (filters.dueDateTo) where.dueDate.lte = filters.dueDateTo;
  }

  if (filters.search) {
    const searchTerm = filters.search.trim();
    where.OR = [
      { title: { contains: searchTerm, mode: 'insensitive' } },
      { provider: { firstName: { contains: searchTerm, mode: 'insensitive' } } },
      { provider: { lastName: { contains: searchTerm, mode: 'insensitive' } } },
      { practice: { name: { contains: searchTerm, mode: 'insensitive' } } },
    ];
  }

  // If slaStatus filter is set we need to fetch all matching items first,
  // then filter in JS because slaStatus requires date comparison logic.
  if (filters.slaStatus) {
    const allItems = await prisma.opsWorkItem.findMany({
      where,
      include: workItemIncludes,
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
    });

    const now = new Date();
    const atRiskThresholdMs = 48 * 60 * 60 * 1000; // 48 hours

    const filtered = allItems.filter((item) => {
      const deadline = item.slaDeadline ?? item.dueDate;
      if (!deadline) return filters.slaStatus === 'on_track';

      const msRemaining = deadline.getTime() - now.getTime();

      switch (filters.slaStatus) {
        case 'breached':
          return msRemaining < 0;
        case 'at_risk':
          return msRemaining >= 0 && msRemaining <= atRiskThresholdMs;
        case 'on_track':
          return msRemaining > atRiskThresholdMs;
        default:
          return true;
      }
    });

    // Sort by priority (urgent first) then dueDate (earliest first)
    filtered.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;

      const da = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const db = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return { items, total, page, limit };
  }

  // Standard paginated query (no slaStatus filter)
  const [items, total] = await Promise.all([
    prisma.opsWorkItem.findMany({
      where,
      include: workItemIncludes,
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.opsWorkItem.count({ where }),
  ]);

  return { items, total, page, limit };
}

// ---------------------------------------------------------------------------
// 3. getMyWorkItems
// ---------------------------------------------------------------------------

export async function getMyWorkItems(userId: string) {
  return getWorkQueue({
    assigneeId: userId,
    status: ['backlog', 'todo', 'in_progress', 'waiting_external', 'review'],
  });
}

// ---------------------------------------------------------------------------
// 4. updateWorkItemStatus
// ---------------------------------------------------------------------------

export async function updateWorkItemStatus(
  workItemId: string,
  status: OpsWorkItemStatus,
  notes?: string,
) {
  const existing = await prisma.opsWorkItem.findUniqueOrThrow({
    where: { id: workItemId },
    select: { startedAt: true, completedAt: true },
  });

  const updateData: Prisma.OpsWorkItemUpdateInput = { status };

  if (status === OpsWorkItemStatus.in_progress && existing.startedAt === null) {
    updateData.startedAt = new Date();
  }

  if (
    (status === OpsWorkItemStatus.done || status === OpsWorkItemStatus.cancelled) &&
    existing.completedAt === null
  ) {
    updateData.completedAt = new Date();
  }

  const updated = await prisma.opsWorkItem.update({
    where: { id: workItemId },
    data: updateData,
    include: workItemIncludes,
  });

  if (notes) {
    await prisma.opsWorkItemComment.create({
      data: {
        workItemId,
        authorId: updated.assignedToId ?? workItemId, // system note
        content: `[Status changed to ${status}] ${notes}`,
        isInternal: true,
      },
    });
  }

  invalidateCache('ops:');
  return updated;
}

// ---------------------------------------------------------------------------
// 5. assignWorkItem
// ---------------------------------------------------------------------------

export async function assignWorkItem(workItemId: string, staffId: string) {
  const updated = await prisma.opsWorkItem.update({
    where: { id: workItemId },
    data: { assignedToId: staffId },
    include: workItemIncludes,
  });

  logger.info(`[OpsWorkQueue] Work item ${workItemId} assigned to staff ${staffId}`);
  invalidateCache('ops:');
  return updated;
}

// ---------------------------------------------------------------------------
// 6. bulkAssignWorkItems
// ---------------------------------------------------------------------------

export async function bulkAssignWorkItems(workItemIds: string[], staffId: string) {
  const result = await prisma.opsWorkItem.updateMany({
    where: { id: { in: workItemIds } },
    data: { assignedToId: staffId },
  });

  logger.info(`[OpsWorkQueue] Bulk assigned ${result.count} work items to staff ${staffId}`);
  invalidateCache('ops:');
  return result.count;
}

// ---------------------------------------------------------------------------
// 7. addComment
// ---------------------------------------------------------------------------

export async function addComment(workItemId: string, userId: string, content: string) {
  const comment = await prisma.opsWorkItemComment.create({
    data: {
      workItemId,
      authorId: userId,
      content,
      isInternal: true,
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return comment;
}

// ---------------------------------------------------------------------------
// 8. getComments
// ---------------------------------------------------------------------------

export async function getComments(workItemId: string) {
  return prisma.opsWorkItemComment.findMany({
    where: { workItemId },
    orderBy: { createdAt: 'asc' },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// 9. autoCreateWorkItems
// ---------------------------------------------------------------------------

export async function autoCreateWorkItems(enrollmentId: string) {
  const enrollment = await prisma.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: {
      provider: { select: { id: true, firstName: true, lastName: true, practiceId: true } },
      payer: { select: { id: true, name: true } },
    },
  });

  const steps = await prisma.enrollmentWorkflowStep.findMany({
    where: { enrollmentId },
    orderBy: { stepOrder: 'asc' },
  });

  if (steps.length === 0) {
    logger.info(`[OpsWorkQueue] No workflow steps found for enrollment ${enrollmentId}, skipping auto-create`);
    return 0;
  }

  const practiceId = enrollment.provider.practiceId ?? undefined;
  const providerId = enrollment.provider.id;

  // Resolve auto-assignee once for the enrollment context
  const autoAssigneeId = await findAutoAssignee(practiceId, providerId, enrollmentId);

  const enrollmentCreatedAt = enrollment.createdAt ?? new Date();

  const createData: Prisma.OpsWorkItemCreateManyInput[] = steps.map((step) => ({
    title: step.name,
    description: step.description,
    category: mapActionToCategory(step.actionType),
    priority: OpsWorkItemPriority.normal,
    enrollmentId,
    providerId,
    practiceId,
    assignedToId: autoAssigneeId,
    dueDate: addDays(enrollmentCreatedAt, step.estimatedDays),
  }));

  await prisma.opsWorkItem.createMany({ data: createData });

  logger.info(
    `[OpsWorkQueue] Auto-created ${steps.length} work items for enrollment ${enrollmentId} (${enrollment.provider.firstName} ${enrollment.provider.lastName} / ${enrollment.payer.name})`,
  );

  invalidateCache('ops:');
  return steps.length;
}

// ---------------------------------------------------------------------------
// 10. checkSlaBreaches
// ---------------------------------------------------------------------------

export async function checkSlaBreaches() {
  const now = new Date();

  const breachedEnrollments = await prisma.enrollment.findMany({
    where: {
      slaTargetDate: { lt: now },
      status: { notIn: ['approved', 'denied', 'terminated'] },
      slaBreachedAt: null,
    },
    include: {
      provider: { select: { id: true, firstName: true, lastName: true, practiceId: true } },
      payer: { select: { id: true, name: true } },
    },
  });

  if (breachedEnrollments.length === 0) return 0;

  for (const enrollment of breachedEnrollments) {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { slaBreachedAt: now },
    });

    const providerName = `${enrollment.provider.firstName} ${enrollment.provider.lastName}`;
    const payerName = enrollment.payer.name;
    const title = `SLA Breached: ${providerName} at ${payerName}`;

    await createWorkItem({
      title,
      description: `The SLA target date for this enrollment has been exceeded. Immediate follow-up is required.`,
      category: OpsWorkItemCategory.follow_up,
      priority: OpsWorkItemPriority.urgent,
      enrollmentId: enrollment.id,
      providerId: enrollment.provider.id,
      practiceId: enrollment.provider.practiceId ?? undefined,
    });

    logger.warn(`[OpsWorkQueue] SLA breach detected: ${title} (enrollment ${enrollment.id})`);
  }

  // Notify admin users about the breaches
  await notificationService.notifyAdminUsers({
    type: 'enrollment_status_change',
    title: 'SLA Breaches Detected',
    message: `${breachedEnrollments.length} enrollment(s) have breached their SLA target date. Urgent follow-up is required.`,
    actionUrl: '/ops/work-queue?slaStatus=breached',
  });

  logger.info(`[OpsWorkQueue] Processed ${breachedEnrollments.length} SLA breaches`);

  return breachedEnrollments.length;
}
