import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MonitorJobData } from './types.js';

// ==========================================
// Mocks
// ==========================================

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
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

vi.mock('../event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../websocket.js', () => ({
  emitWorkflowEvent: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { mockNotifyTaskCompletion } = vi.hoisted(() => ({
  mockNotifyTaskCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../coordinator.service.js', () => ({
  notifyTaskCompletion: mockNotifyTaskCompletion,
}));

vi.mock('./backoff.js', () => ({
  calculateMonitorDelay: vi.fn().mockReturnValue({ delayMs: 4 * 60 * 60 * 1000, isStalled: false }),
}));

// ==========================================
// Imports (after mocks)
// ==========================================

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from '../event-logger.js';
import { emitWorkflowEvent } from '../websocket.js';
import { calculateMonitorDelay } from './backoff.js';
import { processMonitorJob } from './monitor-agent.js';

// ==========================================
// Fixtures
// ==========================================

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

const baseJobData: MonitorJobData = {
  workflowId: 'wf-1',
  taskId: 'task-1',
  providerId: 'p-1',
  payerId: 'pay-1',
  submittedAt: daysAgoISO(3),
  checkCount: 0,
};

const baseTask = {
  id: 'task-1',
  workflowId: 'wf-1',
  type: 'monitor_status',
  agentType: 'monitor',
  status: 'queued',
  stepNumber: 3,
  input: {},
};

// ==========================================
// Tests
// ==========================================

describe('processMonitorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes task and notifies orchestrator when status is approved', async () => {
    const task = {
      ...baseTask,
      input: { forcedStatus: 'approved' },
    };
    prismaMock.agentTask.findUnique.mockResolvedValue(task as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);
    prismaMock.enrollment.update.mockResolvedValue({} as any);

    const result = await processMonitorJob(baseJobData);

    expect(result.status).toBe('approved');
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({ status: 'completed' }),
      })
    );
    expect(mockNotifyTaskCompletion).toHaveBeenCalledWith(
      'wf-1',
      'task-1',
      'task_completed'
    );
  });

  it('fails task with denial info and notifies orchestrator when status is denied', async () => {
    const task = {
      ...baseTask,
      input: {
        forcedStatus: 'denied',
        denialReason: 'Missing malpractice certificate',
        denialCode: 'DOC-001',
      },
    };
    prismaMock.agentTask.findUnique.mockResolvedValue(task as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);

    const result = await processMonitorJob(baseJobData);

    expect(result.status).toBe('denied');
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
    expect(mockNotifyTaskCompletion).toHaveBeenCalledWith(
      'wf-1',
      'task-1',
      'task_failed'
    );
  });

  it('schedules delayed re-check with ~4hr delay for pending status at day 3', async () => {
    const task = {
      ...baseTask,
      input: {}, // no forcedStatus → defaults to pending
    };
    prismaMock.agentTask.findUnique.mockResolvedValue(task as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);

    // Backoff mock already returns 4hr / isStalled=false by default
    const result = await processMonitorJob(baseJobData);

    expect(result.status).toBe('pending');
    expect(result.nextCheckAt).toBeDefined();

    // Should schedule a delayed re-check job
    expect(mockAdd).toHaveBeenCalledWith(
      'monitor_status',
      expect.objectContaining({
        workflowId: 'wf-1',
        taskId: 'task-1',
      }),
      expect.objectContaining({
        delay: 4 * HOUR_MS,
      })
    );

    // Should update task with nextCheckAt
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'in_progress',
        }),
      })
    );
  });

  it('logs warning event when pending status is stalled (day 31+)', async () => {
    const stalledJobData = {
      ...baseJobData,
      submittedAt: daysAgoISO(31),
      checkCount: 20,
    };
    const task = {
      ...baseTask,
      input: {}, // defaults to pending
    };
    prismaMock.agentTask.findUnique.mockResolvedValue(task as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);

    // Override backoff mock for stalled scenario
    vi.mocked(calculateMonitorDelay).mockReturnValue({
      delayMs: 48 * HOUR_MS,
      isStalled: true,
    });

    const result = await processMonitorJob(stalledJobData);

    expect(result.status).toBe('pending');
    expect(result.isStalled).toBe(true);

    // Should log a warning event about stall
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        action: expect.stringContaining('stalled'),
      })
    );
  });

  it('fails task and notifies orchestrator when status is additional_info_needed', async () => {
    const task = {
      ...baseTask,
      input: { forcedStatus: 'additional_info_needed' },
    };
    prismaMock.agentTask.findUnique.mockResolvedValue(task as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);

    const result = await processMonitorJob(baseJobData);

    expect(result.status).toBe('additional_info_needed');
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
    expect(mockNotifyTaskCompletion).toHaveBeenCalledWith(
      'wf-1',
      'task-1',
      'task_failed'
    );
  });

  it('throws error when task is not found', async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue(null);

    await expect(processMonitorJob(baseJobData)).rejects.toThrow();
  });
});
