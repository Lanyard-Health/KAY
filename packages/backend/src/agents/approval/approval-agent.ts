import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';
import { logAgentEvent } from '../event-logger.js';
import { emitApprovalDecision } from '../websocket.js';
import { notifyTaskCompletion } from '../coordinator.service.js';
import type { ApprovalJobData, ApprovalJobResult } from './types.js';

// ==========================================
// Main processor
// ==========================================

export async function processApprovalJob(data: ApprovalJobData): Promise<ApprovalJobResult> {
  const { approvalId, workflowId, taskId, type, expiresAt } = data;

  // 1. Load approval from DB
  const approval = await prisma.pendingApproval.findUnique({
    where: { id: approvalId },
  });

  if (!approval) {
    throw new Error(`Approval ${approvalId} not found`);
  }

  // 2. If already decided, skip
  if (approval.status !== 'pending') {
    logger.debug('Approval already decided, skipping', {
      approvalId,
      status: approval.status,
    });
    return { approvalId, action: 'already_decided' };
  }

  const expiresAtDate = new Date(expiresAt);
  const now = new Date();

  // 3. If expired, auto-deny
  if (expiresAtDate <= now) {
    // Update approval to denied
    await prisma.pendingApproval.update({
      where: { id: approvalId },
      data: {
        status: 'denied',
        decisionNotes: 'Auto-denied: approval expired after 48h without decision',
      },
    });

    // Fail the workflow
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { status: 'failed' },
    });

    // Cancel pending tasks
    await prisma.agentTask.updateMany({
      where: { workflowId, status: 'pending' },
      data: { status: 'cancelled' },
    });

    // Notify coordinator
    await notifyTaskCompletion(workflowId, taskId, 'task_failed');

    // Log agent event
    await logAgentEvent({
      workflowId,
      taskId,
      agent: 'approval',
      action: 'approval_auto_denied',
      data: { approvalId, type, expiresAt },
    });

    // Emit WebSocket event
    emitApprovalDecision({ approvalId, workflowId, decision: 'expired' });

    logger.info('Approval auto-denied due to expiry', { approvalId, workflowId });

    return { approvalId, action: 'auto_denied' };
  }

  // 4. Not expired — schedule delayed expiry check
  const delay = expiresAtDate.getTime() - now.getTime();
  const approvalQueue = getQueue(QUEUE_NAMES.APPROVAL);

  await approvalQueue.add(
    'check_expiry',
    { approvalId, workflowId, taskId, type, expiresAt },
    { delay, jobId: `expiry-${approvalId}` }
  );

  // Log agent event
  await logAgentEvent({
    workflowId,
    taskId,
    agent: 'approval',
    action: 'expiry_scheduled',
    data: { approvalId, type, expiresAt, delayMs: delay },
  });

  logger.info('Expiry check scheduled', { approvalId, workflowId, delay });

  return { approvalId, action: 'scheduled_expiry' };
}
