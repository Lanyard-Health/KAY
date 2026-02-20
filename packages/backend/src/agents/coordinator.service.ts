import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getQueue, QUEUE_NAMES } from './queues.js';
import { logAgentEvent } from './event-logger.js';

// ==========================================
// Constants
// ==========================================

const MAX_CONCURRENT_WORKFLOWS = parseInt(
  process.env['AGENT_MAX_CONCURRENT_WORKFLOWS'] ?? '10',
  10
);

const ACTIVE_STATUSES = ['planning', 'active', 'paused', 'waiting_approval'] as const;

// ==========================================
// Types
// ==========================================

export interface CreateWorkflowInput {
  goal: string;
  providerId: string;
  payerId?: string;
  enrollmentId?: string;
  priority?: string;
  requestedBy: string;
}

export interface DispatchPortalInput {
  workflowId: string;
  providerId: string;
  payerId: string;
  enrollmentId?: string;
  action?: 'submit_to_portal' | 'check_readiness';
}

export interface ListWorkflowsFilters {
  status?: string;
  providerId?: string;
  limit?: number;
  offset?: number;
}

// ==========================================
// createWorkflow
// ==========================================

export async function createWorkflow(input: CreateWorkflowInput) {
  const { goal, providerId, payerId, enrollmentId, priority, requestedBy } = input;

  // Enforce concurrent workflow limit per provider
  const activeCount = await prisma.agentWorkflow.count({
    where: {
      providerId,
      status: { in: [...ACTIVE_STATUSES] },
    },
  });

  if (activeCount >= MAX_CONCURRENT_WORKFLOWS) {
    throw new Error(
      `Provider ${providerId} has reached the concurrent workflow limit (${MAX_CONCURRENT_WORKFLOWS})`
    );
  }

  // Build goalParams
  const goalParams: Record<string, string> = { providerId };
  if (payerId) goalParams['payerId'] = payerId;
  if (enrollmentId) goalParams['enrollmentId'] = enrollmentId;

  // Create workflow record
  const workflow = await prisma.agentWorkflow.create({
    data: {
      goal,
      goalParams,
      status: 'planning',
      priority: priority ?? 'normal',
      providerId,
      payerId: payerId ?? null,
      enrollmentId: enrollmentId ?? null,
      requestedBy,
    },
  });

  // Enqueue planning job
  const queue = getQueue(QUEUE_NAMES.ORCHESTRATOR);
  await queue.add('plan_workflow', { workflowId: workflow.id });

  // Log event (fire-and-forget style — logAgentEvent never throws)
  await logAgentEvent({
    workflowId: workflow.id,
    agent: 'coordinator',
    action: 'workflow_created',
    data: { goal, providerId, payerId, enrollmentId, priority: priority ?? 'normal' },
  });

  logger.info('Workflow created', { workflowId: workflow.id, providerId });

  return workflow;
}

// ==========================================
// getWorkflow
// ==========================================

export async function getWorkflow(workflowId: string) {
  return prisma.agentWorkflow.findUnique({
    where: { id: workflowId },
    include: {
      tasks: { orderBy: { stepNumber: 'asc' } },
      approvals: { orderBy: { requestedAt: 'desc' } },
      provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
      payer: { select: { id: true, name: true } },
    },
  });
}

// ==========================================
// listWorkflows
// ==========================================

export async function listWorkflows(filters: ListWorkflowsFilters) {
  const { status, providerId, limit = 20, offset = 0 } = filters;

  const where: Record<string, unknown> = {};
  if (status) where['status'] = status;
  if (providerId) where['providerId'] = providerId;

  return prisma.agentWorkflow.findMany({
    where,
    include: {
      provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
      payer: { select: { id: true, name: true } },
      _count: { select: { tasks: true, events: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

// ==========================================
// getWorkflowEvents
// ==========================================

export async function getWorkflowEvents(workflowId: string, limit = 100) {
  return prisma.agentEvent.findMany({
    where: { workflowId },
    orderBy: { timestamp: 'asc' },
    take: limit,
  });
}

// ==========================================
// cancelWorkflow
// ==========================================

export async function cancelWorkflow(workflowId: string, reason: string) {
  // Update workflow status
  const workflow = await prisma.agentWorkflow.update({
    where: { id: workflowId },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason,
    },
  });

  // Cancel all pending/queued tasks
  await prisma.agentTask.updateMany({
    where: {
      workflowId,
      status: { in: ['pending', 'queued'] },
    },
    data: { status: 'cancelled' },
  });

  // Log cancellation event
  await logAgentEvent({
    workflowId,
    agent: 'coordinator',
    action: 'workflow_cancelled',
    data: { reason },
  });

  logger.info('Workflow cancelled', { workflowId, reason });

  return workflow;
}

// ==========================================
// dispatchPortalSubmission
// ==========================================

export async function dispatchPortalSubmission(input: DispatchPortalInput) {
  const { workflowId, providerId, payerId, enrollmentId, action = 'submit_to_portal' } = input;

  // Create task record
  const task = await prisma.agentTask.create({
    data: {
      workflowId,
      type: action,
      agentType: 'portal',
      stepNumber: 1,
      status: 'queued',
      input: { providerId, payerId, enrollmentId, action },
    },
  });

  // Enqueue to portal queue
  const queue = getQueue(QUEUE_NAMES.PORTAL);
  const job = await queue.add(action, {
    workflowId,
    taskId: task.id,
    providerId,
    payerId,
    enrollmentId,
    action,
  });

  // Link BullMQ job ID to task
  await prisma.agentTask.update({
    where: { id: task.id },
    data: { bullmqJobId: job.id ?? null },
  });

  // Log event
  await logAgentEvent({
    workflowId,
    taskId: task.id,
    agent: 'coordinator',
    action: 'portal_submission_dispatched',
    data: { payerId, taskId: task.id, submissionAction: action },
  });

  logger.info('Portal submission dispatched', { workflowId, taskId: task.id, payerId });

  return task;
}
