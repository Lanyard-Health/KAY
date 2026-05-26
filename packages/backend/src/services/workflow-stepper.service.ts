/**
 * Deterministic workflow stepper.
 *
 * Phase 4 of the orchestrator cost-optimization plan. The orchestrator's LLM
 * loop is expensive because the model re-derives "what's the next step?" from
 * scratch every turn. For routine credentialing workflows the next step is
 * deterministic — when check_readiness succeeds, submit_to_portal is the next
 * thing to dispatch, full stop. No reasoning needed.
 *
 * This stepper handles those happy-path transitions with zero LLM tokens.
 * Anything that's NOT a deterministic transition (failures, denials, novel
 * task types, missing preconditions) bails to the LLM orchestrator via
 * { outcome: 'needs_llm', reason } — the router then runs the regular
 * processOrchestratorJob path. No state divergence, no skipped events.
 *
 * SAFETY: this code path is opt-in via DETERMINISTIC_STEPPER env var
 * (workflow-router.service.ts checks the flag). Default OFF — flipping the
 * env var on Render is the only enable, flipping it off is the rollback.
 */

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getQueue, QUEUE_NAMES, type QueueName } from '../agents/queues.js';
import { logAgentEvent } from '../agents/event-logger.js';
import type { AgentTask, AgentWorkflow } from '@prisma/client';

export interface StepperContext {
  workflowId: string;
  taskId: string;
  /** task_completed | task_failed — stepper only handles task_completed. */
  event: 'task_completed' | 'task_failed';
}

export type StepperOutcome =
  | { outcome: 'dispatched'; dispatchedTaskId: string; nextTaskType: string }
  | { outcome: 'completed'; newStatus: 'completed' }
  | { outcome: 'needs_llm'; reason: string };

/**
 * Per-actionType handlers. Each handler answers: "task X just completed —
 * what's the deterministic next step, if any?" Returning `needs_llm` punts
 * to the LLM orchestrator. Handlers should be conservative — if there's any
 * doubt, return needs_llm.
 */
type Handler = (args: {
  task: AgentTask;
  workflow: AgentWorkflow;
}) => Promise<StepperOutcome>;

/**
 * check_readiness happy path: provider is ready AND payer has an active
 * portal adapter → dispatch submit_to_portal. Otherwise bail to LLM
 * (manual approval flow, missing config, etc. all need reasoning).
 */
const handleCheckReadinessCompleted: Handler = async ({ task, workflow }) => {
  const output = task.output as Record<string, unknown> | null;
  if (!output) {
    return { outcome: 'needs_llm', reason: 'check_readiness completed with no output' };
  }

  // Readiness check returned not-ready. Could be missing credentials, expired
  // licenses, no portal adapter — all need LLM judgment on whether to escalate,
  // request approval, or wait. Don't try to be clever.
  if (output['ready'] !== true) {
    return {
      outcome: 'needs_llm',
      reason: `check_readiness returned ready=${output['ready']} — needs reasoning`,
    };
  }

  if (!workflow.payerId) {
    return { outcome: 'needs_llm', reason: 'workflow has no payerId — cannot deterministically pick portal' };
  }

  // Adapter existence guard — mirrors tool-executor's check. If no active
  // adapter (most payers), the LLM will request_human_approval for manual
  // submission. Don't try to fake that flow here.
  if (process.env['DISABLE_PORTAL_AUTOMATION'] === 'true') {
    return { outcome: 'needs_llm', reason: 'portal automation disabled in this environment' };
  }

  const adapter = await prisma.payerSubmissionConfig.findUnique({
    where: { payerId: workflow.payerId },
    select: { isActive: true },
  });
  if (!adapter || !adapter.isActive) {
    return {
      outcome: 'needs_llm',
      reason: 'no active portal adapter — manual submission flow needs LLM-driven approval',
    };
  }

  const input = task.input as Record<string, unknown>;
  const providerId = input['providerId'];
  const payerId = input['payerId'] ?? workflow.payerId;

  if (typeof providerId !== 'string' || typeof payerId !== 'string') {
    return { outcome: 'needs_llm', reason: 'missing providerId/payerId for submit_to_portal' };
  }

  const dispatched = await dispatchAgentTask({
    workflowId: workflow.id,
    type: 'submit_to_portal',
    agentType: 'portal_interaction',
    queue: QUEUE_NAMES.PORTAL,
    input: { providerId, payerId },
  });

  return { outcome: 'dispatched', dispatchedTaskId: dispatched.taskId, nextTaskType: 'submit_to_portal' };
};

/**
 * submit_to_portal happy path: portal accepted the submission (output.status
 * is 'submitted' / 'queued' / has a confirmation field) → schedule
 * monitor_status. Anything else (rejection, error) bails to LLM.
 */
