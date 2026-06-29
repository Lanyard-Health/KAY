import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  processOrchestratorJob,
  setAnthropicClient,
  type OrchestratorJobData,
} from './orchestrator.service.js';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../queues.js', () => ({
  getQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
  })),
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

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from '../event-logger.js';

// ==========================================
// Mock Anthropic client helper
// ==========================================

function createMockResponse(content: any[], inputTokens = 100, outputTokens = 50) {
  return {
    content,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    model: 'claude-sonnet-4-6',
    id: 'msg-test',
    type: 'message' as const,
    role: 'assistant' as const,
    stop_reason: 'end_turn' as const,
    stop_sequence: null,
  };
}

function textBlock(text: string) {
  return { type: 'text', text };
}

function toolUseBlock(id: string, name: string, input: Record<string, unknown>) {
  return { type: 'tool_use', id, name, input };
}

function createMockAnthropicClient(responses: any[]) {
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const response = responses[callIndex];
        if (!response) throw new Error(`No mock response at index ${callIndex}`);
        callIndex++;
        return response;
      }),
    },
  } as any;
}

// ==========================================
// Base workflow fixture
// ==========================================

const baseWorkflow = {
  id: 'wf-1',
  goal: 'Enroll provider with Aetna',
  goalParams: { providerId: 'p-1', payerId: 'pay-1' },
  status: 'planning',
  plan: null,
  replanCount: 0,
  providerId: 'p-1',
  payerId: 'pay-1',
  enrollmentId: null,
  priority: 'normal',
  requestedBy: 'user-1',
  totalTokensUsed: 0,
  cancelledAt: null,
  cancelReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tasks: [],
  approvals: [],
};

