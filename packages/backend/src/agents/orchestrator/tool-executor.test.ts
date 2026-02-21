import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall, type ToolContext } from './tool-executor.js';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
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
import { getQueue } from '../queues.js';
import { logAgentEvent } from '../event-logger.js';

const ctx: ToolContext = { workflowId: 'wf-1' };

describe('executeToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // get_provider_profile
  // ========================================
  describe('get_provider_profile', () => {
    it('returns provider with credentials', async () => {
      const mockProvider = {
        id: 'p-1',
        firstName: 'Jane',
        lastName: 'Doe',
        npi: '1234567890',
        licenses: [{ id: 'lic-1', state: 'CA', status: 'active' }],
        boardCertifications: [],
        malpracticeInsurances: [],
        educations: [],
        documents: [],
        addresses: [],
        payerEnrollments: [],
        deaRegistrations: [],
      };
      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);

      const result = await executeToolCall('get_provider_profile', { providerId: 'p-1' }, ctx);

      expect(result).toEqual(mockProvider);
      expect(prismaMock.provider.findUnique).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        include: expect.objectContaining({
          licenses: true,
          boardCertifications: true,
          malpracticeInsurances: true,
        }),
      });
    });

    it('returns error when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const result = await executeToolCall('get_provider_profile', { providerId: 'bad' }, ctx);

      expect(result).toEqual({ error: 'Provider bad not found' });
    });
  });

  // ========================================
  // get_payer_requirements
  // ========================================
  describe('get_payer_requirements', () => {
    it('returns payer adapter config', async () => {
      const mockConfig = {
        payerId: 'pay-1',
        adapterType: 'caqh_directassure',
        submissionMethod: 'api',
        requiredFields: ['npi', 'medical_license'],
        isActive: true,
        payer: { id: 'pay-1', name: 'Aetna' },
      };
      prismaMock.payerAdapterConfig.findUnique.mockResolvedValue(mockConfig as any);

      const result = await executeToolCall('get_payer_requirements', { payerId: 'pay-1' }, ctx);

      expect(result).toEqual({
        payerId: 'pay-1',
        payerName: 'Aetna',
        adapterType: 'caqh_directassure',
        submissionMethod: 'api',
        requiredFields: ['npi', 'medical_license'],
        isActive: true,
      });
    });

    it('returns error when config not found', async () => {
      prismaMock.payerAdapterConfig.findUnique.mockResolvedValue(null);

      const result = await executeToolCall('get_payer_requirements', { payerId: 'bad' }, ctx);

      expect(result).toEqual({ error: 'No adapter config found for payer bad' });
    });
  });

  // ========================================
  // check_credential_completeness
  // ========================================
  describe('check_credential_completeness', () => {
    it('returns completeness check with all fields present', async () => {
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const mockProvider = {
        npi: '1234567890',
        licenses: [{ status: 'active', expirationDate: future }],
        boardCertifications: [{ status: 'active', expirationDate: future }],
        malpracticeInsurances: [{ status: 'active', expirationDate: future }],
        educations: [{ id: 'edu-1' }],
        deaRegistrations: [{ status: 'active', expirationDate: future }],
      };
      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);

      const mockConfig = {
        requiredFields: ['npi', 'medical_license', 'board_certification', 'malpractice_insurance', 'education', 'dea_registration'],
      };
      prismaMock.payerAdapterConfig.findUnique.mockResolvedValue(mockConfig as any);

      const result = await executeToolCall(
        'check_credential_completeness',
        { providerId: 'p-1', payerId: 'pay-1' },
        ctx
      );

      expect(result).toEqual({
        complete: true,
        score: 100,
        total: 6,
        present: ['npi', 'medical_license', 'board_certification', 'malpractice_insurance', 'education', 'dea_registration'],
        missing: [],
        expired: [],
      });
    });

    it('identifies missing and expired credentials', async () => {
      const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const mockProvider = {
        npi: '1234567890',
        licenses: [{ status: 'active', expirationDate: past }], // expired
        boardCertifications: [], // missing
        malpracticeInsurances: [{ status: 'active', expirationDate: past }], // expired
        educations: [],
        deaRegistrations: [],
      };
      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);

      const mockConfig = {
        requiredFields: ['npi', 'medical_license', 'board_certification', 'malpractice_insurance'],
      };
      prismaMock.payerAdapterConfig.findUnique.mockResolvedValue(mockConfig as any);

      const result = (await executeToolCall(
        'check_credential_completeness',
        { providerId: 'p-1', payerId: 'pay-1' },
        ctx
      )) as any;

      expect(result.complete).toBe(false);
      expect(result.present).toContain('npi');
      expect(result.expired).toContain('medical_license');
      expect(result.expired).toContain('malpractice_insurance');
      expect(result.missing).toContain('board_certification');
      expect(result.score).toBe(25); // 1 out of 4
    });
  });

  // ========================================
  // dispatch_task
  // ========================================
  describe('dispatch_task', () => {
    it('creates task and enqueues to correct queue', async () => {
      prismaMock.agentTask.count.mockResolvedValue(2);
      prismaMock.agentTask.create.mockResolvedValue({ id: 'task-1' } as any);
      prismaMock.agentTask.update.mockResolvedValue({} as any);

      const result = await executeToolCall(
        'dispatch_task',
        { type: 'parse_document', input: { documentId: 'doc-1' } },
        ctx
      );

      expect(result).toEqual({ taskId: 'task-1', status: 'queued' });
      expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workflowId: 'wf-1',
          type: 'parse_document',
          agentType: 'document_parser',
          status: 'queued',
          stepNumber: 3,
          queue: 'agent-document',
        }),
      });
      expect(getQueue).toHaveBeenCalledWith('agent-document');
      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'task_dispatched' })
      );
    });

    it('rejects invalid task type', async () => {
      const result = await executeToolCall(
        'dispatch_task',
        { type: 'nonexistent_type', input: {} },
        ctx
      );

      expect(result).toEqual({
        error: expect.stringContaining('Unknown task type: nonexistent_type'),
      });
      expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
    });

    it('routes submit_to_portal to portal queue', async () => {
      prismaMock.agentTask.count.mockResolvedValue(0);
      prismaMock.agentTask.create.mockResolvedValue({ id: 'task-2' } as any);
      prismaMock.agentTask.update.mockResolvedValue({} as any);

      await executeToolCall(
        'dispatch_task',
        { type: 'submit_to_portal', input: { providerId: 'p-1', payerId: 'pay-1' } },
        ctx
      );

      expect(getQueue).toHaveBeenCalledWith('agent-portal');
    });
  });

  // ========================================
  // request_human_approval
  // ========================================
  describe('request_human_approval', () => {
    it('creates approval and pauses workflow', async () => {
      prismaMock.pendingApproval.create.mockResolvedValue({ id: 'appr-1' } as any);
      prismaMock.agentWorkflow.update.mockResolvedValue({} as any);

      const result = await executeToolCall(
        'request_human_approval',
        { type: 'portal_submission', context: { provider: 'Jane Doe', payer: 'Aetna' } },
        ctx
      );

      expect(result).toEqual({ approvalId: 'appr-1', status: 'pending' });
      expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        data: { status: 'waiting_approval' },
      });
    });
  });

  // ========================================
  // get_workflow_state
  // ========================================
  describe('get_workflow_state', () => {
    it('returns workflow with tasks and approvals', async () => {
      const mockWorkflow = {
        id: 'wf-1',
        goal: 'Enroll provider',
        goalParams: { providerId: 'p-1', payerId: 'pay-1' },
        status: 'active',
        plan: { steps: [] },
        tasks: [
          { id: 't-1', type: 'parse_document', status: 'completed', stepNumber: 1, output: {}, error: null },
        ],
        approvals: [
          { id: 'a-1', type: 'portal_submission', status: 'pending', decidedAt: null },
        ],
      };
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(mockWorkflow as any);

      const result = (await executeToolCall('get_workflow_state', {}, ctx)) as any;

      expect(result.id).toBe('wf-1');
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].type).toBe('parse_document');
      expect(result.approvals).toHaveLength(1);
    });

    it('returns error when workflow not found', async () => {
      prismaMock.agentWorkflow.findUnique.mockResolvedValue(null);

      const result = await executeToolCall('get_workflow_state', {}, ctx);

      expect(result).toEqual({ error: 'Workflow wf-1 not found' });
    });
  });

  // ========================================
  // escalate_to_exception
  // ========================================
  describe('escalate_to_exception', () => {
    it('enqueues exception and logs error event', async () => {
      const result = await executeToolCall(
        'escalate_to_exception',
        { issue: 'Provider missing critical documents', taskId: 't-1' },
        ctx
      );

      expect(result).toEqual({ status: 'escalated' });
      expect(getQueue).toHaveBeenCalledWith('agent-exception');
      expect(logAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'escalated_to_exception',
          level: 'error',
        })
      );
    });
  });

  // ========================================
  // Dispatcher
  // ========================================
  describe('dispatcher', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeToolCall('nonexistent_tool', {}, ctx);

      expect(result).toEqual({ error: 'Unknown tool: nonexistent_tool' });
    });

    it('catches exceptions and returns error object', async () => {
      prismaMock.provider.findUnique.mockRejectedValue(new Error('DB connection failed'));

      const result = await executeToolCall('get_provider_profile', { providerId: 'p-1' }, ctx);

      expect(result).toEqual({ error: 'Tool get_provider_profile failed: DB connection failed' });
    });
  });
});
