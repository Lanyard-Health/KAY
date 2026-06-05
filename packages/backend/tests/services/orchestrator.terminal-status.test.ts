import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock event logger
vi.mock('../../src/agents/event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock Sentry
vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// Mock the tool-executor
vi.mock('../../src/agents/orchestrator/tool-executor.js', () => ({
  executeToolCall: vi.fn(),
}));

import * as Sentry from '@sentry/node';
import {
  processOrchestratorJob,
  setAnthropicClient,
} from '../../src/agents/orchestrator/orchestrator.service.js';
import { executeToolCall } from '../../src/agents/orchestrator/tool-executor.js';
import { logger } from '../../src/utils/logger.js';
import { prismaMock } from '../helpers/mock-prisma.js';

// ========== test helpers ==========

interface MockResponse {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  usage: { input_tokens: number; output_tokens: number };
}

function fakeAnthropicClient(scriptedResponses: MockResponse[]): any {
  let i = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => {
        if (i >= scriptedResponses.length) {
          throw new Error(`fakeAnthropicClient: no scripted response at index ${i}`);
        }
        return scriptedResponses[i++];
      }),
    },
  };
}

function buildWorkflow(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: 'wf-1',
    goal: 'credential_check',
    goalParams: { providerId: 'p-1' },
    status: 'active',
    replanCount: 0,
    priority: 'normal',
    plan: { steps: [], replanCount: 0 },
    providerId: 'p-1',
    payerId: null,
    enrollmentId: null,
    requestedBy: 'user-1',
    totalTokensUsed: 0,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    startedAt: null,
    totalDurationMs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    tasks: [],
    approvals: [],
    ...overrides,
  };
}

