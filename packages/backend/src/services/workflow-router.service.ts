/**
 * Workflow router — decides whether an orchestrator job goes to the
 * deterministic stepper or the LLM orchestrator.
 *
 * Lives between the BullMQ worker and processOrchestratorJob/processStepperCallback.
 * Phase 4 of the cost-optimization plan. The router is intentionally simple:
 *
 *   1. Feature flag off → LLM (today's behavior, no risk).
 *   2. Initial planning job → LLM (planning needs reasoning).
 *   3. Task callback → ask the stepper. If stepper handled it, we're done.
 *      If stepper bailed with needs_llm → fall back to LLM.
 *
 * Falling back to LLM means we invoke the regular processOrchestratorJob path
 * — same code, same prompts, same telemetry. The stepper has not produced any
 * state change on a needs_llm outcome, so this is safe.
 */

import { logger } from '../utils/logger.js';
import { logAgentEvent } from '../agents/event-logger.js';
import { processStepperCallback, type StepperOutcome } from './workflow-stepper.service.js';
import type { OrchestratorJobData, OrchestratorResult } from '../agents/orchestrator/orchestrator.service.js';

export type RouterDecision =
  | { route: 'stepper'; outcome: StepperOutcome }
  | { route: 'llm'; reason: string };

export function isStepperEnabled(): boolean {
  return process.env['DETERMINISTIC_STEPPER'] === 'true';
}

/**
 * Decides which path to take. Pure decision — does NOT actually run the LLM
 * (caller does that to keep the control flow simple). Calls the stepper
 * directly when it's a candidate, because the stepper's "should I handle
 * this?" logic is intertwined with reading task state from the DB.
 */
export async function routeOrchestratorJob(
  data: OrchestratorJobData
): Promise<RouterDecision> {
  if (!isStepperEnabled()) {
    return { route: 'llm', reason: 'DETERMINISTIC_STEPPER feature flag is off' };
  }

  if (data.jobType !== 'task_callback') {
    return { route: 'llm', reason: `jobType=${data.jobType} — only task_callback is stepper-eligible` };
  }

  if (!data.taskId) {
    return { route: 'llm', reason: 'task_callback missing taskId' };
  }

  const stepperOutcome = await processStepperCallback({
    workflowId: data.workflowId,
    taskId: data.taskId,
    event: data.event ?? 'task_completed',
  });

  if (stepperOutcome.outcome === 'needs_llm') {
    return { route: 'llm', reason: `stepper bailed: ${stepperOutcome.reason}` };
  }

  return { route: 'stepper', outcome: stepperOutcome };
}

/**
 * Convenience wrapper: runs the router and either returns the stepper result
 * or invokes the LLM orchestrator. Returns the same OrchestratorResult shape
 * regardless of path, so the BullMQ worker doesn't need to care which path
 * fired.
 */
export async function routeAndProcessOrchestratorJob(
  data: OrchestratorJobData,
  llmProcessor: (data: OrchestratorJobData) => Promise<OrchestratorResult>
): Promise<OrchestratorResult> {
  const decision = await routeOrchestratorJob(data);

  await logAgentEvent({
    workflowId: data.workflowId,
    agent: 'router',
    action: 'route_decision',
    data: {
      route: decision.route,
      ...(decision.route === 'llm' ? { reason: decision.reason } : { stepperOutcome: decision.outcome.outcome }),
      jobType: data.jobType,
      ...(data.taskId ? { taskId: data.taskId } : {}),
    },
  });

  if (decision.route === 'llm') {
    logger.info('Router → LLM orchestrator', {
      workflowId: data.workflowId,
      reason: decision.reason,
    });
    return llmProcessor(data);
  }

  // Stepper handled it. Synthesize an OrchestratorResult so the worker contract
  // matches the LLM path. Zero tokens used — that's the whole point.
  // (needs_llm is unreachable here — the router folded it into the LLM branch above.)
  const { outcome } = decision;
  switch (outcome.outcome) {
    case 'dispatched':
      return {
        workflowId: data.workflowId,
        status: 'active',
        tokensUsed: 0,
        toolCallCount: 1,
        reasoning: `stepper: dispatched ${outcome.nextTaskType}`,
      };
    case 'completed':
      return {
        workflowId: data.workflowId,
        status: 'completed',
        tokensUsed: 0,
        toolCallCount: 0,
        reasoning: 'stepper: workflow completed',
      };
    default:
      // needs_llm is impossible here (folded into the LLM branch above) but
      // we keep a defensive fallback rather than an exhaustiveness throw so
      // a future stepper outcome addition doesn't crash the worker.
      logger.warn('Router got unexpected stepper outcome — falling back to LLM', {
        workflowId: data.workflowId,
        outcome,
      });
      return llmProcessor(data);
  }
}
