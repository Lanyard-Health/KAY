import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApprovalJobData } from './types.js';

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

const { mockNotifyTaskCompletion } = vi.hoisted(() => ({
  mockNotifyTaskCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../coordinator.service.js', () => ({
  notifyTaskCompletion: mockNotifyTaskCompletion,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../websocket.js', () => ({
  emitWorkflowEvent: vi.fn(),
  emitApprovalDecision: vi.fn(),
}));

// ==========================================
// Imports (after mocks)
// ==========================================

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from '../event-logger.js';
import { emitApprovalDecision } from '../websocket.js';
import { processApprovalJob } from './approval-agent.js';

// ==========================================
// Fixtures
// ==========================================

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

const futureDate = new Date(Date.now() + FORTY_EIGHT_HOURS_MS).toISOString();
const pastDate = new Date(Date.now() - 1000).toISOString();

const baseJobData: ApprovalJobData = {
  approvalId: 'appr-1',
  workflowId: 'wf-1',
  taskId: 'task-1',
  type: 'enrollment_submission',
  expiresAt: futureDate,
};

const pendingApproval = {
  id: 'appr-1',
  workflowId: 'wf-1',
  taskId: 'task-1',
  type: 'enrollment_submission',
  status: 'pending',
  expiresAt: new Date(futureDate),
};

// ==========================================
// Tests
// ==========================================

describe('processApprovalJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schedules delayed expiry-check job based on expiresAt', async () => {
    prismaMock.pendingApproval.findUnique.mockResolvedValue(pendingApproval as any);

    const result = await processApprovalJob(baseJobData);

    expect(result).toEqual({ approvalId: 'appr-1', action: 'scheduled_expiry' });

    // Verify queue.add called with correct parameters
    expect(mockAdd).toHaveBeenCalledWith(
      'check_expiry',
      {
        approvalId: 'appr-1',
        workflowId: 'wf-1',
        taskId: 'task-1',
        type: 'enrollment_submission',
        expiresAt: futureDate,
      },
      expect.objectContaining({
        jobId: 'expiry-appr-1',
      })
    );

    // Verify the delay is approximately 48h (within 5s tolerance)
    const addCall = mockAdd.mock.calls[0]!;
    const delay = addCall[2].delay as number;
    expect(delay).toBeGreaterThan(FORTY_EIGHT_HOURS_MS - 5000);
    expect(delay).toBeLessThanOrEqual(FORTY_EIGHT_HOURS_MS);
  });

  it('auto-denies expired pending approval', async () => {
    const expiredJobData: ApprovalJobData = { ...baseJobData, expiresAt: pastDate };
    const expiredApproval = { ...pendingApproval, expiresAt: new Date(pastDate) };

    prismaMock.pendingApproval.findUnique.mockResolvedValue(expiredApproval as any);
    prismaMock.pendingApproval.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);
    prismaMock.agentTask.updateMany.mockResolvedValue({ count: 2 } as any);

    const result = await processApprovalJob(expiredJobData);

    expect(result).toEqual({ approvalId: 'appr-1', action: 'auto_denied' });

    // Verify PendingApproval updated to denied with race guard
    expect(prismaMock.pendingApproval.updateMany).toHaveBeenCalledWith({
      where: { id: 'appr-1', status: 'pending' },
      data: expect.objectContaining({
        status: 'denied',
        decidedAt: expect.any(Date),
        decisionNotes: 'Auto-denied: approval expired after 48h without decision',
      }),
    });

    // Verify workflow failed
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith({
      where: { id: 'wf-1' },
      data: { status: 'failed' },
    });

    // Verify pending+queued tasks cancelled
    expect(prismaMock.agentTask.updateMany).toHaveBeenCalledWith({
      where: { workflowId: 'wf-1', status: { in: ['pending', 'queued'] } },
      data: { status: 'cancelled' },
    });

    // Verify notifyTaskCompletion called
    expect(mockNotifyTaskCompletion).toHaveBeenCalledWith('wf-1', 'task-1', 'task_failed');

    // Verify WebSocket emit
    expect(emitApprovalDecision).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      workflowId: 'wf-1',
      decision: 'expired',
    });
  });

  it('skips already-decided approvals', async () => {
    const decidedApproval = { ...pendingApproval, status: 'approved' };
    prismaMock.pendingApproval.findUnique.mockResolvedValue(decidedApproval as any);

    const result = await processApprovalJob(baseJobData);

    expect(result).toEqual({ approvalId: 'appr-1', action: 'already_decided' });

    // No updates should happen
    expect(prismaMock.pendingApproval.update).not.toHaveBeenCalled();
    expect(prismaMock.agentWorkflow.update).not.toHaveBeenCalled();
    expect(prismaMock.agentTask.updateMany).not.toHaveBeenCalled();
    expect(mockNotifyTaskCompletion).not.toHaveBeenCalled();
    expect(emitApprovalDecision).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('throws when approval not found', async () => {
    prismaMock.pendingApproval.findUnique.mockResolvedValue(null);

    await expect(processApprovalJob(baseJobData)).rejects.toThrow(
      'Approval appr-1 not found'
    );
  });

  it('logs agent event for scheduled expiry', async () => {
    prismaMock.pendingApproval.findUnique.mockResolvedValue(pendingApproval as any);

    await processApprovalJob(baseJobData);

    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        taskId: 'task-1',
        agent: 'approval',
        action: 'expiry_scheduled',
        data: expect.objectContaining({
          approvalId: 'appr-1',
          type: 'enrollment_submission',
          expiresAt: futureDate,
          delayMs: expect.any(Number),
        }),
      })
    );
  });
});
