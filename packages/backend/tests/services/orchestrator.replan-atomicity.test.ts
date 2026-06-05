// Anti-regression test for the replanCount lost-update race fix.
//
// The orchestrator queue runs at concurrency=3. Two task_failed callbacks
// for the same workflow can land within ~50ms on different worker slots.
// Pre-fix: each invocation read plan.replanCount from JSON, computed n+1 in
// memory, and wrote it back — concurrent failures lost increments and let
// the workflow exceed MAX_REPLANS_PER_WORKFLOW.
//
// Post-fix: the orchestrator must issue an atomic Prisma update of the
// replanCount column with operator `{ increment: 1 }` BEFORE reading the
// workflow row. This test asserts the exact shape of that update payload —
// if a future change reverts to a read-modify-write, this test fails.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/agents/event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('../../src/agents/orchestrator/tool-executor.js', () => ({
  executeToolCall: vi.fn(),
}));

import {
  processOrchestratorJob,
  setAnthropicClient,
} from '../../src/agents/orchestrator/orchestrator.service.js';
import { prismaMock } from '../helpers/mock-prisma.js';

function buildWorkflow(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: 'wf-1',
    goal: 'credential_check',
    goalParams: { providerId: 'p-1' },
    status: 'active',
    priority: 'normal',
    plan: { steps: [] },
    replanCount: 1, // post-increment value
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
    tasks: [{ id: 't-1', status: 'failed' }],
    approvals: [],
    ...overrides,
  };
}

function fakeAnthropicClient(): any {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'noop' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAnthropicClient(null);
});

describe('Orchestrator replanCount atomic increment (anti-regression)', () => {
  it('issues an atomic { increment: 1 } update on task_failed callbacks', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(buildWorkflow() as any);
    prismaMock.agentWorkflow.update.mockResolvedValue(buildWorkflow() as any);
    setAnthropicClient(fakeAnthropicClient());

    await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_failed',
    });

    // The very first update call MUST be the atomic increment, BEFORE any
    // findUnique-based read-modify-write would have a chance to race.
    const firstCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(firstCall).toBeDefined();
    expect(firstCall.where).toEqual({ id: 'wf-1' });
    expect(firstCall.data).toEqual({ replanCount: { increment: 1 } });

    // Sanity-check: this is NOT a read-modify-write disguised as an increment.
    // The update payload has exactly one key (`replanCount`) and that key uses
    // the operator object `{ increment: 1 }` — not a literal numeric assignment.
    expect(Object.keys(firstCall.data)).toEqual(['replanCount']);
    expect(typeof firstCall.data.replanCount).toBe('object');
    expect(firstCall.data.replanCount.increment).toBe(1);
  });

  it('does NOT issue an increment update on task_completed callbacks', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(
      buildWorkflow({ tasks: [{ id: 't-1', status: 'completed' }] }) as any
    );
    prismaMock.agentWorkflow.update.mockResolvedValue(buildWorkflow() as any);
    setAnthropicClient(fakeAnthropicClient());

    await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_completed',
    });

    // Only one update call (the post-loop persist). No prior increment call.
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledTimes(1);
    const onlyCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(onlyCall.data.replanCount).toBeUndefined(); // not used as an increment
  });

  it('does NOT issue an increment update on plan_workflow jobs', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(
      buildWorkflow({ status: 'planning', tasks: [] }) as any
    );
    prismaMock.agentWorkflow.update.mockResolvedValue(buildWorkflow() as any);
    setAnthropicClient(fakeAnthropicClient());

    await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'plan_workflow',
    });

    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledTimes(1);
    const onlyCall = prismaMock.agentWorkflow.update.mock.calls[0]?.[0] as any;
    expect(onlyCall.data.replanCount).toBeUndefined();
  });
});
