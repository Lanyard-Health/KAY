import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../agents/coordinator.service.js', () => ({
  createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-1' }),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { runAutomation } from './agent-automation.service.js';
import { createWorkflow } from '../agents/coordinator.service.js';

const mockCreateWorkflow = vi.mocked(createWorkflow);

beforeEach(() => {
  mockCreateWorkflow.mockClear();
  // Mock admin user lookup for getSystemUserId()
  prismaMock.user.findFirst.mockResolvedValue({ id: 'admin-user-1' } as any);
});

describe('agent-automation.service', () => {
  describe('overdue follow-ups', () => {
    it('creates workflow for enrollment with overdue follow-up', async () => {
      const enrollment = {
        id: 'enr-1',
        providerId: 'prov-1',
        payerId: 'payer-1',
        provider: { id: 'prov-1', firstName: 'Jane', lastName: 'Doe' },
        payer: { id: 'payer-1', name: 'Aetna' },
      };

      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([enrollment as any]);
      prismaMock.agentWorkflow.count.mockResolvedValue(0);
      // Other triggers return empty
      prismaMock.license.findMany.mockResolvedValueOnce([]);
      prismaMock.boardCertification.findMany.mockResolvedValueOnce([]);
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([]); // stale
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([]); // SLA

      const result = await runAutomation();

      expect(result.triggered).toBe(1);
      expect(mockCreateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: expect.stringContaining('follow-up'),
          providerId: 'prov-1',
          payerId: 'payer-1',
          enrollmentId: 'enr-1',
        }),
      );
    });
  });

  describe('expiring credentials', () => {
    it('creates workflow for expiring license', async () => {
      const license = {
        id: 'lic-1',
        providerId: 'prov-2',
        licenseType: 'Medical',
        provider: { id: 'prov-2', firstName: 'John', lastName: 'Smith' },
      };

      prismaMock.payerEnrollment.findMany.mockResolvedValue([]); // follow-ups, stale, SLA
      prismaMock.license.findMany.mockResolvedValueOnce([license as any]);
      prismaMock.boardCertification.findMany.mockResolvedValueOnce([]);
      prismaMock.agentWorkflow.count.mockResolvedValue(0);

      const result = await runAutomation();

      expect(result.triggered).toBe(1);
      expect(mockCreateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: expect.stringContaining('Renew expiring Medical license'),
          providerId: 'prov-2',
          priority: 'high',
        }),
      );
    });

    it('creates workflow for expiring board certification', async () => {
      const cert = {
        id: 'cert-1',
        providerId: 'prov-3',
        boardName: 'ABPN',
        provider: { id: 'prov-3', firstName: 'Alice', lastName: 'Jones' },
      };

      prismaMock.payerEnrollment.findMany.mockResolvedValue([]);
      prismaMock.license.findMany.mockResolvedValueOnce([]);
      prismaMock.boardCertification.findMany.mockResolvedValueOnce([cert as any]);
      prismaMock.agentWorkflow.count.mockResolvedValue(0);

      const result = await runAutomation();

      expect(result.triggered).toBe(1);
      expect(mockCreateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: expect.stringContaining('ABPN board certification'),
          providerId: 'prov-3',
        }),
      );
    });
  });

  describe('stale enrollments', () => {
    it('creates workflow for stale enrollment', async () => {
      const staleEnrollment = {
        id: 'enr-2',
        providerId: 'prov-4',
        payerId: 'payer-2',
        provider: { id: 'prov-4', firstName: 'Bob', lastName: 'Brown' },
        payer: { id: 'payer-2', name: 'BlueCross' },
      };

      // follow-ups empty
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([]);
      // credentials empty
      prismaMock.license.findMany.mockResolvedValueOnce([]);
      prismaMock.boardCertification.findMany.mockResolvedValueOnce([]);
      // stale enrollments
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([staleEnrollment as any]);
      // SLA empty
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([]);
      prismaMock.agentWorkflow.count.mockResolvedValue(0);

      const result = await runAutomation();

      expect(result.triggered).toBe(1);
      expect(mockCreateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: expect.stringContaining('stale BlueCross enrollment'),
          providerId: 'prov-4',
          enrollmentId: 'enr-2',
        }),
      );
    });
  });

  describe('SLA breach approaching', () => {
    it('creates urgent workflow for enrollment near SLA deadline', async () => {
      const twoDaysOut = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const enrollment = {
        id: 'enr-3',
        providerId: 'prov-5',
        payerId: 'payer-3',
        slaTargetDate: twoDaysOut,
        provider: { id: 'prov-5', firstName: 'Carol', lastName: 'White' },
        payer: { id: 'payer-3', name: 'UnitedHealth' },
      };

      // follow-ups, stale empty
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([]);
      prismaMock.license.findMany.mockResolvedValueOnce([]);
      prismaMock.boardCertification.findMany.mockResolvedValueOnce([]);
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([]); // stale
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([enrollment as any]); // SLA
      prismaMock.agentWorkflow.count.mockResolvedValue(0);

      const result = await runAutomation();

      expect(result.triggered).toBe(1);
      expect(mockCreateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: expect.stringContaining('Urgent'),
          providerId: 'prov-5',
          priority: 'urgent',
        }),
      );
    });
  });

  describe('deduplication', () => {
    it('skips when active workflow already exists', async () => {
      const enrollment = {
        id: 'enr-1',
        providerId: 'prov-1',
        payerId: 'payer-1',
        provider: { id: 'prov-1', firstName: 'Jane', lastName: 'Doe' },
        payer: { id: 'payer-1', name: 'Aetna' },
      };

      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([enrollment as any]);
      // Active workflow exists
      prismaMock.agentWorkflow.count.mockResolvedValue(1);
      // Other triggers empty
      prismaMock.license.findMany.mockResolvedValueOnce([]);
      prismaMock.boardCertification.findMany.mockResolvedValueOnce([]);
      prismaMock.malpracticeInsurance.findMany.mockResolvedValueOnce([]);
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([]); // stale
      prismaMock.payerEnrollment.findMany.mockResolvedValueOnce([]); // SLA

      const result = await runAutomation();

      expect(result.triggered).toBe(0);
      expect(result.skippedDuplicate).toBeGreaterThanOrEqual(1);
      expect(mockCreateWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('empty results', () => {
    it('returns zero counts when nothing actionable', async () => {
      prismaMock.payerEnrollment.findMany.mockResolvedValue([]);
      prismaMock.license.findMany.mockResolvedValue([]);
      prismaMock.boardCertification.findMany.mockResolvedValue([]);
      prismaMock.malpracticeInsurance.findMany.mockResolvedValue([]);

      const result = await runAutomation();

      expect(result.triggered).toBe(0);
      expect(result.skippedDuplicate).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateWorkflow).not.toHaveBeenCalled();
    });
  });
});
