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
  try {
    await queue.add('plan_workflow', { workflowId: workflow.id });
  } catch (queueErr) {
    logger.error('Failed to enqueue planning job — marking workflow as failed', {
      workflowId: workflow.id,
      error: queueErr instanceof Error ? queueErr.message : 'unknown',
    });
    await prisma.agentWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: 'failed',
        plan: { error: 'Failed to enqueue planning job — Redis may be unavailable' },
      },
    });
    throw queueErr;
  }

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

export async function listWorkflows(filters: ListWorkflowsFilters, practiceWhere: Record<string, unknown> = {}) {
  const { status, providerId, limit = 20, offset = 0 } = filters;

  const where: Record<string, unknown> = { ...practiceWhere };
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

const TERMINAL_STATUSES = ['completed', 'cancelled', 'failed'] as const;

export async function cancelWorkflow(workflowId: string, reason: string) {
  // Check that the workflow exists and is in a cancellable state
  const existing = await prisma.agentWorkflow.findUnique({
    where: { id: workflowId },
    select: { status: true },
  });

  if (!existing) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  if ((TERMINAL_STATUSES as readonly string[]).includes(existing.status)) {
    throw new Error(
      `Workflow ${workflowId} cannot be cancelled — current status is "${existing.status}"`
    );
  }

  // Atomically update workflow and cancel pending tasks
  const [workflow] = await prisma.$transaction([
    prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    }),
    prisma.agentTask.updateMany({
      where: {
        workflowId,
        status: { in: ['pending', 'queued'] },
      },
      data: { status: 'cancelled' },
    }),
  ]);

  // Log cancellation event (fire-and-forget — handles its own failures)
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

  const queue = getQueue(QUEUE_NAMES.PORTAL);
  let job;
  try {
    job = await queue.add(action, {
      workflowId,
      taskId: task.id,
      providerId,
      payerId,
      enrollmentId,
      action,
    });
  } catch (queueErr) {
    logger.error('Failed to enqueue portal submission — marking task as failed', {
      workflowId,
      taskId: task.id,
      error: queueErr instanceof Error ? queueErr.message : 'unknown',
    });
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: 'failed',
        output: { error: 'Failed to enqueue job — Redis may be unavailable' },
      },
    });
    throw queueErr;
  }

  await prisma.agentTask.update({
    where: { id: task.id },
    data: { bullmqJobId: job.id ?? null },
  });

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

// ==========================================
// Types – Document Parsing
// ==========================================

export interface DispatchDocumentInput {
  workflowId: string;
  documentId: string;
  providerId: string;
  extractionHints?: string[];
}

// ==========================================
// dispatchDocumentParsing
// ==========================================

export async function dispatchDocumentParsing(input: DispatchDocumentInput) {
  const { workflowId, documentId, providerId, extractionHints } = input;

  const task = await prisma.agentTask.create({
    data: {
      workflowId,
      type: 'parse_document',
      agentType: 'document',
      stepNumber: 1,
      status: 'queued',
      input: { documentId, providerId, extractionHints: extractionHints ?? [] },
    },
  });

  const queue = getQueue(QUEUE_NAMES.DOCUMENT);
  let job;
  try {
    job = await queue.add('parse_document', {
      workflowId,
      taskId: task.id,
      documentId,
      providerId,
      extractionHints,
    });
  } catch (queueErr) {
    logger.error('Failed to enqueue document parsing — marking task as failed', {
      workflowId,
      taskId: task.id,
      error: queueErr instanceof Error ? queueErr.message : 'unknown',
    });
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: 'failed',
        output: { error: 'Failed to enqueue job — Redis may be unavailable' },
      },
    });
    throw queueErr;
  }

  await prisma.agentTask.update({
    where: { id: task.id },
    data: { bullmqJobId: job.id ?? null },
  });

  await logAgentEvent({
    workflowId,
    taskId: task.id,
    agent: 'coordinator',
    action: 'document_parsing_dispatched',
    data: { documentId, taskId: task.id },
  });

  logger.info('Document parsing dispatched', { workflowId, documentId, taskId: task.id });

  return task;
}

// ==========================================
// notifyTaskCompletion
// ==========================================

/**
 * Enqueues a task_callback job to the orchestrator queue so the
 * orchestrator can decide what to do next after a task completes or fails.
 */
export async function notifyTaskCompletion(
  workflowId: string,
  taskId: string,
  event: 'task_completed' | 'task_failed'
) {
  const queue = getQueue(QUEUE_NAMES.ORCHESTRATOR);
  await queue.add('task_callback', {
    workflowId,
    taskId,
    event,
    jobType: 'task_callback',
  });

  await logAgentEvent({
    workflowId,
    taskId,
    agent: 'coordinator',
    action: 'task_callback_enqueued',
    data: { event },
  });

  logger.info('Task callback enqueued', { workflowId, taskId, event });
}