const handleSubmitToPortalCompleted: Handler = async ({ task, workflow }) => {
  const output = task.output as Record<string, unknown> | null;
  if (!output) {
    return { outcome: 'needs_llm', reason: 'submit_to_portal completed with no output' };
  }

  const status = output['status'];
  const hasConfirmation = output['confirmationNumber'] !== undefined || output['confirmation'] !== undefined;

  // Accept obvious happy-path indicators. Conservatively bail on anything else.
  const happyPath = status === 'submitted' || status === 'queued' || hasConfirmation;
  if (!happyPath) {
    return {
      outcome: 'needs_llm',
      reason: `submit_to_portal output status=${JSON.stringify(status)} — non-happy-path needs reasoning`,
    };
  }

  if (!workflow.payerId) {
    return { outcome: 'needs_llm', reason: 'workflow has no payerId — cannot schedule monitor' };
  }

  const input = task.input as Record<string, unknown>;
  const providerId = input['providerId'];
  const payerId = input['payerId'] ?? workflow.payerId;

  if (typeof providerId !== 'string' || typeof payerId !== 'string') {
    return { outcome: 'needs_llm', reason: 'missing providerId/payerId for monitor_status' };
  }

  const dispatched = await dispatchAgentTask({
    workflowId: workflow.id,
    type: 'monitor_status',
    agentType: 'status_monitor',
    queue: QUEUE_NAMES.MONITOR,
    input: { providerId, payerId },
  });

  return { outcome: 'dispatched', dispatchedTaskId: dispatched.taskId, nextTaskType: 'monitor_status' };
};

/**
 * monitor_status terminal happy path: payer approved the application →
 * mark workflow completed. Any other outcome (denial, pending, error) bails
 * to LLM — denial in particular triggers the denial-triage flow.
 */
const handleMonitorStatusCompleted: Handler = async ({ task, workflow }) => {
  const output = task.output as Record<string, unknown> | null;
  if (!output) {
    return { outcome: 'needs_llm', reason: 'monitor_status completed with no output' };
  }

  const status = output['status'];

  if (status !== 'approved') {
    // pending/denied/error all need LLM. Don't try to handle them.
    return {
      outcome: 'needs_llm',
      reason: `monitor_status returned status=${JSON.stringify(status)} — not the deterministic terminal case`,
    };
  }

  // Approval = workflow is done. Mark complete and we're out.
  await prisma.agentWorkflow.update({
    where: { id: workflow.id },
    data: { status: 'completed', completedAt: new Date() },
  });

  await logAgentEvent({
    workflowId: workflow.id,
    agent: 'stepper',
    action: 'workflow_completed',
    data: { reason: 'monitor_status returned approved', completedTaskId: task.id },
  });

  return { outcome: 'completed', newStatus: 'completed' };
};

const HANDLERS: Record<string, Handler> = {
  check_readiness: handleCheckReadinessCompleted,
  submit_to_portal: handleSubmitToPortalCompleted,
  monitor_status: handleMonitorStatusCompleted,
};

/**
 * Main entry point. Called by the workflow router when a task_callback comes
 * in. Returns an outcome telling the caller whether the stepper handled the
 * transition, completed the workflow, or wants the LLM to take over.
 */
export async function processStepperCallback(ctx: StepperContext): Promise<StepperOutcome> {
  if (ctx.event !== 'task_completed') {
    // Failures need LLM reasoning — they may indicate denial, error, missing
    // precondition, or need exception-agent dispatch. Don't second-guess.
    return { outcome: 'needs_llm', reason: `event=${ctx.event} — stepper only handles task_completed` };
  }

  const task = await prisma.agentTask.findUnique({ where: { id: ctx.taskId } });
  if (!task) {
    return { outcome: 'needs_llm', reason: `task ${ctx.taskId} not found` };
  }

  const workflow = await prisma.agentWorkflow.findUnique({ where: { id: ctx.workflowId } });
  if (!workflow) {
    return { outcome: 'needs_llm', reason: `workflow ${ctx.workflowId} not found` };
  }

  const handler = HANDLERS[task.type];
  if (!handler) {
    return { outcome: 'needs_llm', reason: `no stepper handler for task type ${task.type}` };
  }

  const outcome = await handler({ task, workflow });

  await logAgentEvent({
    workflowId: ctx.workflowId,
    taskId: ctx.taskId,
    agent: 'stepper',
    action: 'stepper_decision',
    data: {
      completedTaskType: task.type,
      outcome: outcome.outcome,
      ...(outcome.outcome === 'dispatched' ? { nextTaskType: outcome.nextTaskType } : {}),
      ...(outcome.outcome === 'needs_llm' ? { reason: outcome.reason } : {}),
    },
  });

  return outcome;
}

/**
 * Mirror of tool-executor's dispatchTask, minus the orchestrator-facing
 * validation/narration. Stepper-driven dispatches are by construction
 * coming from a deterministic transition so we don't need the same
 * "did Claude pick a sensible task type?" guards.
 */
async function dispatchAgentTask(params: {
  workflowId: string;
  type: string;
  agentType: string;
  queue: string;
  input: Record<string, unknown>;
}): Promise<{ taskId: string }> {
  const existingTaskCount = await prisma.agentTask.count({
    where: { workflowId: params.workflowId },
  });

  const task = await prisma.agentTask.create({
    data: {
      workflowId: params.workflowId,
      type: params.type,
      agentType: params.agentType,
      status: 'queued',
      input: params.input as any,
      stepNumber: existingTaskCount + 1,
      queue: params.queue,
      queuedAt: new Date(),
    },
  });

  const queue = getQueue(params.queue as QueueName);
  const job = await queue.add(params.type, {
    workflowId: params.workflowId,
    taskId: task.id,
    ...params.input,
  });

  await prisma.agentTask.update({
    where: { id: task.id },
    data: { bullmqJobId: job.id },
  });

  await logAgentEvent({
    workflowId: params.workflowId,
    taskId: task.id,
    agent: 'stepper',
    action: 'task_dispatched',
    data: { type: params.type, queue: params.queue, viaStepper: true },
  });

  logger.info('Stepper dispatched task', {
    workflowId: params.workflowId,
    taskId: task.id,
    type: params.type,
  });

  return { taskId: task.id };
}