describe('processOrchestratorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setAnthropicClient(null);
  });

  // ========================================
  // Test 1: Initial planning flow
  // ========================================
  it('plans a workflow: calls tools then dispatches tasks', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    // Mock tool executor side effects
    prismaMock.providerProfile.findUnique.mockResolvedValue({
      id: 'p-1',
      firstName: 'Jane',
      npi: '123',
      licenses: [],
      boardCertifications: [],
      malpracticeInsurances: [],
      educations: [],
      documents: [],
      addresses: [],
      enrollments: [],
      deaRegistrations: [],
    } as any);

    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValue({
      payerId: 'pay-1',
      adapterType: 'caqh',
      submissionMethod: 'api',
      requiredFields: ['npi'],
      isActive: true,
      payer: { id: 'pay-1', name: 'Aetna' },
    } as any);

    prismaMock.agentTask.count.mockResolvedValue(0);
    prismaMock.agentTask.create.mockResolvedValue({ id: 'task-1' } as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);

    const mockClient = createMockAnthropicClient([
      // Turn 1: Claude calls get_provider_profile + check_credential_completeness
      createMockResponse([
        toolUseBlock('tu-1', 'get_provider_profile', { providerId: 'p-1' }),
        toolUseBlock('tu-2', 'check_credential_completeness', { providerId: 'p-1', payerId: 'pay-1' }),
      ]),
      // Turn 2: Claude calls dispatch_task
      createMockResponse([
        toolUseBlock('tu-3', 'dispatch_task', { type: 'check_readiness', input: { providerId: 'p-1', payerId: 'pay-1' } }),
      ]),
      // Turn 3: Claude returns final text
      createMockResponse([textBlock('Plan created. Dispatched readiness check.')]),
    ]);
    setAnthropicClient(mockClient);

    const result = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'plan_workflow',
    });

    expect(result.status).toBe('active');
    expect(result.toolCallCount).toBe(3);
    expect(result.tokensUsed).toBeGreaterThan(0);

    // Verify workflow updated with plan and active status
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wf-1' },
        data: expect.objectContaining({ status: 'active' }),
      })
    );

    // Verify event logged
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'orchestrator_turn_complete' })
    );
  });

  // ========================================
  // Test: Prompt caching — system + tools marked cacheable
  // ========================================
  it('sends system prompt and tools with cache_control markers and records cache metrics', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const createMock = vi.fn().mockResolvedValue({
      content: [textBlock('done')],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 800,
        cache_read_input_tokens: 0,
      },
      model: 'claude-sonnet-4-6',
      id: 'msg-cache',
      type: 'message' as const,
      role: 'assistant' as const,
      stop_reason: 'end_turn' as const,
      stop_sequence: null,
    });
    setAnthropicClient({ messages: { create: createMock } } as any);

    await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'plan_workflow',
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0]?.[0];

    // system must be an array containing a text block with cache_control
    expect(Array.isArray(callArgs.system)).toBe(true);
    expect(callArgs.system[0]).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    });

    // tools must have cache_control on the LAST tool (caches the whole tools array)
    const tools = callArgs.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(1);
    expect(tools[tools.length - 1]).toMatchObject({
      cache_control: { type: 'ephemeral' },
    });
    // First tool should NOT have cache_control (marker only on the last one)
    expect(tools[0].cache_control).toBeUndefined();

    // Cache metrics must be captured in the agent_event payload
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'orchestrator_turn_complete',
        data: expect.objectContaining({
          cacheCreationTokens: 800,
          cacheReadTokens: 0,
        }),
      })
    );
  });

  // ========================================
  // Test 2: Task callback — dispatch next step
  // ========================================
  it('handles task callback and dispatches next task', async () => {
    const workflowWithTask = {
      ...baseWorkflow,
      status: 'active',
      plan: { steps: [], replanCount: 0 },
      tasks: [
        { id: 't-1', type: 'check_readiness', status: 'completed', stepNumber: 1, output: { ready: true }, error: null },
      ],
    };
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(workflowWithTask as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    // Mock for get_workflow_state
    prismaMock.agentTask.count.mockResolvedValue(1);
    prismaMock.agentTask.create.mockResolvedValue({ id: 'task-2' } as any);
    prismaMock.agentTask.update.mockResolvedValue({} as any);
    // dispatch_task for submit_to_portal validates the adapter config exists
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValue({ isActive: true } as any);

    // Mock for request_human_approval (no need for PendingApproval mock if not called)
    const mockClient = createMockAnthropicClient([
      // Turn 1: get_workflow_state
      createMockResponse([
        toolUseBlock('tu-1', 'get_workflow_state', {}),
      ]),
      // Turn 2: dispatch next task
      createMockResponse([
        toolUseBlock('tu-2', 'dispatch_task', { type: 'submit_to_portal', input: { providerId: 'p-1', payerId: 'pay-1' } }),
      ]),
      // Turn 3: final
      createMockResponse([textBlock('Dispatched portal submission.')]),
    ]);
    setAnthropicClient(mockClient);

    const result = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_completed',
    });

    expect(result.status).toBe('active');
    expect(result.toolCallCount).toBe(2);
  });

  // ========================================
  // Test 3: Completion — no tool calls
  // ========================================
  it('completes workflow when Claude makes no tool calls', async () => {
    const completedWorkflow = {
      ...baseWorkflow,
      status: 'active',
      plan: { steps: [], replanCount: 1 },
      tasks: [
        { id: 't-1', type: 'submit_to_portal', status: 'completed', stepNumber: 1, output: { success: true }, error: null },
      ],
    };
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(completedWorkflow as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const mockClient = createMockAnthropicClient([
      createMockResponse([textBlock('Workflow complete. All tasks finished successfully.')]),
    ]);
    setAnthropicClient(mockClient);

    const result = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_completed',
    });

    expect(result.status).toBe('completed');
    expect(result.toolCallCount).toBe(0);
    expect(result.reasoning).toContain('complete');
  });

  // ========================================
  // Test 4: Replan limit (post-fix: post-increment cap, fails workflow)
  // ========================================
  it('fails workflow with max_replans_exceeded when post-increment count exceeds the cap', async () => {
    const workflow = {
      ...baseWorkflow,
      status: 'active',
      plan: { steps: [] },
      replanCount: 6, // post-increment value > MAX_REPLANS_PER_WORKFLOW (5)
    };
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(workflow as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const result = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'task_callback',
      taskId: 't-1',
      event: 'task_failed',
    });

    expect(result.status).toBe('failed');
    expect(result.reasoning).toBe('max_replans_exceeded');
    // First call is the atomic increment, second is the failed-status update
    const failCall = prismaMock.agentWorkflow.update.mock.calls[1]?.[0] as any;
    expect(failCall.data.status).toBe('failed');
    expect(failCall.data.plan.failureReason).toBe('max_replans_exceeded');
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'replan_limit_reached' })
    );
  });

  // ========================================
  // Test 5: Token budget exceeded
  // ========================================
  it('pauses workflow when token budget exceeded', async () => {
    const workflow = {
      ...baseWorkflow,
      totalTokensUsed: 50001,
    };
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(workflow as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    const result = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'plan_workflow',
    });

    expect(result.status).toBe('paused');
    expect(result.reasoning).toContain('Token budget');
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'token_budget_exceeded' })
    );
  });

  // ========================================
  // Test 6: Max tool calls per invocation
  // ========================================
  it('breaks loop at max tool calls', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

    // Mock provider lookup for repeated get_provider_profile calls
    prismaMock.providerProfile.findUnique.mockResolvedValue({
      id: 'p-1',
      npi: '123',
      licenses: [],
      boardCertifications: [],
      malpracticeInsurances: [],
      educations: [],
      documents: [],
      addresses: [],
      enrollments: [],
      deaRegistrations: [],
    } as any);

    // Generate 11 responses each with 2 tool calls = 22 total, should stop at 20
    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        createMockResponse([
          toolUseBlock(`tu-${i * 2}`, 'get_provider_profile', { providerId: 'p-1' }),
          toolUseBlock(`tu-${i * 2 + 1}`, 'get_provider_profile', { providerId: 'p-1' }),
        ])
      );
    }
    const mockClient = createMockAnthropicClient(responses);
    setAnthropicClient(mockClient);

    const result = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'plan_workflow',
    });

    expect(result.toolCallCount).toBe(20);
  });

  // ========================================
  // Test 7: Claude API error propagates for BullMQ retry
  // ========================================
  it('propagates Claude API errors for BullMQ retry', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);

    const mockClient = createMockAnthropicClient([]);
    mockClient.messages.create.mockRejectedValue(new Error('API rate limited'));
    setAnthropicClient(mockClient);

    await expect(
      processOrchestratorJob({ workflowId: 'wf-1', jobType: 'plan_workflow' })
    ).rejects.toThrow('API rate limited');
  });

  // ========================================
  // Test 8: Workflow not found
  // ========================================
  it('throws when workflow not found', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(null);

    await expect(
      processOrchestratorJob({ workflowId: 'bad', jobType: 'plan_workflow' })
    ).rejects.toThrow('Workflow bad not found');
  });

  // ========================================
  // Test 9: Approval request sets waiting_approval
  // ========================================
  it('sets status to waiting_approval when approval requested', async () => {
    prismaMock.agentWorkflow.findUnique.mockResolvedValue(baseWorkflow as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);
    prismaMock.pendingApproval.create.mockResolvedValue({ id: 'appr-1' } as any);

    const mockClient = createMockAnthropicClient([
      createMockResponse([
        toolUseBlock('tu-1', 'request_human_approval', {
          type: 'portal_submission',
          context: { provider: 'Jane Doe' },
        }),
      ]),
      createMockResponse([textBlock('Waiting for human approval.')]),
    ]);
    setAnthropicClient(mockClient);

    const result = await processOrchestratorJob({
      workflowId: 'wf-1',
      jobType: 'plan_workflow',
    });

    expect(result.status).toBe('waiting_approval');
  });
});
