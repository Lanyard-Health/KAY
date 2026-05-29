import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ManualSubmissionAdapter } from './manual-adapter.js';
import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import type { SubmissionInput } from './payer-adapter.js';

const baseInput: SubmissionInput = {
  workflowId: 'wf-1',
  taskId: 'task-1',
  providerId: 'prov-1',
  payerId: 'payer-1',
  config: {},
};

const fakeProvider = {
  id: 'prov-1',
  firstName: 'John',
  lastName: 'Doe',
  npi: '1234567890',
  licenses: [{ licenseType: 'state_medical', licenseNumber: 'LIC-001', state: 'NY', expirationDate: new Date() }],
  certifications: [],
  malpracticeInsurance: [],
};

describe('ManualSubmissionAdapter', () => {
  let adapter: ManualSubmissionAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ManualSubmissionAdapter();
  });

  describe('checkReadiness', () => {
    it('always returns ready with a warning', async () => {
      const result = await adapter.checkReadiness(baseInput);

      expect(result.ready).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/manual/i);
    });
  });

  describe('submit', () => {
    it('returns error when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValueOnce(null as never);

      const result = await adapter.submit(baseInput);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });

    it('creates PendingApproval with credential manifest', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValueOnce(fakeProvider as never);
      prismaMock.pendingApproval.create.mockResolvedValueOnce({
        id: 'approval-1',
        workflowId: 'wf-1',
        taskId: 'task-1',
        type: 'manual_submission',
        status: 'pending',
      } as never);

      const result = await adapter.submit(baseInput);

      expect(result.success).toBe(true);
      expect(result.submissionId).toBe('approval-1');
      expect(prismaMock.pendingApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workflowId: 'wf-1',
          taskId: 'task-1',
          type: 'manual_submission',
          status: 'pending',
        }),
      });
    });

    it('includes provider credentials in manifest context', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValueOnce(fakeProvider as never);
      prismaMock.pendingApproval.create.mockResolvedValueOnce({
        id: 'approval-2',
        workflowId: 'wf-1',
      } as never);

      const result = await adapter.submit(baseInput);

      expect(result.details?.['manifest']).toBeDefined();
      const manifest = result.details!['manifest'] as Record<string, unknown>;
      expect((manifest['provider'] as Record<string, unknown>)['npi']).toBe('1234567890');
    });

    it('uses custom instructions from config when provided', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValueOnce(fakeProvider as never);
      prismaMock.pendingApproval.create.mockResolvedValueOnce({
        id: 'approval-3',
        workflowId: 'wf-1',
      } as never);

      const customInput: SubmissionInput = {
        ...baseInput,
        config: { instructions: 'Fax to 555-1234' },
      };

      const result = await adapter.submit(customInput);

      expect(result.success).toBe(true);
      const manifest = result.details!['manifest'] as Record<string, unknown>;
      expect(manifest['submissionInstructions']).toBe('Fax to 555-1234');
    });
  });
});
