import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';
import { logAgentEvent } from '../event-logger.js';
import { emitWorkflowEvent } from '../websocket.js';
import { notifyTaskCompletion } from '../coordinator.service.js';
import { calculateMonitorDelay } from './backoff.js';
import type { MonitorJobData, MonitorJobResult, StatusCheckResult } from './types.js';

// ==========================================
// Main processor
// ==========================================

export async function processMonitorJob(data: MonitorJobData): Promise<MonitorJobResult> {
  const { workflowId, taskId, submittedAt, providerId, payerId } = data;

  // 1. Load task from DB (throw if not found so BullMQ retries)
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  // 2. Mark task as in_progress
  await prisma.agentTask.update({
    where: { id: taskId },
    data: { status: 'in_progress' },
  });

  // 3. Determine enrollment status
  // For now, return pending. Real adapter integration will replace this.
  // If task.input has a forcedStatus, use it (for testing/manual override).
  const taskInput = (task.input as Record<string, unknown>) ?? {};
  let statusResult: StatusCheckResult;

  if (taskInput['forcedStatus']) {
    statusResult = {
      status: taskInput['forcedStatus'] as StatusCheckResult['status'],
      details: (taskInput['forcedDetails'] as string) ?? undefined,
      denialReason: (taskInput['denialReason'] as string) ?? undefined,
      denialCode: (taskInput['denialCode'] as string) ?? undefined,
      effectiveDate: (taskInput['effectiveDate'] as string) ?? undefined,
      confirmationId: (taskInput['confirmationId'] as string) ?? undefined,
    };
  } else {
    statusResult = { status: 'pending' };
  }

  // 4. Calculate backoff info
  const { delayMs, isStalled } = calculateMonitorDelay(new Date(submittedAt));
  const checkCount = (data.checkCount ?? 0) + 1;

  let result: MonitorJobResult;

  switch (statusResult.status) {
    // ---- Approved ----
    case 'approved': {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          output: {
            status: 'approved',
            effectiveDate: statusResult.effectiveDate,
            confirmationId: statusResult.confirmationId,
            details: statusResult.details,
            checkCount,
          },
        },
      });

      await notifyTaskCompletion(workflowId, taskId, 'task_completed');

      result = { taskId, status: 'approved' };
      break;
    }

    // ---- Denied ----
    case 'denied': {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          error: {
            status: 'denied',
            denialReason: statusResult.denialReason,
            denialCode: statusResult.denialCode,
            details: statusResult.details,
            checkCount,
          },
        },
      });

      await notifyTaskCompletion(workflowId, taskId, 'task_failed');

      result = { taskId, status: 'denied' };
      break;
    }

    // ---- Additional info needed ----
    case 'additional_info_needed': {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          error: {
            status: 'additional_info_needed',
            details: statusResult.details,
            checkCount,
          },
        },
      });

      await notifyTaskCompletion(workflowId, taskId, 'task_failed');

      result = { taskId, status: 'additional_info_needed' };
      break;
    }

    // ---- Pending (schedule re-check) ----
    case 'pending':
    default: {
      const nextCheckAt = new Date(Date.now() + delayMs).toISOString();

      // Update task input with next check metadata
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          input: {
            ...taskInput,
            nextCheckAt,
            checkCount,
          },
        },
      });

      // Schedule delayed re-check job on the monitor queue
      const monitorQueue = getQueue(QUEUE_NAMES.MONITOR);
      await monitorQueue.add(
        'monitor_status',
        {
          workflowId,
          taskId,
          enrollmentId: data.enrollmentId,
          providerId,
          payerId,
          submissionId: data.submissionId,
          submittedAt,
          nextCheckAt,
          checkCount,
        },
        { delay: delayMs }
      );

      result = { taskId, status: 'pending', nextCheckAt, isStalled };
      break;
    }
  }

  // 5. If stalled, log warning and emit WebSocket event
  if (isStalled) {
    await logAgentEvent({
      workflowId,
      taskId,
      agent: 'monitor',
      action: 'monitor_stalled',
      level: 'warn',
      data: {
        providerId,
        payerId,
        submittedAt,
        checkCount,
        daysSinceSubmission: Math.floor(
          (Date.now() - new Date(submittedAt).getTime()) / (24 * 60 * 60 * 1000)
        ),
      },
    });

    emitWorkflowEvent(workflowId, 'monitor:stalled', {
      taskId,
      providerId,
      payerId,
      checkCount,
    });
  }

  // 6. Log event, emit WebSocket, return result
  await logAgentEvent({
    workflowId,
    taskId,
    agent: 'monitor',
    action: 'monitor_checked',
    data: {
      status: statusResult.status,
      checkCount,
      nextCheckAt: result.nextCheckAt,
      isStalled,
    },
  });

  emitWorkflowEvent(workflowId, 'monitor:checked', {
    taskId,
    status: statusResult.status,
    checkCount,
    nextCheckAt: result.nextCheckAt,
    isStalled,
  });

  logger.info('Monitor status checked', {
    workflowId,
    taskId,
    status: statusResult.status,
    checkCount,
    isStalled,
  });

  return result;
}
