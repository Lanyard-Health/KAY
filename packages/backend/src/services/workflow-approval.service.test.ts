import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  createStepApproval,
  createFollowUpApproval,
  resolveApproval,
} from './workflow-approval.service.js';

describe('workflow-approval.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createStepApproval', () => {
    it('creates a pending approval for a workflow step', async () => {
      prismaMock.pendingApproval.findFirst.mockResolvedValue(null);
      prismaMock.pendingApproval.create.mockResolvedValue({
        id: 'approval-1',
        enrollmentWorkflowStepId: 'step-1',
        type: 'workflow_step',
        status: 'pending',
        context: {},
        requestedAt: new Date(),
      } as any);

      const result = await createStepApproval(prismaMock as any, 'step-1', { stepName: 'Submit App' });

      expect(result.created).toBe(true);
      expect(result.approvalId).toBe('approval-1');
      expect(result.alreadyExists).toBe(false);
      expect(prismaMock.pendingApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          enrollmentWorkflowStepId: 'step-1',
          type: 'workflow_step',
          status: 'pending',
        }),
      });
    });

    it('prevents duplicate approvals for the same step', async () => {
      prismaMock.pendingApproval.findFirst.mockResolvedValue({
        id: 'existing-approval',
        status: 'pending',
      } as any);

      const result = await createStepApproval(prismaMock as any, 'step-1');

      expect(result.created).toBe(false);
      expect(result.approvalId).toBe('existing-approval');
      expect(result.alreadyExists).toBe(true);
      expect(prismaMock.pendingApproval.create).not.toHaveBeenCalled();
    });
  });

  describe('createFollowUpApproval', () => {
    it('creates a pending approval for a follow-up outreach step', async () => {
      prismaMock.pendingApproval.findFirst.mockResolvedValue(null);
      prismaMock.pendingApproval.create.mockResolvedValue({
        id: 'approval-2',
        followUpRunId: 'run-1',
        followUpStepOrder: 1,
        type: 'follow_up_outreach',
        status: 'pending',
        context: {},
        requestedAt: new Date(),
      } as any);

      const result = await createFollowUpApproval(prismaMock as any, 'run-1', 1, { channel: 'email' });

      expect(result.created).toBe(true);
      expect(result.approvalId).toBe('approval-2');
      expect(prismaMock.pendingApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          followUpRunId: 'run-1',
          followUpStepOrder: 1,
          type: 'follow_up_outreach',
          status: 'pending',
        }),
      });
    });

    it('prevents duplicate approvals for the same follow-up run + step', async () => {
      prismaMock.pendingApproval.findFirst.mockResolvedValue({
        id: 'existing-approval',
        status: 'pending',
      } as any);

      const result = await createFollowUpApproval(prismaMock as any, 'run-1', 1);

      expect(result.created).toBe(false);
      expect(result.alreadyExists).toBe(true);
      expect(prismaMock.pendingApproval.create).not.toHaveBeenCalled();
    });
  });

  describe('resolveApproval', () => {
    it('approves a pending approval', async () => {
      prismaMock.pendingApproval.findUnique.mockResolvedValue({
        id: 'approval-1',
        status: 'pending',
        type: 'workflow_step',
      } as any);
      prismaMock.pendingApproval.update.mockResolvedValue({
        id: 'approval-1',
        status: 'approved',
        type: 'workflow_step',
      } as any);

      const result = await resolveApproval(prismaMock as any, 'approval-1', 'approved', 'user-1', 'Looks good');

      expect(result.resolved).toBe(true);
      expect(result.status).toBe('approved');
      expect(prismaMock.pendingApproval.update).toHaveBeenCalledWith({
        where: { id: 'approval-1' },
        data: expect.objectContaining({
          status: 'approved',
          decidedBy: 'user-1',
          decisionNotes: 'Looks good',
        }),
      });
    });

    it('denies a pending approval', async () => {
      prismaMock.pendingApproval.findUnique.mockResolvedValue({
        id: 'approval-1',
        status: 'pending',
        type: 'follow_up_outreach',
      } as any);
      prismaMock.pendingApproval.update.mockResolvedValue({
        id: 'approval-1',
        status: 'denied',
        type: 'follow_up_outreach',
      } as any);

      const result = await resolveApproval(prismaMock as any, 'approval-1', 'denied', 'user-1');

      expect(result.resolved).toBe(true);
      expect(result.status).toBe('denied');
    });

    it('returns error when approval not found', async () => {
      prismaMock.pendingApproval.findUnique.mockResolvedValue(null);

      const result = await resolveApproval(prismaMock as any, 'nonexistent', 'approved', 'user-1');

      expect(result.resolved).toBe(false);
      expect(result.error).toBe('Approval not found');
    });

    it('returns error when approval already resolved', async () => {
      prismaMock.pendingApproval.findUnique.mockResolvedValue({
        id: 'approval-1',
        status: 'approved',
      } as any);

      const result = await resolveApproval(prismaMock as any, 'approval-1', 'denied', 'user-1');

      expect(result.resolved).toBe(false);
      expect(result.error).toBe('Approval already approved');
      expect(prismaMock.pendingApproval.update).not.toHaveBeenCalled();
    });
  });
});
