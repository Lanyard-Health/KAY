import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';
import { logAgentEvent } from '../event-logger.js';
import { emitWorkflowEvent } from '../websocket.js';
import { notifyTaskCompletion } from '../coordinator.service.js';
import { calculateMonitorDelay } from './backoff.js';
import { CaqhService } from '../../services/caqh.service.js';
import type { MonitorJobData, MonitorJobResult, StatusCheckResult } from './types.js';

// ==========================================
// Constants
// ==========================================

const ESCALATION_DAYS = 60;

// ==========================================
// Real enrollment status check
// ==========================================

async function checkEnrollmentStatus(
  data: MonitorJobData,
  submittedAt: Date
): Promise<StatusCheckResult> {
  const { enrollmentId } = data;

  // 1. LOAD CONTEXT — need enrollmentId to look anything up
  if (!enrollmentId) {
    return { status: 'pending', details: 'No enrollmentId — cannot check status' };
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      provider: { select: { id: true, caqhProviderId: true } },
      payer: { include: { submissionConfig: true } },
      denialTriages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!enrollment) {
    return { status: 'pending', details: 'Enrollment not found — may have been deleted' };
  }

  // 2. CHECK FOR RESOLUTION — human may have updated status
  switch (enrollment.status) {
    case 'approved':
      return {
        status: 'approved',
        effectiveDate: enrollment.effectiveDate?.toISOString(),
        confirmationId: enrollment.providerNumber ?? undefined,
        details: 'Enrollment marked as approved in Lanyard',
      };
    case 'denied':
    case 'terminated':
      return {
        status: 'denied',
        denialReason: enrollment.denialTriages[0]?.denialReason,
        details: `Enrollment status: ${enrollment.status}`,
      };
    case 'pending_review': {
      const latestTriage = enrollment.denialTriages[0];
      if (latestTriage && latestTriage.status === 'pending') {
        return {
          status: 'additional_info_needed',
          details: `Denial triage pending: ${latestTriage.denialReason}`,
        };
      }
      break;
    }
  }

  // 3. CHECK CAQH ATTESTATION (bonus signal)
  const submissionConfig = enrollment.payer.submissionConfig;
  const caqhProviderId = enrollment.provider.caqhProviderId;

  if (
    submissionConfig?.adapterType === 'caqh' &&
    caqhProviderId &&
    process.env['CAQH_API_URL'] &&
    process.env['CAQH_ORG_ID'] &&
    process.env['CAQH_API_KEY']
  ) {
    try {
      const caqhService = new CaqhService();
      const caqhStatus = await caqhService.checkStatus(caqhProviderId);
      if (caqhStatus.attestationStatus === 'expired' || caqhStatus.attestationStatus === 'inactive') {
        return {
          status: 'additional_info_needed',
          details: `CAQH attestation is ${caqhStatus.attestationStatus} — may be blocking enrollment`,
        };
      }
    } catch (err) {
      logger.warn('CAQH status check failed during monitor — continuing', {
        caqhProviderId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  // 4. CHECK STALENESS — escalate if pending too long
  const daysSinceSubmission = Math.floor(
    (Date.now() - submittedAt.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (daysSinceSubmission >= ESCALATION_DAYS) {
    return {
      status: 'denied',
      denialReason: `Enrollment pending for ${daysSinceSubmission} days with no payer response — requires manual intervention`,
      details: `Auto-escalated after ${ESCALATION_DAYS}+ days`,
    };
  }

  // 5. DEFAULT — still pending
  return { status: 'pending' };
}

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
    statusResult = await checkEnrollmentStatus(data, new Date(submittedAt));
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
