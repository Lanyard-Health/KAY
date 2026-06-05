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
    plan: { steps: [] },
    replanCount: 0,
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
  // Test A — failed task triggers a recovery turn, replanCount goes 0 → 1.
  // The increment fires BEFORE findUnique; findUnique returns the post-
  // increment value (1) which is what the JSON mirror persists.
  // ----------------------------------------------------------------------
  it('takes a recovery turn when a dispatched task has failed (replanCount 0 → 1)', async () => {
    const wf = buildWorkflow({
      replanCount: 1, // post-increment value findUnique sees in prod
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

    // Two update calls: (1) atomic increment, (2) post-loop persist
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledTimes(2);

    const incrementCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(incrementCall.where).toEqual({ id: 'wf-1' });
    expect(incrementCall.data).toEqual({ replanCount: { increment: 1 } });

    const persistCall = prismaMock.agentWorkflow.update.mock.calls[1]?.[0] as any;
    expect(persistCall.data.plan.replanCount).toBe(1);
  });

  // ----------------------------------------------------------------------
  // Test B — post-increment cap hit → workflow 'failed' with reason, no Claude call.
  // Pre-fix the cap check used `>= 5` against a pre-increment value; post-fix
  // it uses `> 5` against the post-increment value, so to trip it findUnique
  // must return replanCount=6 (after the increment ran).
  // ----------------------------------------------------------------------
  it('marks workflow failed with max_replans_exceeded after the cap, without calling Claude', async () => {
    const wf = buildWorkflow({ replanCount: 6 }); // post-increment value > MAX (5)
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

    // Two update calls: (1) atomic increment, (2) the failed-status update
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledTimes(2);

    const incrementCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(incrementCall.data).toEqual({ replanCount: { increment: 1 } });

    const failCall = prismaMock.agentWorkflow.update.mock.calls[1]?.[0] as any;
    expect(failCall.data.status).toBe('failed');
    expect(failCall.data.plan.failureReason).toBe('max_replans_exceeded');
    expect(failCall.data.plan.replanCount).toBe(6);
    expect(failCall.data.completedAt).toBeInstanceOf(Date);

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
  // Test C — failure → recovery dispatches retry → retry succeeds → completed.
  // Turn 1: increment fires + persist (2 updates).
  // Turn 2 (task_completed event): no increment, only persist (1 update).
  // ----------------------------------------------------------------------
  it('recovers from a failed task and completes when the replan succeeds', async () => {
    // ---- Turn 1: orchestrator sees a failed task and dispatches a recovery task ----
    const wfFailed = buildWorkflow({
      replanCount: 1, // post-increment value findUnique sees
      tasks: [{ id: 't-1', status: 'failed', error: { message: 'bad input' } }],
    });
    prismaMock.agentWorkflow.findUnique.mockResolvedValueOnce(wfFailed as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(wfFailed as any);

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
    // Turn 1: 2 update calls (increment + persist)
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledTimes(2);
    const turn1Increment = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(turn1Increment.data).toEqual({ replanCount: { increment: 1 } });
    const turn1Persist = prismaMock.agentWorkflow.update.mock.calls[1]?.[0] as any;
    expect(turn1Persist.data.plan.replanCount).toBe(1);

    // ---- Turn 2: simulated callback for the recovery task t-2 succeeding ----
    vi.clearAllMocks();
    const wfRecovered = buildWorkflow({
      replanCount: 1,
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
    // Turn 2: only 1 update call (no increment for task_completed)
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledTimes(1);
    const turn2Persist = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(turn2Persist.data.plan.replanCount).toBe(1); // unchanged on success path
    expect(turn2Persist.data.status).toBe('completed');
  });
});
