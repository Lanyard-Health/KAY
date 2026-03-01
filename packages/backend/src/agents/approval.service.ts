import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { emailService } from '../services/email.service.js';
import { logAgentEvent } from './event-logger.js';
import { emitApprovalRequest, emitApprovalDecision } from './websocket.js';
import { notifyTaskCompletion } from './coordinator.service.js';
import { getQueue, QUEUE_NAMES } from './queues.js';

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
    expiresAt: approval.expiresAt.toISOString(),
  });

  // Email approvers (fire-and-forget)
  try {
    const workflow = await prisma.agentWorkflow.findUnique({
      where: { id: workflowId },
      select: { goal: true, provider: { select: { practiceId: true } } },
    });
    if (workflow?.provider?.practiceId) {
      const admins = await prisma.user.findMany({
        where: {
          role: { in: ['admin', 'credentialing_staff', 'practice_admin'] },
          isActive: true,
          practices: { some: { practiceId: workflow.provider.practiceId } },
        },
        select: { email: true },
      });
      const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:5190';
      const expiresLabel = new Date(Date.now() + expiresInMs).toLocaleString();
      for (const admin of admins) {
        emailService.sendEmail({
          to: admin.email,
          subject: `Action Required: Approval needed — ${workflow.goal}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #0A3D2E;">Approval Required</h2>
              <p>A workflow requires your approval:</p>
              <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0 0 8px;"><strong>Goal:</strong> ${workflow.goal}</p>
                <p style="margin: 0 0 8px;"><strong>Type:</strong> ${type}</p>
                <p style="margin: 0;"><strong>Expires:</strong> ${expiresLabel}</p>
              </div>
              <p><a href="${frontendUrl}/ai-agent?tab=approvals" style="display: inline-block; padding: 10px 20px; background: #0A3D2E; color: #fff; text-decoration: none; border-radius: 6px;">Review Approval</a></p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
              <p style="color: #6b7280; font-size: 12px;">This is an automated message from Lanyard Health.</p>
            </div>
          `,
        }).catch(() => {}); // fire-and-forget
      }
    }
  } catch (e) {
    logger.warn('Failed to email approvers', { error: (e as Error).message });
  }

  logger.info('Approval requested', { approvalId: approval.id, workflowId, type });

  return approval;
}

// ==========================================
// decideApproval
// ==========================================

export async function decideApproval(id: string, input: DecideApprovalInput) {
  const { decision, decidedBy, notes } = input;

  // Fetch the approval first to check status and expiry
  const existing = await prisma.pendingApproval.findUnique({
    where: { id },
    select: { status: true, expiresAt: true },
  });

  if (!existing) {
    throw new Error('Approval not found');
  }

  if (existing.status !== 'pending') {
    throw new Error(`Approval has already been decided (status: ${existing.status})`);
  }

  if (existing.expiresAt && existing.expiresAt < new Date()) {
    throw new Error('Approval has expired and can no longer be decided');
  }

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

    // Notify orchestrator to resume processing
    await notifyTaskCompletion(workflowId, approval.taskId, 'task_completed');
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

    // Notify orchestrator about failure
    await notifyTaskCompletion(workflowId, approval.taskId, 'task_failed');
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
