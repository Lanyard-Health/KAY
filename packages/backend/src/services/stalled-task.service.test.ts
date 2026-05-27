import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

const queueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
vi.mock('../agents/queues.js', async () => {
  const actual = await vi.importActual<typeof import('../agents/queues.js')>('../agents/queues.js');
  return {
    ...actual,
    getQueue: vi.fn(() => ({ add: queueAdd })),
  };
});

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { sweepStalledTasks } from './stalled-task.service.js';
import { QUEUE_NAMES } from '../agents/queues.js';

describe('sweepStalledTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts when no tasks are stalled', async () => {
    prismaMock.agentTask.findMany.mockResolvedValue([] as any);

    const result = await sweepStalledTasks();

    expect(result).toEqual({ scanned: 0, reenqueued: 0, failed: 0, errors: [] });
    expect(prismaMock.agentTask.update).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('re-enqueues a stalled task that still has retry budget', async () => {
    const now = new Date('2026-05-27T18:00:00Z');
    prismaMock.agentTask.findMany.mockResolvedValue([
      {
        id: 'task-1',
        workflowId: 'wf-1',
        type: 'parse_document',
        queue: QUEUE_NAMES.DOCUMENT,
        attempts: 1,
        maxAttempts: 3,
        startedAt: new Date('2026-05-27T17:00:00Z'),
        input: { documentId: 'doc-1' },
      },
    ] as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);

    const result = await sweepStalledTasks(now);

    expect(result.scanned).toBe(1);
    expect(result.reenqueued).toBe(1);
    expect(result.failed).toBe(0);
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        stalledDetectedAt: now,
        attempts: { increment: 1 },
      },
    });
    expect(queueAdd).toHaveBeenCalledWith('parse_document', {
      workflowId: 'wf-1',
      taskId: 'task-1',
      documentId: 'doc-1',
    });
  });

  it('marks a stalled task as failed when retry budget is exhausted', async () => {
    const now = new Date('2026-05-27T18:00:00Z');
    prismaMock.agentTask.findMany.mockResolvedValue([
      {
        id: 'task-2',
        workflowId: 'wf-2',
        type: 'submit_portal',
        queue: QUEUE_NAMES.PORTAL,
        attempts: 3,
        maxAttempts: 3,
        startedAt: new Date('2026-05-27T17:00:00Z'),
        input: {},
      },
    ] as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);

    const result = await sweepStalledTasks(now);

    expect(result.failed).toBe(1);
    expect(result.reenqueued).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith({
      where: { id: 'task-2' },
      data: expect.objectContaining({
        stalledDetectedAt: now,
        status: 'failed',
        completedAt: now,
        error: expect.objectContaining({
          reason: 'stalled',
          detectedBy: 'watchdog',
          attemptsExhausted: true,
        }),
      }),
    });
  });

  it('fails a stalled task with an unknown queue name (no requeue path)', async () => {
    const now = new Date('2026-05-27T18:00:00Z');
    prismaMock.agentTask.findMany.mockResolvedValue([
      {
        id: 'task-3',
        workflowId: 'wf-3',
        type: 'mystery',
        queue: 'bogus-queue',
        attempts: 1,
        maxAttempts: 3,
        startedAt: new Date('2026-05-27T17:00:00Z'),
        input: {},
      },
    ] as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);

    const result = await sweepStalledTasks(now);

    expect(result.failed).toBe(1);
    expect(result.reenqueued).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('records an error entry but continues when one task update fails', async () => {
    const now = new Date('2026-05-27T18:00:00Z');
    prismaMock.agentTask.findMany.mockResolvedValue([
      {
        id: 'task-good',
        workflowId: 'wf-g',
        type: 'parse_document',
        queue: QUEUE_NAMES.DOCUMENT,
        attempts: 0,
        maxAttempts: 3,
        startedAt: new Date('2026-05-27T17:00:00Z'),
        input: {},
      },
      {
        id: 'task-bad',
        workflowId: 'wf-b',
        type: 'parse_document',
        queue: QUEUE_NAMES.DOCUMENT,
        attempts: 0,
        maxAttempts: 3,
        startedAt: new Date('2026-05-27T17:00:00Z'),
        input: {},
      },
    ] as any);

    prismaMock.agentTask.update
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new Error('DB hiccup'));

    const result = await sweepStalledTasks(now);

    expect(result.scanned).toBe(2);
    expect(result.reenqueued).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({ taskId: 'task-bad', reason: 'DB hiccup' });
  });

  it('filters by status=in_progress and only includes tasks with null stalledDetectedAt', async () => {
    prismaMock.agentTask.findMany.mockResolvedValue([] as any);

    await sweepStalledTasks();

    expect(prismaMock.agentTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'in_progress',
          stalledDetectedAt: null,
          startedAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
  });
});
