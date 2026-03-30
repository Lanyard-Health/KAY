import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { logAgentEvent } from './event-logger.js';
import { emitApprovalRequest, emitApprovalDecision } from './websocket.js';
import { notifyTaskCompletion } from './coordinator.service.js';
import { getQueue, QUEUE_NAMES } from './queues.js';
import { resolveApproval } from '../services/workflow-approval.service.js';

// ==========================================
// Types
// ==========================================

export interface RequestApprovalInput {
  workflowId: string;
  taskId: string;
  type: string;
  context: Record<string, unknown>;
  expiresInMs?: number;
}

export interface DecideApprovalInput {
  decision: 'approved' | 'denied';
  decidedBy: string;
  notes?: string;
}

export interface ApprovalFilters {
  status?: string;
  workflowId?: string;
  limit?: number;
  offset?: number;
}

// ==========================================
// requestApproval
// ==========================================

const DEFAULT_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function requestApproval(input: RequestApprovalInput) {
  const { workflowId, taskId, type, context, expiresInMs = DEFAULT_EXPIRY_MS } = input;

  // Create approval record
  const approval = await prisma.pendingApproval.create({
    data: {
      workflowId,
      taskId,
      type,
      status: 'pending',
      context: context as any,
      expiresAt: new Date(Date.now() + expiresInMs),
    },
  });

  // Pause the workflow
  await prisma.agentWorkflow.update({
    where: { id: workflowId },
    data: { status: 'waiting_approval' },
  });

  // Log event
  await logAgentEvent({
    workflowId,
    taskId,
    agent: 'coordinator',
    action: 'approval_requested',
    data: { approvalId: approval.id, type },
  });

  // Push via WebSocket — strip any credential/PHI fields from broadcast context
  const safeContext = { ...context };
  for (const key of ['credentials', 'password', 'username', 'ssn', 'taxId', 'dateOfBirth']) {
    if (key in safeContext) safeContext[key] = '[REDACTED]';
  }
  emitApprovalRequest({
    approvalId: approval.id,
    workflowId,
    taskId,
    type,
    context: safeContext,
  });

  // Enqueue approval job for expiry scheduling
  const approvalQueue = getQueue(QUEUE_NAMES.APPROVAL);
  await approvalQueue.add('process_approval', {
    approvalId: approval.id,
    workflowId,
    taskId,
    type,
    expiresAt: approval.expiresAt?.toISOString() ?? null,
  });

  logger.info('Approval requested', { approvalId: approval.id, workflowId, type });

  return approval;
}

// ==========================================
// decideApproval
// ==========================================

export async function decideApproval(id: string, input: DecideApprovalInput) {
  const { decision, decidedBy, notes } = input;

  // Delegate core approval resolution (status update, expiry check, Retell trigger)
  const result = await resolveApproval(prisma, id, decision, decidedBy, notes ?? undefined);

  if (!result.resolved) {
    if (result.error === 'Approval not found') {
      throw new Error('Approval not found');
    }
    if (result.error === 'Approval has expired') {
      throw new Error('Approval has expired and can no longer be decided');
    }
    // "Approval already approved/denied"
    throw new Error(`Approval has already been decided (status: ${result.status})`);
  }

  // Fetch the resolved approval for workflow context
  const approval = await prisma.pendingApproval.findUniqueOrThrow({
    where: { id },
  });

  const workflowId = approval.workflowId;
  const taskId = approval.taskId;

  // Only manage agent workflow if this is a workflow_step approval (not follow-up)
  if (workflowId && taskId) {
    if (decision === 'approved') {
      await prisma.agentWorkflow.update({
        where: { id: workflowId },
        data: { status: 'active' },
      });

      await logAgentEvent({
        workflowId,
        taskId,
        agent: 'coordinator',
        action: 'approval_granted',
        data: { approvalId: id, decidedBy },
      });

      await notifyTaskCompletion(workflowId, taskId, 'task_completed');
    } else {
      await prisma.agentWorkflow.update({
        where: { id: workflowId },
        data: { status: 'failed' },
      });

      await prisma.agentTask.updateMany({
        where: {
          workflowId,
          status: { in: ['pending', 'queued'] },
        },
        data: { status: 'cancelled' },
      });

      await logAgentEvent({
        workflowId,
        taskId,
        agent: 'coordinator',
        action: 'approval_denied',
        data: { approvalId: id, decidedBy, notes },
      });

      await notifyTaskCompletion(workflowId, taskId, 'task_failed');
    }
  }

  // Push via WebSocket
  emitApprovalDecision({
    approvalId: id,
    workflowId: workflowId ?? undefined,
    decision,
    decidedBy,
  });

  logger.info('Approval decided', { approvalId: id, workflowId, decision });

  return approval;
}

// ==========================================
// listPendingApprovals
// ==========================================

export async function listPendingApprovals(
  filters: ApprovalFilters = {},
  practiceScope: Record<string, unknown> = {}
) {
  const { status, workflowId, limit = 20, offset = 0 } = filters;

  const where: Record<string, unknown> = {};
  if (status) where['status'] = status;
  if (workflowId) where['workflowId'] = workflowId;

  // Apply practice-scope filter to the workflow's provider
  if (Object.keys(practiceScope).length > 0) {
    where['workflow'] = practiceScope;
  }

  return prisma.pendingApproval.findMany({
    where,
    include: {
      workflow: {
        select: {
          id: true,
          goal: true,
          status: true,
          provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
          payer: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { requestedAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

// ==========================================
// getApproval
// ==========================================

export async function getApproval(id: string) {
  return prisma.pendingApproval.findUnique({
    where: { id },
    include: {
      workflow: {
        select: {
          id: true,
          goal: true,
          status: true,
          provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
          payer: { select: { id: true, name: true } },
        },
      },
    },
  });
}
