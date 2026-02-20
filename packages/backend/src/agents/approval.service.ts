import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { logAgentEvent } from './event-logger.js';
import { emitApprovalRequest, emitApprovalDecision } from './websocket.js';

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

const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

  // Push via WebSocket
  emitApprovalRequest({
    approvalId: approval.id,
    workflowId,
    taskId,
    type,
    context,
  });

  logger.info('Approval requested', { approvalId: approval.id, workflowId, type });

  return approval;
}

// ==========================================
// decideApproval
// ==========================================

export async function decideApproval(id: string, input: DecideApprovalInput) {
  const { decision, decidedBy, notes } = input;

  // Update approval record
  const approval = await prisma.pendingApproval.update({
    where: { id },
    data: {
      status: decision,
      decidedBy,
      decidedAt: new Date(),
      decisionNotes: notes ?? null,
    },
  });

  const workflowId = approval.workflowId;

  if (decision === 'approved') {
    // Resume the workflow
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { status: 'active' },
    });

    await logAgentEvent({
      workflowId,
      taskId: approval.taskId,
      agent: 'coordinator',
      action: 'approval_granted',
      data: { approvalId: id, decidedBy },
    });
  } else {
    // Deny — mark workflow as failed and cancel pending tasks
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
      taskId: approval.taskId,
      agent: 'coordinator',
      action: 'approval_denied',
      data: { approvalId: id, decidedBy, notes },
    });
  }

  // Push via WebSocket
  emitApprovalDecision({
    approvalId: id,
    workflowId,
    decision,
    decidedBy,
  });

  logger.info('Approval decided', { approvalId: id, workflowId, decision });

  return approval;
}

// ==========================================
// listPendingApprovals
// ==========================================

export async function listPendingApprovals(filters: ApprovalFilters = {}) {
  const { status, workflowId, limit = 20, offset = 0 } = filters;

  const where: Record<string, unknown> = {};
  if (status) where['status'] = status;
  if (workflowId) where['workflowId'] = workflowId;

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
