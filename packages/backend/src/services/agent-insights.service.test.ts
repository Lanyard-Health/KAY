import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { collectInsights } from './agent-insights.service.js';

describe('collectInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stubQueries(rows: {
    turn?: unknown[];
    routerDecision?: unknown[];
    routerReasons?: unknown[];
    stepperOutcomes?: unknown[];
    workflowOutcomes?: unknown[];
    taskFailures?: unknown[];
  }) {
    // Each $queryRaw call returns the next array from the queue in order.
    const queue = [
      rows.turn ?? [{ count: 0n, total_tokens: 0n, total_cache_creation: 0n, total_cache_read: 0n }],
      rows.routerDecision ?? [],
      rows.routerReasons ?? [],
      rows.stepperOutcomes ?? [],
      rows.workflowOutcomes ?? [],
      rows.taskFailures ?? [],
    ];
    prismaMock.$queryRaw.mockImplementation((() => {
      const next = queue.shift();
      return Promise.resolve(next ?? []) as any;
    }) as any);
  }

  it('returns a zero snapshot when there is no activity', async () => {
    stubQueries({});
    prismaMock.agentWorkflow.findMany.mockResolvedValue([]);

    const snapshot = await collectInsights(7);

    expect(snapshot.orchestratorTurns).toBe(0);
    expect(snapshot.totalTokensUsed).toBe(0);
    expect(snapshot.cacheHitRatio).toBeNull();
    expect(snapshot.routerDecisions.stepperHandled).toBe(0);
    expect(snapshot.routerDecisions.bailedToLLM).toEqual([]);
    expect(snapshot.topExpensiveWorkflows).toEqual([]);
    expect(snapshot.window.days).toBe(7);
  });

  it('computes cache hit ratio when both reads and writes happened', async () => {
    stubQueries({
      turn: [{ count: 5n, total_tokens: 50_000n, total_cache_creation: 5_000n, total_cache_read: 45_000n }],
    });
    prismaMock.agentWorkflow.findMany.mockResolvedValue([]);

    const snapshot = await collectInsights(7);

    expect(snapshot.totalTokensUsed).toBe(50_000);
    expect(snapshot.totalCacheCreationTokens).toBe(5_000);
    expect(snapshot.totalCacheReadTokens).toBe(45_000);
    expect(snapshot.cacheHitRatio).toBeCloseTo(0.9, 5);
  });

  it('strips the "stepper bailed:" prefix from bail reasons', async () => {
    stubQueries({
      routerReasons: [
        { reason: 'stepper bailed: no active portal adapter', count: 12n },
        { reason: 'stepper bailed: ready=false', count: 7n },
      ],
    });
    prismaMock.agentWorkflow.findMany.mockResolvedValue([]);

    const snapshot = await collectInsights(7);

    expect(snapshot.routerDecisions.bailedToLLM).toEqual([
      { reason: 'no active portal adapter', count: 12 },
      { reason: 'ready=false', count: 7 },
    ]);
  });

  it('counts router decisions by route value', async () => {
    stubQueries({
      routerDecision: [
        { decision: 'stepper', count: 18n },
        { decision: 'llm', count: 4n },
      ],
    });
    prismaMock.agentWorkflow.findMany.mockResolvedValue([]);

    const snapshot = await collectInsights(7);
    expect(snapshot.routerDecisions.stepperHandled).toBe(18);
  });

  it('buckets workflow statuses correctly', async () => {
    stubQueries({
      workflowOutcomes: [
        { status: 'completed', count: 10n },
        { status: 'failed', count: 2n },
        { status: 'cancelled', count: 1n },
        { status: 'active', count: 3n },
        { status: 'planning', count: 1n },
      ],
    });
    prismaMock.agentWorkflow.findMany.mockResolvedValue([]);

    const snapshot = await collectInsights(7);

    expect(snapshot.workflowOutcomes.completed).toBe(10);
    expect(snapshot.workflowOutcomes.failed).toBe(2);
    expect(snapshot.workflowOutcomes.cancelled).toBe(1);
    expect(snapshot.workflowOutcomes.activeStillRunning).toBe(4);
  });

  it('passes through top expensive workflows', async () => {
    stubQueries({});
    prismaMock.agentWorkflow.findMany.mockResolvedValue([
      { id: 'wf-1', totalTokensUsed: 50_000, payerId: 'pay-1', providerId: 'p-1' },
      { id: 'wf-2', totalTokensUsed: 30_000, payerId: null, providerId: 'p-2' },
    ] as any);

    const snapshot = await collectInsights(7);

    expect(snapshot.topExpensiveWorkflows).toHaveLength(2);
    expect(snapshot.topExpensiveWorkflows[0]).toEqual({
      workflowId: 'wf-1',
      tokensUsed: 50_000,
      payerId: 'pay-1',
      providerId: 'p-1',
    });
  });

  it('honors the daysBack parameter', async () => {
    stubQueries({});
    prismaMock.agentWorkflow.findMany.mockResolvedValue([]);

    const snapshot = await collectInsights(30);
    expect(snapshot.window.days).toBe(30);

    const startMs = new Date(snapshot.window.start).getTime();
    const endMs = new Date(snapshot.window.end).getTime();
    const elapsedDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
    expect(elapsedDays).toBeCloseTo(30, 1);
  });
});