function infoGatherResponse(idx: number): MockResponse {
  return {
    content: [
      {
        type: 'tool_use',
        id: `tu-${idx}`,
        name: 'get_provider_profile',
        input: { providerId: 'p-1' },
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAnthropicClient(null);
});

describe('Orchestrator terminal-status detection', () => {
  // ---------------------------------------------------------------------
  // Scenario 1: natural finish, info-gathering only (turn 3 reproduction)
  // ---------------------------------------------------------------------
  it('completes when Claude finishes naturally after info-gathering with no actions', async () => {
    const wf = buildWorkflow();
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    (executeToolCall as any).mockResolvedValue({ provider: { id: 'p-1' } });

    setAnthropicClient(
      fakeAnthropicClient([
        infoGatherResponse(0),
        infoGatherResponse(1),
        {
          content: [{ type: 'text', text: '✅ Active license, ❌ No malpractice insurance.' }],
          usage: { input_tokens: 30, output_tokens: 15 },
        },
      ])
    );

    const result = await processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' });

    expect(result.status).toBe('completed');

    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.status).toBe('completed');
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    expect(updateCall.data.plan.replanCount).toBe(0);
    expect(updateCall.data.plan.failureReason).toBeUndefined();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Orchestrator workflow completed',
      expect.objectContaining({ level: 'info' })
    );
  });

  // -------------------------------------------------------
  // Scenario 2: natural finish with zero tool calls
  // -------------------------------------------------------
  it('completes when Claude returns text only with no tool calls', async () => {
    const wf = buildWorkflow();
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    setAnthropicClient(
      fakeAnthropicClient([
        {
          content: [{ type: 'text', text: 'Nothing to do.' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ])
    );

    const result = await processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' });

    expect(result.status).toBe('completed');
    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
  });

  // ---------------------------------------------------------------------
  // Scenario 3a: cap hit, info-only, status='active' on entry
  // ---------------------------------------------------------------------
  it('keeps an already-active workflow active when cap hits with no actions, and emits warn log', async () => {
    const wf = buildWorkflow({ status: 'active' });
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    (executeToolCall as any).mockResolvedValue({ provider: { id: 'p-1' } });

    // 20 info-gathering responses → cap hit
    const responses = Array.from({ length: 20 }, (_, i) => infoGatherResponse(i));
    setAnthropicClient(fakeAnthropicClient(responses));

    const result = await processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' });

    expect(result.status).toBe('active');

    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.status).toBe('active');
    expect(updateCall.data.completedAt).toBeUndefined();
    expect(updateCall.data.plan.failureReason).toBeUndefined();

    // No Sentry info breadcrumb on completion (didn't complete)
    expect(Sentry.captureMessage).not.toHaveBeenCalledWith(
      'Orchestrator workflow completed',
      expect.any(Object)
    );

    // Warn-level telemetry log for the stuck-active edge case
    expect(logger.warn).toHaveBeenCalledWith(
      'Orchestrator cap hit with no progress; workflow remains active',
      expect.objectContaining({
        workflowId: 'wf-1',
        workflowStatus: 'active',
        dispatchedTaskIds: 0,
      })
    );
  });

  // ---------------------------------------------------------------------
  // Scenario 3b: cap hit, info-only, status='planning' on entry
  // ---------------------------------------------------------------------
  it('fails a planning workflow with cap_hit_on_first_turn when cap hits with no actions', async () => {
    const wf = buildWorkflow({ status: 'planning' });
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    (executeToolCall as any).mockResolvedValue({ provider: { id: 'p-1' } });

    const responses = Array.from({ length: 20 }, (_, i) => infoGatherResponse(i));
    setAnthropicClient(fakeAnthropicClient(responses));

    const result = await processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' });

    expect(result.status).toBe('failed');

    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.status).toBe('failed');
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    expect(updateCall.data.plan.failureReason).toBe('cap_hit_on_first_turn');

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Orchestrator workflow failed: cap_hit_on_first_turn',
      expect.objectContaining({ level: 'warning' })
    );
  });

  // -------------------------------------------------------
  // Scenario 4: cap hit with one dispatch already issued
  // -------------------------------------------------------
  it('stays active when cap hits but at least one task was dispatched', async () => {
    const wf = buildWorkflow({ status: 'active' });
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    // First call: dispatch_task. Subsequent calls: info-gathering.
    (executeToolCall as any).mockImplementation(async (name: string) => {
      if (name === 'dispatch_task') return { taskId: 't-99', queue: 'agent-portal' };
      return { provider: { id: 'p-1' } };
    });

    const responses: MockResponse[] = [
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu-dispatch',
            name: 'dispatch_task',
            input: { type: 'check_readiness', input: { providerId: 'p-1' } },
          },
        ],
        usage: { input_tokens: 50, output_tokens: 20 },
      },
      ...Array.from({ length: 19 }, (_, i) => infoGatherResponse(i)),
    ];
    setAnthropicClient(fakeAnthropicClient(responses));

    const result = await processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' });

    expect(result.status).toBe('active');
    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.plan.failureReason).toBeUndefined();
    // No "stuck active" warn log since dispatch path ran
    expect(logger.warn).not.toHaveBeenCalledWith(
      'Orchestrator cap hit with no progress; workflow remains active',
      expect.any(Object)
    );
  });

  // -------------------------------------------------------
  // Scenario 5: natural finish with one dispatched task
  // -------------------------------------------------------
  it('stays active when Claude dispatches a task and finishes naturally', async () => {
    const wf = buildWorkflow();
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    (executeToolCall as any).mockResolvedValue({ taskId: 't-2', queue: 'agent-portal' });

    setAnthropicClient(
      fakeAnthropicClient([
        {
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'dispatch_task',
              input: { type: 'check_readiness', input: { providerId: 'p-1' } },
            },
          ],
          usage: { input_tokens: 50, output_tokens: 20 },
        },
        {
          content: [{ type: 'text', text: 'Task dispatched.' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ])
    );

    const result = await processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' });

    expect(result.status).toBe('active');
    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.completedAt).toBeUndefined();
  });

  // -------------------------------------------------------
  // Scenario 6: approval requested
  // -------------------------------------------------------
  it('transitions to waiting_approval when Claude requests human approval', async () => {
    const wf = buildWorkflow();
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    (executeToolCall as any).mockResolvedValue({ approvalId: 'a-1' });

    setAnthropicClient(
      fakeAnthropicClient([
        {
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'request_human_approval',
              input: { type: 'portal_submission', context: {} },
            },
          ],
          usage: { input_tokens: 50, output_tokens: 20 },
        },
        {
          content: [{ type: 'text', text: 'Awaiting approval.' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ])
    );

    const result = await processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' });

    expect(result.status).toBe('waiting_approval');
    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.completedAt).toBeUndefined();
  });

  // -------------------------------------------------------
  // Scenario 7: escalate with no fallback dispatch
  // -------------------------------------------------------
  it('fails when Claude escalates with no fallback dispatched task', async () => {
    const wf = buildWorkflow();
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    (executeToolCall as any).mockResolvedValue({ escalated: true });

    setAnthropicClient(
      fakeAnthropicClient([
        {
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'escalate_to_exception',
              input: { issue: 'Cannot proceed' },
            },
          ],
          usage: { input_tokens: 50, output_tokens: 20 },
        },
        {
          content: [{ type: 'text', text: 'Escalated.' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ])
    );

    const result = await processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' });

    expect(result.status).toBe('failed');
    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.status).toBe('failed');
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    // Escalation path doesn't set cap_hit_on_first_turn failureReason
    expect(updateCall.data.plan.failureReason).toBeUndefined();
  });
});
