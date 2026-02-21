import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserMessage } from './system-prompt.js';
import type { BuildUserMessageParams } from './system-prompt.js';

describe('buildSystemPrompt', () => {
  it('includes key constraint phrases', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain('credentialing workflow orchestrator');
    expect(prompt).toContain('human approval');
    expect(prompt).toContain('credential completeness');
    expect(prompt).toContain('5 replans');
    expect(prompt).toContain('escalate');
  });

  it('lists all 7 tools', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain('get_provider_profile');
    expect(prompt).toContain('get_payer_requirements');
    expect(prompt).toContain('check_credential_completeness');
    expect(prompt).toContain('dispatch_task');
    expect(prompt).toContain('request_human_approval');
    expect(prompt).toContain('get_workflow_state');
    expect(prompt).toContain('escalate_to_exception');
  });
});

describe('buildUserMessage', () => {
  const baseWorkflow = {
    id: 'wf-1',
    goal: 'Enroll provider with Aetna',
    goalParams: { providerId: 'p-1', payerId: 'pay-1' },
    status: 'planning',
    plan: null,
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
  } as unknown as BuildUserMessageParams['workflow'];

  describe('plan_workflow', () => {
    it('includes goal and provider ID', () => {
      const msg = buildUserMessage({
        jobType: 'plan_workflow',
        workflow: baseWorkflow,
      });

      expect(msg).toContain('Enroll provider with Aetna');
      expect(msg).toContain('Provider ID: p-1');
      expect(msg).toContain('Payer ID: pay-1');
    });

    it('includes enrollment ID when present', () => {
      const wf = {
        ...baseWorkflow,
        enrollmentId: 'enr-1',
        goalParams: { providerId: 'p-1', payerId: 'pay-1', enrollmentId: 'enr-1' },
      } as unknown as BuildUserMessageParams['workflow'];

      const msg = buildUserMessage({ jobType: 'plan_workflow', workflow: wf });

      expect(msg).toContain('Enrollment ID: enr-1');
    });

    it('includes instruction to analyze and dispatch', () => {
      const msg = buildUserMessage({
        jobType: 'plan_workflow',
        workflow: baseWorkflow,
      });

      expect(msg).toContain('Analyze');
      expect(msg).toContain('dispatch the first tasks');
    });
  });

  describe('task_callback', () => {
    it('includes task result and plan', () => {
      const wf = {
        ...baseWorkflow,
        status: 'active',
        plan: { steps: [{ stepNumber: 1, type: 'parse_document', status: 'completed' }] },
        tasks: [
          { id: 't-1', type: 'parse_document', status: 'completed', output: { parsed: true }, error: null },
          { id: 't-2', type: 'submit_to_portal', status: 'queued', output: null, error: null },
        ],
      } as unknown as BuildUserMessageParams['workflow'];

      const msg = buildUserMessage({
        jobType: 'task_callback',
        workflow: wf,
        callbackEvent: {
          taskId: 't-1',
          event: 'task_completed',
          result: { parsed: true },
        },
      });

      expect(msg).toContain('Task t-1 completed successfully');
      expect(msg).toContain('Result:');
      expect(msg).toContain('Completed tasks (1)');
      expect(msg).toContain('Pending tasks (1)');
      expect(msg).toContain('Failed tasks (0)');
    });

    it('handles task failure', () => {
      const wf = {
        ...baseWorkflow,
        status: 'active',
        tasks: [
          { id: 't-1', type: 'parse_document', status: 'failed', output: null, error: { message: 'timeout' } },
        ],
      } as unknown as BuildUserMessageParams['workflow'];

      const msg = buildUserMessage({
        jobType: 'task_callback',
        workflow: wf,
        callbackEvent: { taskId: 't-1', event: 'task_failed' },
      });

      expect(msg).toContain('Task t-1 failed');
      expect(msg).toContain('Failed tasks (1)');
    });
  });
});
