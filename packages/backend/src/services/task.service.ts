import type { Task, TaskType } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { logger } from '../utils/logger.js';

export async function createTask(
  data: {
    providerId: string;
    title: string;
    description?: string;
    type?: TaskType;
    enrollmentId?: string;
    assignedToId?: string;
    dueDate?: Date;
  },
  createdById: string,
): Promise<Task> {
  // 1. Verify provider exists
  const provider = await prisma.providerProfile.findUnique({
    where: { id: data.providerId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!provider) {
    throw new NotFoundError('Provider');
  }

  // 2. If enrollmentId provided, verify it belongs to this provider
  if (data.enrollmentId) {
    const enrollment = await prisma.enrollment.findFirst({
      where: { id: data.enrollmentId, providerId: data.providerId },
      select: { id: true },
    });
    if (!enrollment) {
      throw new NotFoundError('Enrollment not found for this provider');
    }
  }

  // 3. Create the task
  const task = await prisma.task.create({
    data: {
      providerId: data.providerId,
      enrollmentId: data.enrollmentId ?? null,
      title: data.title,
      description: data.description,
      type: data.type ?? 'CUSTOM',
      assignedToId: data.assignedToId,
      dueDate: data.dueDate ?? null,
    },
    include: {
      enrollment: {
        include: { payer: { select: { name: true } } },
      },
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  // 4. Notify assignee
  if (data.assignedToId) {
    prisma.inAppNotification.create({
      data: {
        userId: data.assignedToId,
        type: 'system_announcement',
        title: 'New task assigned',
        message: `You have been assigned: ${data.title}`,
        actionUrl: `/providers/${data.providerId}/tasks`,
        metadata: { taskId: task.id, providerId: data.providerId },
      },
    }).catch((err) => logger.error(`Failed to create notification for task ${task.id}:`, err));
  }

  // 5. Audit log
  prisma.auditLog.create({
    data: {
      userId: createdById,
      action: 'create',
      resourceType: 'task',
      resourceId: task.id,
      changes: {
        title: data.title,
        type: data.type ?? 'CUSTOM',
        providerId: data.providerId,
        ...(data.assignedToId && { assignedToId: data.assignedToId }),
      },
    },
  }).catch((err) => logger.error('Failed to create audit log for task creation:', err));

  return task;
}
