import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
}));

vi.mock('../websocket.js', () => ({
  emitWorkflowEvent: vi.fn(),
}));

const mockCheckReadiness = vi.fn();
const mockSubmit = vi.fn();

vi.mock('./payer-adapter.js', () => ({
  getAdapter: vi.fn((type: string) => {
    if (type === 'unknown_type') return undefined;
    return {
      adapterType: type,
      checkReadiness: mockCheckReadiness,
      submit: mockSubmit,
    };
  }),
}));

import { processPortalJob } from './portal-agent.js';
import type { PortalJobData } from './portal-agent.js';
import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from '../event-logger.js';
import { emitWorkflowEvent } from '../websocket.js';

const baseJobData: PortalJobData = {
  workflowId: 'wf-1',
  taskId: 'task-1',
  providerId: 'prov-1',
  payerId: 'payer-1',
  action: 'submit_to_portal',
};

const fakeAdapterConfig = {
  id: 'cfg-1',
  payerId: 'payer-1',
  adapterType: 'caqh_directassure',
  submissionMethod: 'api',
  config: {},
  credentialsEncrypted: null,
  requiredFields: [],
  isActive: true,
  lastTestedAt: null,
  lastTestResult: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('processPortalJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.agentTask.update.mockResolvedValue({} as never);
  });

  it('marks task in-progress at start', async () => {
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValueOnce(fakeAdapterConfig as never);
    mockSubmit.mockResolvedValueOnce({ success: true, submissionId: 'sub-1' });

    await processPortalJob(baseJobData);

    expect(prismaMock.agentTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({ status: 'in_progress' }),
    });
  });

  it('fails when no adapter config found for payer', async () => {
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValueOnce(null as never);

    const result = await processPortalJob(baseJobData);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/No adapter configured/);
  });

  it('fails when adapter config is disabled', async () => {
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValueOnce({
      ...fakeAdapterConfig,
      isActive: false,
    } as never);

    const result = await processPortalJob(baseJobData);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/disabled/);
  });

  it('fails when adapter type is unknown', async () => {
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValueOnce({
      ...fakeAdapterConfig,
      adapterType: 'unknown_type',
    } as never);

    const result = await processPortalJob(baseJobData);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Unknown adapter type/);
  });

  it('handles check_readiness action', async () => {
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValueOnce(fakeAdapterConfig as never);
    mockCheckReadiness.mockResolvedValueOnce({
      ready: true,
      missingFields: [],
      warnings: [],
    });

    const result = await processPortalJob({
      ...baseJobData,
      action: 'check_readiness',
    });

    expect(result.status).toBe('completed');
    expect(mockCheckReadiness).toHaveBeenCalled();
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'readiness_checked' })
    );
  });

  it('completes submit_to_portal on success', async () => {
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValueOnce(fakeAdapterConfig as never);
    mockSubmit.mockResolvedValueOnce({
      success: true,
      submissionId: 'sub-1',
      confirmationNumber: 'CONF-123',
    });

    const result = await processPortalJob(baseJobData);

    expect(result.status).toBe('completed');
    expect(mockSubmit).toHaveBeenCalled();
    expect(prismaMock.agentTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({ status: 'completed' }),
    });
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'portal_submission_completed' })
    );
    expect(emitWorkflowEvent).toHaveBeenCalledWith(
      'wf-1',
      'agent:portal_submission_completed',
      expect.anything()
    );
  });

  it('fails submit_to_portal when adapter returns failure', async () => {
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValueOnce(fakeAdapterConfig as never);
    mockSubmit.mockResolvedValueOnce({
      success: false,
      error: 'Portal timeout',
    });

    const result = await processPortalJob(baseJobData);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Portal timeout');
  });

  it('catches thrown errors and marks task failed', async () => {
    prismaMock.payerSubmissionConfig.findUnique.mockResolvedValueOnce(fakeAdapterConfig as never);
    mockSubmit.mockRejectedValueOnce(new Error('Network error'));

    const result = await processPortalJob(baseJobData);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Network error');
    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'portal_job_failed', level: 'error' })
    );
  });
});
