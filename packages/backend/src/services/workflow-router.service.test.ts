import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStepperCallback = vi.hoisted(() => vi.fn());
vi.mock('./workflow-stepper.service.js', () => ({
  processStepperCallback: mockStepperCallback,
}));

vi.mock('../agents/event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { routeOrchestratorJob, routeAndProcessOrchestratorJob, isStepperEnabled } from './workflow-router.service.js';
import type { OrchestratorJobData, OrchestratorResult } from '../agents/orchestrator/orchestrator.service.js';

const llmProcessor = vi.fn<(data: OrchestratorJobData) => Promise<OrchestratorResult>>(async (d) => ({
  workflowId: d.workflowId,
  status: 'active',
  tokensUsed: 1234,
  toolCallCount: 3,
  reasoning: 'llm reasoning',
}));

describe('routeOrchestratorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env['DETERMINISTIC_STEPPER'];
  });

  it('routes to LLM when DETERMINISTIC_STEPPER flag is off', async () => {
    const decision = await routeOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_completed',
    });
    expect(decision.route).toBe('llm');
    expect(mockStepperCallback).not.toHaveBeenCalled();
  });

  it('routes plan_workflow to LLM even when flag is on', async () => {
    process.env['DETERMINISTIC_STEPPER'] = 'true';
    const decision = await routeOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'plan_workflow',
    });
    expect(decision.route).toBe('llm');
    if (decision.route === 'llm') expect(decision.reason).toContain('plan_workflow');
    expect(mockStepperCallback).not.toHaveBeenCalled();
  });

  it('routes task_callback to stepper when flag is on', async () => {
    process.env['DETERMINISTIC_STEPPER'] = 'true';
    mockStepperCallback.mockResolvedValue({
      outcome: 'dispatched',
      dispatchedTaskId: 't-new',
      nextTaskType: 'submit_to_portal',
    });
    const decision = await routeOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_completed',
    });
    expect(decision.route).toBe('stepper');
    expect(mockStepperCallback).toHaveBeenCalledTimes(1);
  });

  it('routes to LLM when stepper bails with needs_llm', async () => {
    process.env['DETERMINISTIC_STEPPER'] = 'true';
    mockStepperCallback.mockResolvedValue({
      outcome: 'needs_llm',
      reason: 'no handler for parse_document',
    });
    const decision = await routeOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_completed',
    });
    expect(decision.route).toBe('llm');
    if (decision.route === 'llm') expect(decision.reason).toContain('stepper bailed');
  });

  it('routes to LLM when task_callback has no taskId', async () => {
    process.env['DETERMINISTIC_STEPPER'] = 'true';
    const decision = await routeOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
    });
    expect(decision.route).toBe('llm');
    expect(mockStepperCallback).not.toHaveBeenCalled();
  });
});

describe('routeAndProcessOrchestratorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env['DETERMINISTIC_STEPPER'];
  });

  it('invokes LLM processor when flag off', async () => {
    const result = await routeAndProcessOrchestratorJob(
      { workflowId: 'wf-1', jobType: 'plan_workflow' },
      llmProcessor
    );
    expect(llmProcessor).toHaveBeenCalledTimes(1);
    expect(result.tokensUsed).toBe(1234);
  });

  it('returns zero-token result when stepper dispatches', async () => {
    process.env['DETERMINISTIC_STEPPER'] = 'true';
    mockStepperCallback.mockResolvedValue({
      outcome: 'dispatched',
      dispatchedTaskId: 't-new',
      nextTaskType: 'submit_to_portal',
    });
    const result = await routeAndProcessOrchestratorJob(
      { workflowId: 'wf-1', jobType: 'task_callback', taskId: 't-1', event: 'task_completed' },
      llmProcessor
    );
    expect(llmProcessor).not.toHaveBeenCalled();
    expect(result.tokensUsed).toBe(0);
    expect(result.status).toBe('active');
    expect(result.reasoning).toContain('submit_to_portal');
  });

  it('returns completed result when stepper marks workflow done', async () => {
    process.env['DETERMINISTIC_STEPPER'] = 'true';
    mockStepperCallback.mockResolvedValue({ outcome: 'completed', newStatus: 'completed' });
    const result = await routeAndProcessOrchestratorJob(
      { workflowId: 'wf-1', jobType: 'task_callback', taskId: 't-1', event: 'task_completed' },
      llmProcessor
    );
    expect(llmProcessor).not.toHaveBeenCalled();
    expect(result.tokensUsed).toBe(0);
    expect(result.status).toBe('completed');
  });

  it('falls back to LLM when stepper bails', async () => {
    process.env['DETERMINISTIC_STEPPER'] = 'true';
    mockStepperCallback.mockResolvedValue({ outcome: 'needs_llm', reason: 'novel state' });
    const result = await routeAndProcessOrchestratorJob(
      { workflowId: 'wf-1', jobType: 'task_callback', taskId: 't-1', event: 'task_completed' },
      llmProcessor
    );
    expect(llmProcessor).toHaveBeenCalledTimes(1);
    expect(result.tokensUsed).toBe(1234);
  });
});

describe('isStepperEnabled', () => {
  afterEach(() => {
    delete process.env['DETERMINISTIC_STEPPER'];
  });

  it('returns false when env is unset', () => {
    expect(isStepperEnabled()).toBe(false);
  });

  it('returns false for arbitrary truthy values that are not "true"', () => {
    process.env['DETERMINISTIC_STEPPER'] = '1';
    expect(isStepperEnabled()).toBe(false);
    process.env['DETERMINISTIC_STEPPER'] = 'yes';
    expect(isStepperEnabled()).toBe(false);
  });

  it('returns true only for exact "true"', () => {
    process.env['DETERMINISTIC_STEPPER'] = 'true';
    expect(isStepperEnabled()).toBe(true);
  });
});
