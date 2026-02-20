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
  dispatchPortalSubmission,
  dispatchDocumentParsing,
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
      // Mock the status check
      prismaMock.agentWorkflow.findUnique.mockResolvedValueOnce({ status: 'active' } as never);
      // Mock the $transaction
      prismaMock.$transaction.mockResolvedValueOnce([cancelledWorkflow, { count: 2 }] as never);

      const result = await cancelWorkflow('wf-1', 'No longer needed');

      expect(prismaMock.agentWorkflow.findUnique).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        select: { status: true },
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

  // ------------------------------------------
  // dispatchPortalSubmission
  // ------------------------------------------

  describe('dispatchPortalSubmission', () => {
    const fakeTask = {
      id: 'task-1',
      workflowId: 'wf-1',
      type: 'submit_to_portal',
      agentType: 'portal',
      stepNumber: 1,
      status: 'queued',
      input: { providerId: 'prov-1', payerId: 'payer-1', action: 'submit_to_portal' },
      bullmqJobId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const dispatchInput = {
      workflowId: 'wf-1',
      providerId: 'prov-1',
      payerId: 'payer-1',
    };

    it('creates a task, enqueues to portal queue, and logs an event', async () => {
      prismaMock.agentTask.create.mockResolvedValueOnce(fakeTask as never);
      prismaMock.agentTask.update.mockResolvedValueOnce({ ...fakeTask, bullmqJobId: 'job-1' } as never);

      const result = await dispatchPortalSubmission(dispatchInput);

      expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workflowId: 'wf-1',
          type: 'submit_to_portal',
          agentType: 'portal',
          status: 'queued',
        }),
      });

      expect(getQueue).toHaveBeenCalledWith('agent-portal');
      expect(mockAdd).toHaveBeenCalledWith('submit_to_portal', expect.objectContaining({
        workflowId: 'wf-1',
        taskId: 'task-1',
        providerId: 'prov-1',
        payerId: 'payer-1',
      }));

      expect(prismaMock.agentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { bullmqJobId: 'job-1' },
      });

      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'wf-1',
          taskId: 'task-1',
          agent: 'coordinator',
          action: 'portal_submission_dispatched',
        })
      );

      expect(result).toEqual(fakeTask);
    });

    it('uses check_readiness action when specified', async () => {
      prismaMock.agentTask.create.mockResolvedValueOnce({
        ...fakeTask,
        type: 'check_readiness',
      } as never);
      prismaMock.agentTask.update.mockResolvedValueOnce(fakeTask as never);

      await dispatchPortalSubmission({ ...dispatchInput, action: 'check_readiness' });

      expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'check_readiness' }),
      });

      expect(mockAdd).toHaveBeenCalledWith('check_readiness', expect.objectContaining({
        action: 'check_readiness',
      }));
    });

    it('includes enrollmentId when provided', async () => {
      prismaMock.agentTask.create.mockResolvedValueOnce(fakeTask as never);
      prismaMock.agentTask.update.mockResolvedValueOnce(fakeTask as never);

      await dispatchPortalSubmission({ ...dispatchInput, enrollmentId: 'enr-1' });

      expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          input: expect.objectContaining({ enrollmentId: 'enr-1' }),
        }),
      });

      expect(mockAdd).toHaveBeenCalledWith('submit_to_portal', expect.objectContaining({
        enrollmentId: 'enr-1',
      }));
    });
  });

  // ------------------------------------------
  // dispatchDocumentParsing
  // ------------------------------------------

  describe('dispatchDocumentParsing', () => {
    const fakeTask = {
      id: 'task-1',
      workflowId: 'wf-1',
      type: 'parse_document',
      agentType: 'document',
      stepNumber: 1,
      status: 'queued',
      input: { documentId: 'doc-1', providerId: 'prov-1', extractionHints: [] },
      bullmqJobId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const dispatchInput = {
      workflowId: 'wf-1',
      documentId: 'doc-1',
      providerId: 'prov-1',
    };

    it('creates a task, enqueues to document queue, and logs an event', async () => {
      prismaMock.agentTask.create.mockResolvedValueOnce(fakeTask as never);
      prismaMock.agentTask.update.mockResolvedValueOnce({ ...fakeTask, bullmqJobId: 'job-1' } as never);

      const result = await dispatchDocumentParsing(dispatchInput);

      expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
        data: {
          workflowId: 'wf-1',
          type: 'parse_document',
          agentType: 'document',
          stepNumber: 1,
          status: 'queued',
          input: { documentId: 'doc-1', providerId: 'prov-1', extractionHints: [] },
        },
      });

      expect(getQueue).toHaveBeenCalledWith('agent-document');
      expect(mockAdd).toHaveBeenCalledWith('parse_document', {
        workflowId: 'wf-1',
        taskId: 'task-1',
        documentId: 'doc-1',
        providerId: 'prov-1',
        extractionHints: undefined,
      });

      expect(prismaMock.agentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { bullmqJobId: 'job-1' },
      });

      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'wf-1',
          taskId: 'task-1',
          agent: 'coordinator',
          action: 'document_parsing_dispatched',
          data: { documentId: 'doc-1', taskId: 'task-1' },
        })
      );

      expect(result).toEqual(fakeTask);
    });

    it('passes extractionHints when provided', async () => {
      prismaMock.agentTask.create.mockResolvedValueOnce({
        ...fakeTask,
        input: { documentId: 'doc-1', providerId: 'prov-1', extractionHints: ['npi', 'license'] },
      } as never);
      prismaMock.agentTask.update.mockResolvedValueOnce(fakeTask as never);

      await dispatchDocumentParsing({
        ...dispatchInput,
        extractionHints: ['npi', 'license'],
      });

      expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          input: { documentId: 'doc-1', providerId: 'prov-1', extractionHints: ['npi', 'license'] },
        }),
      });

      expect(mockAdd).toHaveBeenCalledWith('parse_document', expect.objectContaining({
        extractionHints: ['npi', 'license'],
      }));
    });
  });
});
