import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

const mockQueueAdd = vi.fn();
vi.mock('../agents/queues.js', async () => {
  const actual = await vi.importActual<typeof import('../agents/queues.js')>('../agents/queues.js');
  return {
    ...actual,
    getQueue: vi.fn(() => ({ add: mockQueueAdd })),
  };
});

vi.mock('../agents/event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { processStepperCallback } from './workflow-stepper.service.js';

const baseWorkflow = {
  id: 'wf-1',
  goal: 'Enroll',
  goalParams: {},
  status: 'active',
  priority: 'normal',
  plan: {},
  replanCount: 0,
  providerId: 'p-1',
  payerId: 'pay-1',
  enrollmentId: null,
  requestedBy: 'user-1',
  startedAt: new Date(),
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  totalTokensUsed: 0,
  totalDurationMs: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeTask(overrides: Partial<typeof baseTask> = {}) {
  const baseTask = {
    id: 't-1',
    workflowId: 'wf-1',
    type: 'check_readiness',
    agentType: 'portal_interaction',
    status: 'completed' as const,
    input: { providerId: 'p-1', payerId: 'pay-1' },
    output: null as Record<string, unknown> | null,
    error: null,
    stepNumber: 1,
    dependsOn: [],
    requiresApproval: false,
    bullmqJobId: 'bull-1',
    queue: 'agent-portal',
    attempts: 0,
    maxAttempts: 3,
    queuedAt: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    tokensUsed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...baseTask, ...overrides };
}
// Allow type-narrowing in makeTask
type baseTask = ReturnType<typeof makeTask>;

describe('processStepperCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: 'job-99' });
    prismaMock.agentTask.count.mockResolvedValue(1);
    prismaMock.agentTask.create.mockResolvedValue({ id: 't-new' } as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);
  });

  afterEach(() => {
    delete process.env['DISABLE_PORTAL_AUTOMATION'];
  });

  it('bails to LLM on task_failed events', async () => {
    const result = await processStepperCallback({
      workflowId: 'wf-1',
      taskId: 't-1',
      event: 'task_failed',
    });
    expect(result.outcome).toBe('needs_llm');
  });

  it('bails to LLM when task not found', async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue(null);
    const result = await processStepperCallback({
      workflowId: 'wf-1',
      taskId: 't-missing',
      event: 'task_completed',
    });
    expect(result.outcome).toBe('needs_llm');
    if (result.outcome === 'needs_llm') expect(result.reason).toContain('not found');
  });

  it('bails to LLM when task type has no handler', async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue(makeTask({ type: 'parse_document', output: { parsed: true } }) as any);
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);

    const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
    expect(result.outcome).toBe('needs_llm');
    if (result.outcome === 'needs_llm') expect(result.reason).toContain('no stepper handler');
  });

  describe('check_readiness completed', () => {
    it('dispatches submit_to_portal on happy path (ready=true + active adapter)', async () => {
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'check_readiness', output: { ready: true } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
      prismaMock.payerSubmissionConfig.findUnique.mockResolvedValue({ isActive: true } as any);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });

      expect(result.outcome).toBe('dispatched');
      if (result.outcome === 'dispatched') expect(result.nextTaskType).toBe('submit_to_portal');
      expect(prismaMock.agentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'submit_to_portal', queue: 'agent-portal' }),
        })
      );
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    });

    it('bails to LLM when ready=false', async () => {
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'check_readiness', output: { ready: false, missingCredentials: ['license'] } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
      expect(result.outcome).toBe('needs_llm');
      expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
    });

    it('bails to LLM when no active portal adapter', async () => {
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'check_readiness', output: { ready: true } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
      prismaMock.payerSubmissionConfig.findUnique.mockResolvedValue(null);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
      expect(result.outcome).toBe('needs_llm');
      if (result.outcome === 'needs_llm') expect(result.reason).toContain('adapter');
      expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
    });

    it('bails to LLM when DISABLE_PORTAL_AUTOMATION is set', async () => {
      process.env['DISABLE_PORTAL_AUTOMATION'] = 'true';
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'check_readiness', output: { ready: true } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
      expect(result.outcome).toBe('needs_llm');
    });
  });

  describe('submit_to_portal completed', () => {
    it('dispatches monitor_status on happy path (status=submitted)', async () => {
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'submit_to_portal', output: { status: 'submitted', confirmationNumber: 'C-123' } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
      expect(result.outcome).toBe('dispatched');
      if (result.outcome === 'dispatched') expect(result.nextTaskType).toBe('monitor_status');
      expect(prismaMock.agentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'monitor_status', queue: 'agent-monitor' }),
        })
      );
    });

    it('bails to LLM on non-happy-path status', async () => {
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'submit_to_portal', output: { status: 'rejected', reason: 'invalid_npi' } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
      expect(result.outcome).toBe('needs_llm');
      expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
    });
  });

  describe('monitor_status completed', () => {
    it('marks workflow completed when status=approved', async () => {
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'monitor_status', output: { status: 'approved', effectiveDate: '2026-06-01' } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
      prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
      expect(result.outcome).toBe('completed');
      expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wf-1' },
          data: expect.objectContaining({ status: 'completed' }),
        })
      );
    });

    it('bails to LLM when status=denied (denial triage needs reasoning)', async () => {
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'monitor_status', output: { status: 'denied', denialReason: 'incomplete' } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
      expect(result.outcome).toBe('needs_llm');
      expect(prismaMock.agentWorkflow.update).not.toHaveBeenCalled();
    });

    it('bails to LLM when status=pending', async () => {
      prismaMock.agentTask.findUnique.mockResolvedValue(
        makeTask({ type: 'monitor_status', output: { status: 'pending' } }) as any
      );
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);

      const result = await processStepperCallback({ workflowId: 'wf-1', taskId: 't-1', event: 'task_completed' });
      expect(result.outcome).toBe('needs_llm');
    });
  });
});
