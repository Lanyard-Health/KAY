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

const mockAdd = vi.fn().mockResolvedValue({ id: 'job-1' });

vi.mock('./queues.js', () => ({
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

vi.mock('./event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
}));

// ==========================================
// Imports (after mocks)
// ==========================================

import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  getWorkflowEvents,
  cancelWorkflow,
} from './coordinator.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { getQueue } from './queues.js';
import { logAgentEvent } from './event-logger.js';

// ==========================================
// Fixtures
// ==========================================

const fakeWorkflow = {
  id: 'wf-1',
  goal: 'Enroll provider with payer',
  goalParams: { providerId: 'prov-1', payerId: 'payer-1' },
  status: 'planning',
  priority: 'normal',
  plan: null,
  providerId: 'prov-1',
  payerId: 'payer-1',
  enrollmentId: null,
  requestedBy: 'user-1',
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  totalTokensUsed: 0,
  totalDurationMs: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const createInput = {
  goal: 'Enroll provider with payer',
  providerId: 'prov-1',
  payerId: 'payer-1',
  requestedBy: 'user-1',
};

// ==========================================
// Tests
// ==========================================

describe('coordinator.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------
  // createWorkflow
  // ------------------------------------------

  describe('createWorkflow', () => {
    it('creates a workflow record and enqueues a plan_workflow job', async () => {
      prismaMock.agentWorkflow.count.mockResolvedValueOnce(0 as never);
      prismaMock.agentWorkflow.create.mockResolvedValueOnce(fakeWorkflow as never);

      const result = await createWorkflow(createInput);

      // Verifies workflow creation
      expect(prismaMock.agentWorkflow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          goal: 'Enroll provider with payer',
          status: 'planning',
          providerId: 'prov-1',
          payerId: 'payer-1',
          requestedBy: 'user-1',
          goalParams: expect.objectContaining({
            providerId: 'prov-1',
            payerId: 'payer-1',
          }),
        }),
      });

      // Verifies job was enqueued
      expect(getQueue).toHaveBeenCalledWith('agent-orchestrator');
      expect(mockAdd).toHaveBeenCalledWith('plan_workflow', {
        workflowId: 'wf-1',
      });

      // Verifies event was logged
      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'wf-1',
          agent: 'coordinator',
          action: 'workflow_created',
        })
      );

      expect(result).toEqual(fakeWorkflow);
    });

    it('enforces concurrent workflow limit', async () => {
      prismaMock.agentWorkflow.count.mockResolvedValueOnce(10 as never);

      await expect(createWorkflow(createInput)).rejects.toThrow(
        /concurrent workflow limit/i
      );

      expect(prismaMock.agentWorkflow.create).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('uses priority from input when provided', async () => {
      prismaMock.agentWorkflow.count.mockResolvedValueOnce(0 as never);
      prismaMock.agentWorkflow.create.mockResolvedValueOnce({
        ...fakeWorkflow,
        priority: 'high',
      } as never);

      await createWorkflow({ ...createInput, priority: 'high' });

      expect(prismaMock.agentWorkflow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priority: 'high' }),
      });
    });

    it('includes enrollmentId in goalParams when provided', async () => {
      prismaMock.agentWorkflow.count.mockResolvedValueOnce(0 as never);
      prismaMock.agentWorkflow.create.mockResolvedValueOnce(fakeWorkflow as never);

      await createWorkflow({ ...createInput, enrollmentId: 'enr-1' });

      expect(prismaMock.agentWorkflow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          enrollmentId: 'enr-1',
          goalParams: expect.objectContaining({ enrollmentId: 'enr-1' }),
        }),
      });
    });
  });

  // ------------------------------------------
  // getWorkflow
  // ------------------------------------------

  describe('getWorkflow', () => {
    it('returns workflow with tasks, approvals, provider, and payer', async () => {
      const workflowWithRelations = {
        ...fakeWorkflow,
        tasks: [],
        approvals: [],
        provider: { id: 'prov-1', firstName: 'John', lastName: 'Doe', npi: '1234567890' },
        payer: { id: 'payer-1', name: 'Aetna' },
      };
      prismaMock.agentWorkflow.findUnique.mockResolvedValueOnce(workflowWithRelations as never);

      const result = await getWorkflow('wf-1');

      expect(prismaMock.agentWorkflow.findUnique).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        include: {
          tasks: { orderBy: { stepNumber: 'asc' } },
          approvals: { orderBy: { requestedAt: 'desc' } },
          provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
          payer: { select: { id: true, name: true } },
        },
      });
      expect(result).toEqual(workflowWithRelations);
    });
  });

  // ------------------------------------------
  // listWorkflows
  // ------------------------------------------

  describe('listWorkflows', () => {
    it('returns paginated workflows with defaults', async () => {
      prismaMock.agentWorkflow.findMany.mockResolvedValueOnce([fakeWorkflow] as never);

      const result = await listWorkflows({});

      expect(prismaMock.agentWorkflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
          skip: 0,
          orderBy: { createdAt: 'desc' },
        })
      );
      expect(result).toHaveLength(1);
    });

    it('applies status and providerId filters', async () => {
      prismaMock.agentWorkflow.findMany.mockResolvedValueOnce([] as never);

      await listWorkflows({ status: 'active', providerId: 'prov-1', limit: 5, offset: 10 });

      expect(prismaMock.agentWorkflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'active', providerId: 'prov-1' },
          take: 5,
          skip: 10,
        })
      );
    });
  });

  // ------------------------------------------
  // getWorkflowEvents
  // ------------------------------------------

  describe('getWorkflowEvents', () => {
    it('returns events ordered by timestamp asc', async () => {
      const fakeEvents = [{ id: 'evt-1', workflowId: 'wf-1', timestamp: new Date() }];
      prismaMock.agentEvent.findMany.mockResolvedValueOnce(fakeEvents as never);

      const result = await getWorkflowEvents('wf-1');

      expect(prismaMock.agentEvent.findMany).toHaveBeenCalledWith({
        where: { workflowId: 'wf-1' },
        orderBy: { timestamp: 'asc' },
        take: 100,
      });
      expect(result).toEqual(fakeEvents);
    });

    it('accepts custom limit', async () => {
      prismaMock.agentEvent.findMany.mockResolvedValueOnce([] as never);

      await getWorkflowEvents('wf-1', 50);

      expect(prismaMock.agentEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });
  });

  // ------------------------------------------
  // cancelWorkflow
  // ------------------------------------------

  describe('cancelWorkflow', () => {
    it('updates workflow status to cancelled and cancels pending tasks', async () => {
      const cancelledWorkflow = {
        ...fakeWorkflow,
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'No longer needed',
      };
      prismaMock.agentWorkflow.update.mockResolvedValueOnce(cancelledWorkflow as never);
      prismaMock.agentTask.updateMany.mockResolvedValueOnce({ count: 2 } as never);

      const result = await cancelWorkflow('wf-1', 'No longer needed');

      expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        data: {
          status: 'cancelled',
          cancelledAt: expect.any(Date),
          cancelReason: 'No longer needed',
        },
      });

      expect(prismaMock.agentTask.updateMany).toHaveBeenCalledWith({
        where: {
          workflowId: 'wf-1',
          status: { in: ['pending', 'queued'] },
        },
        data: { status: 'cancelled' },
      });

      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'wf-1',
          agent: 'coordinator',
          action: 'workflow_cancelled',
        })
      );

      expect(result).toEqual(cancelledWorkflow);
    });
  });
});
