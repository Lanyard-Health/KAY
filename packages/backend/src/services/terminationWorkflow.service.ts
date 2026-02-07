import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import type { TaskType } from '@prisma/client';
import { generateTerminationLetter } from './terminationLetter.service.js';

/**
 * Auto-generates termination workflow tasks for a provider when a
 * terminationDate is first set on any of their payer enrollments.
 *
 * Idempotent: builds a Set of existing "type:enrollmentId" keys so
 * duplicate tasks are never created even if triggered multiple times.
 */
export async function triggerTerminationWorkflow(
  providerId: string,
  triggerEnrollmentId: string
): Promise<void> {
  try {
    // 1. Fetch all enrollments with an effectiveDate (active/relevant ones)
    const enrollments = await prisma.payerEnrollment.findMany({
      where: {
        providerId,
        effectiveDate: { not: null },
      },
      include: {
        payer: { select: { name: true } },
      },
    });

    if (enrollments.length === 0) {
      logger.info(`No active enrollments found for provider ${providerId}, skipping task generation`);
      return;
    }

    // 2. Fetch existing tasks for this provider to prevent duplicates
    const existingTasks = await prisma.task.findMany({
      where: {
        providerId,
        type: {
          in: ['TERMINATE_ENROLLMENT', 'CHECK_AVAILITY', 'UPDATE_CAQH', 'DRAFT_TERM_LETTER'] as TaskType[],
        },
      },
      select: { type: true, enrollmentId: true },
    });

    const existingKeys = new Set(
      existingTasks.map((t) => `${t.type}:${t.enrollmentId ?? 'null'}`)
    );

    // 3. Build the list of tasks to create
    const tasksToCreate: Array<{
      providerId: string;
      enrollmentId: string | null;
      title: string;
      description: string;
      type: TaskType;
    }> = [];

    for (const enrollment of enrollments) {
      const payerName = enrollment.payer.name;

      // TERMINATE_ENROLLMENT task per enrollment
      const termKey = `TERMINATE_ENROLLMENT:${enrollment.id}`;
      if (!existingKeys.has(termKey)) {
        tasksToCreate.push({
          providerId,
          enrollmentId: enrollment.id,
          title: `Terminate enrollment with ${payerName}`,
          description: `Submit termination request to ${payerName} for this provider's enrollment.`,
          type: 'TERMINATE_ENROLLMENT',
        });
      }

      // DRAFT_TERM_LETTER task per enrollment
      const letterKey = `DRAFT_TERM_LETTER:${enrollment.id}`;
      if (!existingKeys.has(letterKey)) {
        tasksToCreate.push({
          providerId,
          enrollmentId: enrollment.id,
          title: `Draft termination letter for ${payerName}`,
          description: `Prepare and send a formal termination letter to ${payerName}.`,
          type: 'DRAFT_TERM_LETTER',
        });
      }
    }

    // Provider-level tasks (no enrollmentId)
    if (!existingKeys.has('CHECK_AVAILITY:null')) {
      tasksToCreate.push({
        providerId,
        enrollmentId: null,
        title: 'Check Availity for termination status',
        description: 'Verify termination status across all payers in Availity.',
        type: 'CHECK_AVAILITY',
      });
    }

    if (!existingKeys.has('UPDATE_CAQH:null')) {
      tasksToCreate.push({
        providerId,
        enrollmentId: null,
        title: 'Update CAQH profile',
        description: 'Update the provider\'s CAQH profile to reflect terminated enrollments.',
        type: 'UPDATE_CAQH',
      });
    }

    // 4. Batch-create all tasks
    if (tasksToCreate.length > 0) {
      await prisma.task.createMany({ data: tasksToCreate });
      logger.info(
        `Created ${tasksToCreate.length} termination workflow tasks for provider ${providerId} (trigger: enrollment ${triggerEnrollmentId})`
      );

      // Auto-generate draft letters for newly created DRAFT_TERM_LETTER tasks
      const newLetterTasks = await prisma.task.findMany({
        where: {
          providerId,
          type: 'DRAFT_TERM_LETTER',
          enrollmentId: { not: null },
          terminationLetters: { none: {} },
        },
        select: { id: true, enrollmentId: true },
      });

      for (const task of newLetterTasks) {
        generateTerminationLetter(providerId, task.enrollmentId!, task.id)
          .catch((err) => logger.error(`Auto-generate letter failed for task ${task.id}:`, err));
      }
    } else {
      logger.info(
        `All termination tasks already exist for provider ${providerId}, no new tasks created`
      );
    }
  } catch (error) {
    // Fire-and-forget: log but don't throw so the enrollment update isn't blocked
    logger.error('Failed to generate termination workflow tasks:', error);
  }
}
