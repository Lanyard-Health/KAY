import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock event logger (otherwise it tries to write through prisma)
vi.mock('../../src/agents/event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock Sentry — the recovery turn warning + max_replans warning go through here
vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// Mock the tool-executor so dispatch_task does not hit prisma/queues
vi.mock('../../src/agents/orchestrator/tool-executor.js', () => ({
  executeToolCall: vi.fn(),
}));

import * as Sentry from '@sentry/node';
import {
  processOrchestratorJob,
  setAnthropicClient,
} from '../../src/agents/orchestrator/orchestrator.service.js';
import { executeToolCall } from '../../src/agents/orchestrator/tool-executor.js';
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

beforeEach(() => {
  vi.clearAllMocks();
  setAnthropicClient(null);
});

describe('Orchestrator recovery loop', () => {
  // ----------------------------------------------------------------------
  // Test A — failed task triggers a recovery turn, replanCount goes 0 → 1
  // ----------------------------------------------------------------------
  it('takes a recovery turn when a dispatched task has failed (replanCount 0 → 1)', async () => {
    const wf = buildWorkflow({
      tasks: [{ id: 't-1', status: 'failed', error: { message: 'Prisma error' } }],
    });
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    setAnthropicClient(
      fakeAnthropicClient([
        {
          content: [{ type: 'text', text: 'Acknowledged failure; ending turn.' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ])
    );

    await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_failed',
    });

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Orchestrator recovery turn triggered',
      expect.objectContaining({ level: 'warning' })
    );

    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall).toBeDefined();
    expect(updateCall.data.plan.replanCount).toBe(1);
  });

  // ----------------------------------------------------------------------
  // Test B — cap hit → workflow 'failed' with reason, no Claude call
  // ----------------------------------------------------------------------
  it('marks workflow failed with max_replans_exceeded after the cap, without calling Claude', async () => {
    const wf = buildWorkflow({ plan: { steps: [], replanCount: 5 } });
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(wf as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wf as any);

    const claude = fakeAnthropicClient([]);
    setAnthropicClient(claude);

    const result = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_failed',
    });

    expect(result.status).toBe('failed');
    expect(result.reasoning).toBe('max_replans_exceeded');
    expect(claude.messages.create).not.toHaveBeenCalled();

    const updateCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.status).toBe('failed');
    expect(updateCall.data.plan.failureReason).toBe('max_replans_exceeded');
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);

    // Two Sentry warnings: recovery turn + max_replans_exceeded
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Orchestrator recovery turn triggered',
      expect.any(Object)
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Orchestrator workflow failed: max_replans_exceeded',
      expect.objectContaining({ level: 'warning' })
    );
  });

  // ----------------------------------------------------------------------
  // Test C — failure → recovery dispatches retry → retry succeeds → completed
  // ----------------------------------------------------------------------
  it('recovers from a failed task and completes when the replan succeeds', async () => {
    // ---- Turn 1: orchestrator sees a failed task and dispatches a recovery task ----
    const wfFailed = buildWorkflow({
      tasks: [{ id: 't-1', status: 'failed', error: { message: 'bad input' } }],
    });
    prismaMock.agentWorkflow.findUnique.mockResolvedValueOnce(wfFailed as any);
    prismaMock.agentWorkflow.update.mockResolvedValueOnce(wfFailed as any);

    // dispatch_task tool returns a new task id
    (executeToolCall as any).mockResolvedValueOnce({ taskId: 't-2', queue: 'agent-portal' });

    setAnthropicClient(
      fakeAnthropicClient([
        {
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'dispatch_task',
              input: {
                agentType: 'portal_interaction',
                action: 'check_readiness',
                providerId: 'p-1',
                payerId: 'pay-1',
              },
            },
          ],
          usage: { input_tokens: 50, output_tokens: 20 },
        },
        {
          content: [{ type: 'text', text: 'Recovery task dispatched.' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ])
    );

    const r1 = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_failed',
    });

    expect(r1.status).toBe('active');
    const turn1Update = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(turn1Update.data.plan.replanCount).toBe(1);

    // ---- Turn 2: simulated callback for the recovery task t-2 succeeding ----
    vi.clearAllMocks();
    const wfRecovered = buildWorkflow({
      plan: { steps: [], replanCount: 1 },
      tasks: [
        { id: 't-1', status: 'failed' },
        { id: 't-2', status: 'completed' },
      ],
    });
    prismaMock.agentWorkflow.findUnique.mockResolvedValueOnce(wfRecovered as any);
    prismaMock.agentWorkflow.update.mockResolvedValueOnce(wfRecovered as any);

    setAnthropicClient(
      fakeAnthropicClient([
        {
          content: [{ type: 'text', text: 'All recovery tasks complete.' }],
          usage: { input_tokens: 30, output_tokens: 10 },
        },
      ])
    );

    const r2 = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-2',
      event: 'task_completed',
    });

    expect(r2.status).toBe('completed');
    const turn2Update = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(turn2Update.data.plan.replanCount).toBe(1); // unchanged on success path
    expect(turn2Update.data.status).toBe('completed');
  });
});
