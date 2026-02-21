import cron from 'node-cron';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';

// ==========================================
// Concurrency guard
// ==========================================

let isRunning = false;

// ==========================================
// Core check function
// ==========================================

/**
 * Finds in_progress monitor_status tasks whose nextCheckAt is in the past
 * and re-enqueues them on the monitor queue.
 *
 * NOTE: We do NOT use Prisma JSON path filtering (unreliable across
 * providers). Instead, we fetch all in_progress monitor_status tasks
 * (capped at 50) and filter in JS.
 */
export async function checkOverdueMonitors(): Promise<number> {
  if (isRunning) {
    logger.debug('Monitor cron: skipping — previous run still in progress');
    return 0;
  }

  isRunning = true;
  let enqueued = 0;

  try {
    const tasks = await prisma.agentTask.findMany({
      where: {
        type: 'monitor_status',
        status: 'in_progress',
      },
      take: 50,
      include: {
        workflow: {
          select: {
            id: true,
            providerId: true,
            payerId: true,
          },
        },
      },
    });

    const now = new Date();
    const monitorQueue = getQueue(QUEUE_NAMES.MONITOR);

    for (const task of tasks) {
      const input = (task.input as Record<string, unknown>) ?? {};
      const nextCheckAt = input['nextCheckAt'] as string | undefined;

      // Skip tasks without a nextCheckAt or those not yet due
      if (!nextCheckAt) continue;
      if (new Date(nextCheckAt) > now) continue;

      // Re-enqueue the monitor job
      await monitorQueue.add('monitor_status', {
        workflowId: task.workflowId,
        taskId: task.id,
        enrollmentId: (input['enrollmentId'] as string) ?? undefined,
        providerId: task.workflow.providerId,
        payerId: task.workflow.payerId ?? '',
        submissionId: (input['submissionId'] as string) ?? undefined,
        submittedAt: (input['submittedAt'] as string) ?? task.createdAt.toISOString(),
        nextCheckAt,
        checkCount: (input['checkCount'] as number) ?? 0,
      });

      enqueued++;
    }

    if (enqueued > 0) {
      logger.info('Monitor cron: re-enqueued overdue tasks', { count: enqueued });
    }
  } catch (err) {
    logger.error('Monitor cron: error checking overdue monitors', { error: err });
  } finally {
    isRunning = false;
  }

  return enqueued;
}

// ==========================================
// Cron lifecycle
// ==========================================

let cronJob: cron.ScheduledTask | null = null;

/**
 * Starts the hourly monitor cron job.
 * Runs at the top of every hour.
 */
export function startMonitorCron(): void {
  if (cronJob) {
    logger.warn('Monitor cron: already running — ignoring start request');
    return;
  }

  cronJob = cron.schedule('0 * * * *', () => {
    checkOverdueMonitors().catch((err) =>
      logger.error('Monitor cron: unhandled error', { error: err })
    );
  });
  logger.info('Monitor cron started (runs every hour at :00)');
}

/**
 * Stops the monitor cron job.
 */
export function stopMonitorCron(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('Monitor cron stopped');
  }
}
