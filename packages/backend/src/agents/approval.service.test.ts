import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==========================================
// Mocks
// ==========================================

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
}));

vi.mock('./websocket.js', () => ({
  emitApprovalRequest: vi.fn(),
  emitApprovalDecision: vi.fn(),
}));

// ==========================================
// Imports (after mocks)
// ==========================================

import {
  requestApproval,
  decideApproval,
  listPendingApprovals,
  getApproval,
} from './approval.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from './event-logger.js';
import { emitApprovalRequest, emitApprovalDecision } from './websocket.js';

// ==========================================
// Fixtures
// ==========================================

const fakeApproval = {
  id: 'appr-1',
  workflowId: 'wf-1',
  taskId: 'task-1',
  type: 'submission_review',
  status: 'pending',
  context: { summary: 'Ready to submit' },
  requestedAt: new Date(),
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  decidedBy: null,
  decidedAt: null,
  decisionNotes: null,
};

// ==========================================
// Tests
// ==========================================

describe('approval.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------
  // requestApproval
  // ------------------------------------------

  describe('requestApproval', () => {
    it('creates approval, pauses workflow, emits WebSocket event', async () => {
      prismaMock.pendingApproval.create.mockResolvedValueOnce(fakeApproval as never);
      prismaMock.agentWorkflow.update.mockResolvedValueOnce({} as never);

      const result = await requestApproval({
        workflowId: 'wf-1',
        taskId: 'task-1',
        type: 'submission_review',
        context: { summary: 'Ready to submit' },
      });

      expect(prismaMock.pendingApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workflowId: 'wf-1',
          taskId: 'task-1',
          type: 'submission_review',
          status: 'pending',
        }),
      });

      expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        data: { status: 'waiting_approval' },
      });

      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'wf-1',
          action: 'approval_requested',
        })
      );

      expect(emitApprovalRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalId: 'appr-1',
          workflowId: 'wf-1',
        })
      );

      expect(result).toEqual(fakeApproval);
    });
  });

  // ------------------------------------------
  // decideApproval — approved
  // ------------------------------------------

  describe('decideApproval', () => {
    it('approves and resumes workflow', async () => {
      const approvedRecord = {
        ...fakeApproval,
        status: 'approved',
        decidedBy: 'user-1',
        decidedAt: new Date(),
      };
      prismaMock.pendingApproval.update.mockResolvedValueOnce(approvedRecord as never);
      prismaMock.agentWorkflow.update.mockResolvedValueOnce({} as never);

      const result = await decideApproval('appr-1', {
        decision: 'approved',
        decidedBy: 'user-1',
      });

      expect(prismaMock.pendingApproval.update).toHaveBeenCalledWith({
        where: { id: 'appr-1' },
        data: expect.objectContaining({
          status: 'approved',
          decidedBy: 'user-1',
        }),
      });

      // Workflow should be resumed to active
      expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        data: { status: 'active' },
      });

      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'approval_granted',
        })
      );

      expect(emitApprovalDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'approved',
        })
      );

      expect(result).toEqual(approvedRecord);
    });

    it('denies and fails workflow, cancels pending tasks', async () => {
      const deniedRecord = {
        ...fakeApproval,
        status: 'denied',
        decidedBy: 'user-1',
        decidedAt: new Date(),
        decisionNotes: 'Not ready',
      };
      prismaMock.pendingApproval.update.mockResolvedValueOnce(deniedRecord as never);
      prismaMock.agentWorkflow.update.mockResolvedValueOnce({} as never);
      prismaMock.agentTask.updateMany.mockResolvedValueOnce({ count: 1 } as never);

      const result = await decideApproval('appr-1', {
        decision: 'denied',
        decidedBy: 'user-1',
        notes: 'Not ready',
      });

      // Workflow should be failed
      expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        data: { status: 'failed' },
      });

      // Pending tasks should be cancelled
      expect(prismaMock.agentTask.updateMany).toHaveBeenCalledWith({
        where: {
          workflowId: 'wf-1',
          status: { in: ['pending', 'queued'] },
        },
        data: { status: 'cancelled' },
      });

      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'approval_denied',
        })
      );

      expect(result).toEqual(deniedRecord);
    });
  });

  // ------------------------------------------
  // listPendingApprovals
  // ------------------------------------------

  describe('listPendingApprovals', () => {
    it('returns paginated approvals with workflow context', async () => {
      prismaMock.pendingApproval.findMany.mockResolvedValueOnce([fakeApproval] as never);

      const result = await listPendingApprovals({});

      expect(prismaMock.pendingApproval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
          skip: 0,
          orderBy: { requestedAt: 'desc' },
        })
      );
      expect(result).toHaveLength(1);
    });

    it('applies status filter', async () => {
      prismaMock.pendingApproval.findMany.mockResolvedValueOnce([] as never);

      await listPendingApprovals({ status: 'pending', limit: 5, offset: 10 });

      expect(prismaMock.pendingApproval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'pending' },
          take: 5,
          skip: 10,
        })
      );
    });
  });

  // ------------------------------------------
  // getApproval
  // ------------------------------------------

  describe('getApproval', () => {
    it('returns approval with workflow context', async () => {
      prismaMock.pendingApproval.findUnique.mockResolvedValueOnce(fakeApproval as never);

      const result = await getApproval('appr-1');

      expect(prismaMock.pendingApproval.findUnique).toHaveBeenCalledWith({
        where: { id: 'appr-1' },
        include: expect.objectContaining({
          workflow: expect.any(Object),
        }),
      });
      expect(result).toEqual(fakeApproval);
    });

    it('returns null when not found', async () => {
      prismaMock.pendingApproval.findUnique.mockResolvedValueOnce(null as never);

      const result = await getApproval('nonexistent');

      expect(result).toBeNull();
    });
  });
});
