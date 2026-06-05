import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { recordAgentAction, withAgentTelemetry } from './action-telemetry.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { logger } from '../utils/logger.js';

import type { Job } from 'bullmq';

interface CapturedActionCreate {
  data: {
    workflowId: string | null;
    taskId: string | null;
    providerId: string | null;
    practiceId: string | null;
    agentName: string;
    actionType: string;
    success: boolean;
    errorCategory: string | null;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    costCents: unknown;
  };
}

function makeJob(overrides: Partial<{ name: string; data: Record<string, unknown> }> = {}): Job {
  return {
    name: overrides.name ?? 'process_workflow',
    data: overrides.data ?? {},
  } as unknown as Job;
}

describe('recordAgentAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.agentAction.create.mockImplementation(async (args: unknown) => {
      const { data } = args as CapturedActionCreate;
      return data as never;
    });
  });

  it('writes all telemetry fields and converts costCents to Decimal', async () => {
    await recordAgentAction({
      workflowId: 'wf-1',
      taskId: 't-1',
      providerId: 'prov-1',
      practiceId: 'prac-1',
      agentName: 'orchestrator',
      actionType: 'plan',
      success: true,
      errorCategory: null,
      durationMs: 1234,
      inputTokens: 100,
      outputTokens: 50,
      costCents: 1.8,
    });

    expect(prismaMock.agentAction.create).toHaveBeenCalledTimes(1);
    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(args.data.workflowId).toBe('wf-1');
    expect(args.data.taskId).toBe('t-1');
    expect(args.data.providerId).toBe('prov-1');
    expect(args.data.practiceId).toBe('prac-1');
    expect(args.data.agentName).toBe('orchestrator');
    expect(args.data.actionType).toBe('plan');
    expect(args.data.success).toBe(true);
    expect(args.data.durationMs).toBe(1234);
    expect(args.data.inputTokens).toBe(100);
    expect(args.data.outputTokens).toBe(50);
    // Prisma.Decimal — toString() round-trips numeric input.
    expect(String(args.data.costCents)).toBe('1.8');
  });

  it('returns null and logs warn on insert failure (fail-soft)', async () => {
    const dbErr = new Error('connection refused');
    prismaMock.agentAction.create.mockRejectedValueOnce(dbErr as never);

    const out = await recordAgentAction({
      workflowId: 'wf-1',
      taskId: null,
      providerId: null,
      practiceId: null,
      agentName: 'document_parser',
      actionType: 'extract',
      success: true,
      errorCategory: null,
      durationMs: 100,
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
    });

    expect(out).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to record agent action — telemetry row dropped',
      expect.objectContaining({ agentName: 'document_parser' })
    );
  });
});

