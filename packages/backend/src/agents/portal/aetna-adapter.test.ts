import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AetnaPortalAdapter } from './aetna-adapter.js';
import type { SubmissionInput } from './payer-adapter.js';

// ---- Mocks ----

const prismaMock = vi.hoisted(() => ({
  payerEnrollment: {
    findUnique: vi.fn(),
  },
  agentWorkflow: {
    findUnique: vi.fn(),
  },
  aetnaEnrollmentRun: {
    create: vi.fn(),
  },
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockCheckReadiness = vi.fn();
vi.mock('../../services/aetna/readiness.service.js', () => ({
  checkAetnaReadiness: (...args: unknown[]) => mockCheckReadiness(...args),
}));

const mockStartEnrollment = vi.fn();
vi.mock('../../services/aetna/enrollment.service.js', () => ({
  startAetnaEnrollment: (...args: unknown[]) => mockStartEnrollment(...args),
}));

// ---- Tests ----

describe('AetnaPortalAdapter', () => {
  let adapter: AetnaPortalAdapter;
  const baseInput: SubmissionInput = {
    workflowId: 'wf-1',
    taskId: 'task-1',
    providerId: 'prov-1',
    payerId: 'payer-1',
    enrollmentId: 'enr-1',
    config: {},
  };

  beforeEach(() => {
    vi.resetAllMocks();
    adapter = new AetnaPortalAdapter();
  });

  describe('checkReadiness', () => {
    it('returns ready when all pages pass', async () => {
      mockCheckReadiness.mockResolvedValue({
        ready: true,
        pages: [
          { page: 2, title: 'Submitter', ready: true, missing: [] },
          { page: 3, title: 'Tax Info', ready: true, missing: [] },
        ],
      });

      const result = await adapter.checkReadiness(baseInput);
      expect(result.ready).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(mockCheckReadiness).toHaveBeenCalledWith('prov-1');
    });

    it('returns not ready with missing fields', async () => {
      mockCheckReadiness.mockResolvedValue({
        ready: false,
        pages: [
          { page: 2, title: 'Submitter', ready: true, missing: [] },
          { page: 5, title: 'Credentials', ready: false, missing: [{ field: 'npi', label: 'NPI', fixPath: '/p/1' }] },
        ],
      });

      const result = await adapter.checkReadiness(baseInput);
      expect(result.ready).toBe(false);
      expect(result.missingFields).toContain('npi');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('handles errors gracefully', async () => {
      mockCheckReadiness.mockRejectedValue(new Error('Provider not found'));

      const result = await adapter.checkReadiness(baseInput);
      expect(result.ready).toBe(false);
      expect(result.warnings).toContain('Provider not found');
    });
  });

  describe('submit', () => {
    it('fails without enrollmentId', async () => {
      const result = await adapter.submit({ ...baseInput, enrollmentId: undefined });
      expect(result.success).toBe(false);
      expect(result.error).toContain('enrollmentId is required');
    });

    it('fails when enrollment not found', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

      const result = await adapter.submit(baseInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Enrollment not found');
    });

    it('fails when enrollment belongs to different provider', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue({
        id: 'enr-1',
        providerId: 'other-provider',
      });

      const result = await adapter.submit(baseInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not belong');
    });

    it('creates run and starts form fill on success', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue({
        id: 'enr-1',
        providerId: 'prov-1',
      });
      prismaMock.agentWorkflow.findUnique.mockResolvedValue({
        requestedBy: 'user-1',
      });
      prismaMock.aetnaEnrollmentRun.create.mockResolvedValue({
        id: 'run-1',
      });
      mockStartEnrollment.mockResolvedValue(undefined);

      const result = await adapter.submit(baseInput);
      expect(result.success).toBe(true);
      expect(result.submissionId).toBe('run-1');
      expect(result.details?.status).toBe('awaiting_review');

      expect(prismaMock.aetnaEnrollmentRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payerEnrollmentId: 'enr-1',
          initiatedById: 'user-1',
          status: 'pending',
        }),
      });

      // startAetnaEnrollment is fire-and-forget, wait for microtask
      await new Promise((r) => setTimeout(r, 0));
      expect(mockStartEnrollment).toHaveBeenCalledWith('enr-1', 'run-1', 'user-1');
    });
  });
});
