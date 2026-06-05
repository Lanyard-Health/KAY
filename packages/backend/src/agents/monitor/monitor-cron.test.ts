import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==========================================
// Mocks
// ==========================================

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

const mockAdd = vi.fn().mockResolvedValue({ id: 'job-123' });

vi.mock('../queues.js', () => ({
  getQueue: vi.fn(() => ({ add: mockAdd })),
  QUEUE_NAMES: {
    ORCHESTRATOR: 'agent-orchestrator',
    DOCUMENT: 'agent-document',
    PORTAL: 'agent-portal',
    MONITOR: 'agent-monitor',
    EXCEPTION: 'agent-exception',
    APPROVAL: 'agent-approval',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ==========================================
// Imports (after mocks)
// ==========================================

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { checkOverdueMonitors } from './monitor-cron.js';

// ==========================================
// Helpers
// ==========================================

function makeOverdueTask(id: string, workflowId: string) {
  return {
    id,
    workflowId,
    type: 'monitor_status',
    agentType: 'monitor',
    status: 'in_progress',
    input: {
      providerId: 'p-1',
      payerId: 'pay-1',
      submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      nextCheckAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1hr overdue
      checkCount: 2,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    workflow: {
      id: workflowId,
      providerId: 'p-1',
      payerId: 'pay-1',
    },
  };
}

// ==========================================
// Tests
// ==========================================

describe('checkOverdueMonitors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues jobs for all overdue tasks found', async () => {
    const tasks = [
      makeOverdueTask('task-1', 'wf-1'),
      makeOverdueTask('task-2', 'wf-2'),
      makeOverdueTask('task-3', 'wf-3'),
    ];
    prismaMock.agentTask.findMany.mockResolvedValue(tasks as any);

    const count = await checkOverdueMonitors();

    expect(count).toBe(3);
    expect(mockAdd).toHaveBeenCalledTimes(3);

    // Verify each job contains correct workflowId and taskId
    expect(mockAdd).toHaveBeenCalledWith(
      'monitor_status',
      expect.objectContaining({ workflowId: 'wf-1', taskId: 'task-1' })
    );
    expect(mockAdd).toHaveBeenCalledWith(
      'monitor_status',
      expect.objectContaining({ workflowId: 'wf-2', taskId: 'task-2' })
    );
    expect(mockAdd).toHaveBeenCalledWith(
      'monitor_status',
      expect.objectContaining({ workflowId: 'wf-3', taskId: 'task-3' })
    );
  });

  it('returns 0 and enqueues nothing when no overdue tasks exist', async () => {
    prismaMock.agentTask.findMany.mockResolvedValue([]);

    const count = await checkOverdueMonitors();

    expect(count).toBe(0);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('concurrency guard prevents overlapping runs', async () => {
    // First call: takes a while to resolve
    let resolveFirst!: (value: any[]) => void;
    const slowPromise = new Promise<any[]>((resolve) => {
      resolveFirst = resolve;
    });
    prismaMock.agentTask.findMany.mockReturnValueOnce(slowPromise as any);

    // Start first call (will be pending)
    const firstCall = checkOverdueMonitors();

    // Second call should return 0 immediately due to concurrency guard
    const secondResult = await checkOverdueMonitors();
    expect(secondResult).toBe(0);

    // Resolve the first call
    resolveFirst([]);
    const firstResult = await firstCall;
    expect(firstResult).toBe(0);
  });

  it('limits to 50 tasks per run', async () => {
    // Generate 50 tasks
    const tasks = Array.from({ length: 50 }, (_, i) =>
      makeOverdueTask(`task-${i}`, `wf-${i}`)
    );
    prismaMock.agentTask.findMany.mockResolvedValue(tasks as any);

    const count = await checkOverdueMonitors();

    expect(count).toBe(50);
    expect(mockAdd).toHaveBeenCalledTimes(50);

    // Verify the Prisma query uses take: 50
    expect(prismaMock.agentTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });
});