describe('withAgentTelemetry', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    envSnapshot = { AI_MODEL: process.env['AI_MODEL'] };
    process.env['AI_MODEL'] = 'claude-sonnet-4-20250514';
    prismaMock.agentAction.create.mockImplementation(async (args: unknown) => {
      const { data } = args as CapturedActionCreate;
      return data as never;
    });
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(null as never);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('passes through processor return value and records success row', async () => {
    const processor = vi.fn().mockResolvedValue({ status: 'ok', inputTokens: 1000, outputTokens: 500 });
    const wrapped = withAgentTelemetry('orchestrator', processor);

    const job = makeJob({ name: 'plan', data: { workflowId: 'wf-1', taskId: 't-1' } });
    const result = await wrapped(job);

    expect(result).toEqual({ status: 'ok', inputTokens: 1000, outputTokens: 500 });
    expect(processor).toHaveBeenCalledWith(job);
    expect(prismaMock.agentAction.create).toHaveBeenCalledTimes(1);

    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(args.data.agentName).toBe('orchestrator');
    expect(args.data.actionType).toBe('plan');
    expect(args.data.workflowId).toBe('wf-1');
    expect(args.data.taskId).toBe('t-1');
    expect(args.data.success).toBe(true);
    expect(args.data.errorCategory).toBeNull();
    expect(args.data.inputTokens).toBe(1000);
    expect(args.data.outputTokens).toBe(500);
    // 1000 * 0.0003 + 500 * 0.0015 = 0.3 + 0.75 = 1.05 cents
    expect(String(args.data.costCents)).toBe('1.05');
  });

  it('records failure row with errorCategory and re-throws', async () => {
    const err = new Error('upstream timeout reading payer portal');
    const processor = vi.fn().mockRejectedValue(err);
    const wrapped = withAgentTelemetry('portal_interaction', processor);

    const job = makeJob({ name: 'submit', data: { workflowId: 'wf-2' } });
    await expect(wrapped(job)).rejects.toBe(err);

    expect(prismaMock.agentAction.create).toHaveBeenCalledTimes(1);
    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(args.data.success).toBe(false);
    expect(args.data.errorCategory).toBe('timeout');
    expect(args.data.inputTokens).toBe(0);
    expect(args.data.outputTokens).toBe(0);
    expect(String(args.data.costCents)).toBe('0');
  });

  it('classifies database serialization failures', async () => {
    const err = Object.assign(new Error('could not serialize access'), { code: 'P2034' });
    const processor = vi.fn().mockRejectedValue(err);
    const wrapped = withAgentTelemetry('exception', processor);

    await expect(wrapped(makeJob({ name: 'analyze', data: {} }))).rejects.toBe(err);

    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(args.data.errorCategory).toBe('serialization_failure');
  });

  it('classifies validation errors via name=ZodError', async () => {
    const err = Object.assign(new Error('invalid input'), { name: 'ZodError' });
    const processor = vi.fn().mockRejectedValue(err);
    const wrapped = withAgentTelemetry('approval', processor);

    await expect(wrapped(makeJob())).rejects.toBe(err);

    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(args.data.errorCategory).toBe('validation_error');
  });

  it('derives providerId and practiceId from workflow lookup', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValueOnce({
      providerId: 'prov-42',
      provider: { practiceId: 'prac-7' },
    } as never);

    const processor = vi.fn().mockResolvedValue({ status: 'ok' });
    const wrapped = withAgentTelemetry('monitor', processor);

    await wrapped(makeJob({ name: 'check', data: { workflowId: 'wf-with-provider' } }));

    expect(prismaMock.agentWorkflow.findUnique).toHaveBeenCalledWith({
      where: { id: 'wf-with-provider' },
      select: {
        providerId: true,
        provider: { select: { practiceId: true } },
      },
    });

    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(args.data.providerId).toBe('prov-42');
    expect(args.data.practiceId).toBe('prac-7');
  });

  it('handles missing workflowId gracefully', async () => {
    const processor = vi.fn().mockResolvedValue({ status: 'ok' });
    const wrapped = withAgentTelemetry('document_parser', processor);

    await wrapped(makeJob({ name: 'extract', data: {} }));

    expect(prismaMock.agentWorkflow.findUnique).not.toHaveBeenCalled();
    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(args.data.workflowId).toBeNull();
    expect(args.data.providerId).toBeNull();
    expect(args.data.practiceId).toBeNull();
  });

  it('does not break processor when telemetry insert fails', async () => {
    prismaMock.agentAction.create.mockRejectedValueOnce(new Error('telemetry DB down') as never);
    const processor = vi.fn().mockResolvedValue({ status: 'ok', value: 42 });
    const wrapped = withAgentTelemetry('orchestrator', processor);

    const result = await wrapped(makeJob({ name: 'plan', data: { workflowId: 'wf-1' } }));

    expect(result).toEqual({ status: 'ok', value: 42 });
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to record agent action — telemetry row dropped',
      expect.any(Object)
    );
  });

  it('writes exactly one AgentAction row per processor invocation', async () => {
    const processor = vi.fn().mockResolvedValue({ status: 'ok' });
    const wrapped = withAgentTelemetry('approval', processor);

    await wrapped(makeJob({ name: 'review', data: { workflowId: 'wf-1' } }));
    await wrapped(makeJob({ name: 'review', data: { workflowId: 'wf-2' } }));
    await wrapped(makeJob({ name: 'review', data: { workflowId: 'wf-3' } }));

    expect(prismaMock.agentAction.create).toHaveBeenCalledTimes(3);
  });

  it('records 0 cost when AI_MODEL env var is unknown', async () => {
    process.env['AI_MODEL'] = 'claude-something-future';
    const processor = vi.fn().mockResolvedValue({ inputTokens: 1000, outputTokens: 500 });
    const wrapped = withAgentTelemetry('orchestrator', processor);

    await wrapped(makeJob({ name: 'plan' }));

    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(String(args.data.costCents)).toBe('0');
  });

  it('falls back to agentName when job.name is empty', async () => {
    const processor = vi.fn().mockResolvedValue({ status: 'ok' });
    const wrapped = withAgentTelemetry('exception', processor);

    await wrapped(makeJob({ name: '', data: {} }));

    const args = prismaMock.agentAction.create.mock.calls[0]?.[0] as CapturedActionCreate;
    expect(args.data.actionType).toBe('exception');
  });
});
