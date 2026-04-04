import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processExceptionJob, setAnthropicClient } from './exception-agent.js';
import type { ExceptionJobData } from './types.js';

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

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from '../event-logger.js';
import { emitWorkflowEvent } from '../websocket.js';

// ==========================================
// Mock Anthropic client helper
// ==========================================

function createMockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
        usage: { input_tokens: 500, output_tokens: 200 },
      }),
    },
  } as any;
}

const baseWorkflow = {
  id: 'wf-1',
  goal: 'Enroll provider',
  providerId: 'p-1',
  payerId: 'pay-1',
  totalTokensUsed: 1000,
  tasks: [],
};

const baseJobData: ExceptionJobData = {
  workflowId: 'wf-1',
  issue: 'Enrollment denied by Aetna',
  denialReason: 'Missing malpractice certificate',
  denialCode: 'DOC-001',
};

const validAnalysis = JSON.stringify({
  category: 'missing_document',
  severity: 'medium',
  rootCause: 'Provider does not have malpractice insurance on file',
  autoRemediable: false,
  steps: [{ action: 'request_document', description: 'Request malpractice certificate from provider' }],
});

describe('processExceptionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setAnthropicClient(null);
  });

  it('analyzes denial and saves structured analysis', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.provider.findUnique.mockResolvedValue({ npi: '123', licenses: [] } as any);
    prismaMock.payerAdapterConfig.findUnique.mockResolvedValue({
      adapterType: 'caqh',
      requiredFields: ['npi', 'medical_license'],
    } as any);
    prismaMock.agentTask.count.mockResolvedValue(2);
    prismaMock.agentTask.create.mockResolvedValue({ id: 'exc-1' } as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const mockClient = createMockClient(validAnalysis);
    setAnthropicClient(mockClient);

    const result = await processExceptionJob(baseJobData);

    expect(result.category).toBe('missing_document');
    expect(result.severity).toBe('medium');
    expect(result.analysis.rootCause).toContain('malpractice');

    // Should create exception task
    expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'exception_analysis',
        agentType: 'exception',
        status: 'completed',
      }),
    });

    // Should NOT re-enqueue orchestrator (autoRemediable is false)
    expect(mockAdd).not.toHaveBeenCalled();

    // Should mark workflow as failed (non-remediable)
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wf-1' },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );

    // Should emit WebSocket
    expect(emitWorkflowEvent).toHaveBeenCalledWith(
      'wf-1',
      'exception:analyzed',
      expect.objectContaining({ category: 'missing_document' })
    );
  });

  it('handles malformed Claude response gracefully', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.provider.findUnique.mockResolvedValue({ npi: '123' } as any);
    prismaMock.payerAdapterConfig.findUnique.mockResolvedValue(null);
    prismaMock.agentTask.count.mockResolvedValue(0);
    prismaMock.agentTask.create.mockResolvedValue({ id: 'exc-1' } as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const mockClient = createMockClient('This is not valid JSON at all');
    setAnthropicClient(mockClient);

    const result = await processExceptionJob(baseJobData);

    // Should use defaults
    expect(result.category).toBe('unknown_denial');
    expect(result.severity).toBe('medium');
    expect(result.analysis.autoRemediable).toBe(false);

    // Should still log event
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'exception_analyzed' })
    );

    // Should NOT re-enqueue orchestrator (malformed response defaults to non-remediable)
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('tracks tokens on workflow', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.provider.findUnique.mockResolvedValue({ npi: '123' } as any);
    prismaMock.payerAdapterConfig.findUnique.mockResolvedValue(null);
    prismaMock.agentTask.count.mockResolvedValue(0);
    prismaMock.agentTask.create.mockResolvedValue({ id: 'exc-1' } as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const mockClient = createMockClient(validAnalysis);
    setAnthropicClient(mockClient);

    await processExceptionJob(baseJobData);

    // Workflow had 1000 tokens, Claude used 700 (500 + 200)
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith({
      where: { id: 'wf-1' },
      data: { totalTokensUsed: 1700 },
    });
  });

  it('throws when workflow not found', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(null);

    await expect(processExceptionJob(baseJobData)).rejects.toThrow('Workflow wf-1 not found');
  });

  it('updates existing task when taskId provided', async () => {
    const jobWithTask = { ...baseJobData, taskId: 'task-1' };
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.agentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      error: { message: 'submission failed' },
    } as any);
    prismaMock.provider.findUnique.mockResolvedValue({ npi: '123' } as any);
    prismaMock.payerAdapterConfig.findUnique.mockResolvedValue(null);
    prismaMock.agentTask.update.mockResolvedValue({} as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const mockClient = createMockClient(validAnalysis);
    setAnthropicClient(mockClient);

    await processExceptionJob(jobWithTask);

    // Should update existing task, not create new one
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          output: expect.objectContaining({ analysis: expect.any(Object) }),
        }),
      })
    );
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });

  it('creates new task when no taskId provided', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.provider.findUnique.mockResolvedValue({ npi: '123' } as any);
    prismaMock.payerAdapterConfig.findUnique.mockResolvedValue(null);
    prismaMock.agentTask.count.mockResolvedValue(3);
    prismaMock.agentTask.create.mockResolvedValue({ id: 'exc-1' } as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const mockClient = createMockClient(validAnalysis);
    setAnthropicClient(mockClient);

    await processExceptionJob(baseJobData);

    expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stepNumber: 4,
        type: 'exception_analysis',
      }),
    });
  });

  it('caps auto-remediation at 3 attempts and forces escalation', async () => {
    const autoRemediableAnalysis = JSON.stringify({
      category: 'portal_error',
      severity: 'medium',
      rootCause: 'Portal timeout during submission',
      autoRemediable: true,
      steps: [{ action: 'retry_submission', description: 'Retry portal submission' }],
    });

    const jobWithTask: ExceptionJobData = { ...baseJobData, taskId: 'task-1' };

    // Task already has 3 remediation attempts (at the cap)
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.agentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      error: { message: 'portal timeout' },
      output: { remediationAttempts: 3 },
    } as any);
    prismaMock.provider.findUnique.mockResolvedValue({ npi: '123' } as any);
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValue(null);
    prismaMock.agentTask.update.mockResolvedValue({} as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const mockClient = createMockClient(autoRemediableAnalysis);
    setAnthropicClient(mockClient);

    const result = await processExceptionJob(jobWithTask);

    // AI said autoRemediable=true, but we should have overridden it
    expect(result.analysis.autoRemediable).toBe(false);

    // Should NOT re-enqueue orchestrator
    expect(mockAdd).not.toHaveBeenCalled();

    // Should mark workflow as failed
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wf-1' },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('allows auto-remediation when under the cap', async () => {
    const autoRemediableAnalysis = JSON.stringify({
      category: 'portal_error',
      severity: 'medium',
      rootCause: 'Portal timeout during submission',
      autoRemediable: true,
      steps: [{ action: 'retry_submission', description: 'Retry portal submission' }],
    });

    const jobWithTask: ExceptionJobData = { ...baseJobData, taskId: 'task-1' };

    // Task has 1 remediation attempt (under cap of 3)
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.agentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      error: { message: 'portal timeout' },
      output: { remediationAttempts: 1 },
    } as any);
    prismaMock.provider.findUnique.mockResolvedValue({ npi: '123' } as any);
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValue(null);
    prismaMock.agentTask.update.mockResolvedValue({} as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const mockClient = createMockClient(autoRemediableAnalysis);
    setAnthropicClient(mockClient);

    const result = await processExceptionJob(jobWithTask);

    // Should remain auto-remediable
    expect(result.analysis.autoRemediable).toBe(true);

    // Should re-enqueue orchestrator
    expect(mockAdd).toHaveBeenCalledWith('task_callback', expect.objectContaining({
      workflowId: 'wf-1',
      event: 'task_failed',
    }));

    // Should increment remediation counter on the task output
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          output: expect.objectContaining({ remediationAttempts: 2 }),
        }),
      })
    );
  });
});
