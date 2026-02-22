import { ServiceTier } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { invalidateCache } from '../utils/cache.js';

const CACHE_PREFIX = 'ops:';

/**
 * Assign a staff member to a practice.
 */
export async function assignStaffToPractice(
  staffId: string,
  practiceId: string,
  assignedById: string,
) {
  const assignment = await prisma.opsAssignment.create({
    data: {
      staffId,
      practiceId,
      assignedById,
    },
    include: {
      staff: { select: { id: true, firstName: true, lastName: true } },
      practice: { select: { id: true, name: true } },
    },
  });

  invalidateCache(CACHE_PREFIX);
  logger.info(`[OpsAssignment] Staff ${staffId} assigned to practice ${practiceId}`);
  return assignment;
}

/**
 * Assign a staff member to a provider.
 */
export async function assignStaffToProvider(
  staffId: string,
  providerId: string,
  assignedById: string,
) {
  const assignment = await prisma.opsAssignment.create({
    data: {
      staffId,
      providerId,
      assignedById,
    },
    include: {
      staff: { select: { id: true, firstName: true, lastName: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  invalidateCache(CACHE_PREFIX);
  logger.info(`[OpsAssignment] Staff ${staffId} assigned to provider ${providerId}`);
  return assignment;
}

/**
 * Assign a staff member to an enrollment.
 */
export async function assignStaffToEnrollment(
  staffId: string,
  enrollmentId: string,
  assignedById: string,
) {
  const assignment = await prisma.opsAssignment.create({
    data: {
      staffId,
      enrollmentId,
      assignedById,
    },
    include: {
      staff: { select: { id: true, firstName: true, lastName: true } },
      enrollment: {
        select: {
          id: true,
          status: true,
          payer: { select: { id: true, name: true } },
        },
      },
    },
  });

  invalidateCache(CACHE_PREFIX);
  logger.info(`[OpsAssignment] Staff ${staffId} assigned to enrollment ${enrollmentId}`);
  return assignment;
}

/**
 * Get all active assignments for a staff member, grouped by type.
 */
export async function getAssignmentsForStaff(staffId: string) {
  const assignments = await prisma.opsAssignment.findMany({
    where: {
      staffId,
      unassignedAt: null,
    },
    include: {
      practice: { select: { id: true, name: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      enrollment: {
        select: {
          id: true,
          status: true,
          payer: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  const practices = assignments.filter((a) => a.practiceId !== null);
  const providers = assignments.filter((a) => a.providerId !== null);
  const enrollments = assignments.filter((a) => a.enrollmentId !== null);

  return { practices, providers, enrollments };
}

/**
 * Get all active staff assignments for a practice.
 */
export async function getAssignmentsForPractice(practiceId: string) {
  const assignments = await prisma.opsAssignment.findMany({
    where: {
      practiceId,
      unassignedAt: null,
    },
    include: {
      staff: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  return assignments;
}

/**
 * Soft-delete an assignment by setting unassignedAt.
 */
export async function removeAssignment(assignmentId: string) {
  const assignment = await prisma.opsAssignment.update({
    where: { id: assignmentId },
    data: { unassignedAt: new Date() },
  });

  invalidateCache(CACHE_PREFIX);
  logger.info(`[OpsAssignment] Assignment ${assignmentId} removed (soft delete)`);
  return assignment;
}

/**
 * Transfer all active assignments and work items from one staff member to another.
 */
export async function transferAssignments(
  fromStaffId: string,
  toStaffId: string,
) {
  const [assignmentResult, workItemResult] = await prisma.$transaction([
    prisma.opsAssignment.updateMany({
      where: {
        staffId: fromStaffId,
        unassignedAt: null,
      },
      data: {
        staffId: toStaffId,
      },
    }),
    prisma.opsWorkItem.updateMany({
      where: {
        assignedToId: fromStaffId,
        status: { notIn: ['done', 'cancelled'] },
      },
      data: {
        assignedToId: toStaffId,
      },
    }),
  ]);

  invalidateCache(CACHE_PREFIX);
  logger.info(`[OpsAssignment] Transferred ${assignmentResult.count} assignments and ${workItemResult.count} work items from ${fromStaffId} to ${toStaffId}`);

  return {
    assignmentsTransferred: assignmentResult.count,
    workItemsTransferred: workItemResult.count,
  };
}

/**
 * Update the service tier for a practice.
 */
export async function updateServiceTier(
  practiceId: string,
  tier: ServiceTier,
) {
  const practice = await prisma.practice.update({
    where: { id: practiceId },
    data: { serviceTier: tier },
    select: { id: true, name: true, serviceTier: true },
  });

  invalidateCache(CACHE_PREFIX);
  logger.info(`[OpsAssignment] Practice ${practiceId} service tier updated to ${tier}`);
  return practice;
}

/**
 * List all active assignments with optional filters.
 */
export async function getActiveAssignments(filters?: {
  staffId?: string;
  practiceId?: string;
}) {
  const where: Record<string, unknown> = {
    unassignedAt: null,
  };

  if (filters?.staffId) {
    where['staffId'] = filters.staffId;
  }
  if (filters?.practiceId) {
    where['practiceId'] = filters.practiceId;
  }

  const assignments = await prisma.opsAssignment.findMany({
    where,
    include: {
      staff: { select: { id: true, firstName: true, lastName: true } },
      practice: { select: { id: true, name: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { assignedAt: 'desc' },
  });

  return assignments;
}
