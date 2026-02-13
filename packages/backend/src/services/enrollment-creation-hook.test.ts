import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnrollmentWithPayer } from '../../tests/helpers/workflow-fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('./workflow-hydration.service.js', () => ({
  hydrateWorkflowSteps: vi.fn(),
}));

vi.mock('../config/workflow-mapping.js', () => ({
  resolveWorkflowType: vi.fn(),
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { hydrateWorkflowSteps } from './workflow-hydration.service.js';
import { resolveWorkflowType } from '../config/workflow-mapping.js';
import { onEnrollmentCreated } from './enrollment-creation-hook.js';

const mockedHydrate = vi.mocked(hydrateWorkflowSteps);
const mockedResolve = vi.mocked(resolveWorkflowType);

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue('medical');
  mockedHydrate.mockResolvedValue({ stepsCreated: 3, templateFound: true });
});

describe('onEnrollmentCreated', () => {
  it('hydrates steps and updates enrollment when payer has workflowKey', async () => {
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    const result = await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any);

    expect(mockedHydrate).toHaveBeenCalledWith(
      prismaMock,
      mockEnrollmentWithPayer.id,
      'aetna',
      'medical'
    );
    expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith({
      where: { id: mockEnrollmentWithPayer.id },
      data: { workflowType: 'medical' },
    });
    expect(result.stepsCreated).toBe(3);
    expect(result.templateFound).toBe(true);
    expect(result.workflowType).toBe('medical');
  });

  it('returns {0, false, null} when payer has no workflowKey', async () => {
    const enrollment = {
      ...mockEnrollmentWithPayer,
      payer: { ...mockEnrollmentWithPayer.payer, workflowKey: null },
    };

    const result = await onEnrollmentCreated(prismaMock, enrollment as any);

    expect(result).toEqual({ stepsCreated: 0, templateFound: false, workflowType: null });
    expect(mockedHydrate).not.toHaveBeenCalled();
  });

  it('fetches full enrollment from DB when payer/provider relations missing', async () => {
    const bareEnrollment = {
      id: 'enr-bare',
      providerId: 'p-1',
      payerId: 'pay-1',
      status: 'not_started',
    } as any;

    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...bareEnrollment,
      payer: { workflowKey: 'aetna', name: 'Aetna' },
      provider: { providerType: 'lcsw' },
    } as any);
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    await onEnrollmentCreated(prismaMock, bareEnrollment);

    expect(prismaMock.payerEnrollment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'enr-bare' },
        include: expect.objectContaining({
          payer: expect.any(Object),
          provider: expect.any(Object),
        }),
      })
    );
  });

  it('returns {0, false, null} when full enrollment fetch returns null', async () => {
    const bareEnrollment = { id: 'enr-gone' } as any;
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

    const result = await onEnrollmentCreated(prismaMock, bareEnrollment);

    expect(result).toEqual({ stepsCreated: 0, templateFound: false, workflowType: null });
  });

  it('uses explicit workflowType when provided', async () => {
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any, 'behavioral_health');

    expect(mockedResolve).toHaveBeenCalledWith(
      'lcsw',
      'aetna',
      'behavioral_health'
    );
  });

  it('calls resolveWorkflowType with providerType and payerWorkflowKey', async () => {
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any);

    expect(mockedResolve).toHaveBeenCalledWith('lcsw', 'aetna', undefined);
  });

  it('does NOT update enrollment when template not found', async () => {
    mockedHydrate.mockResolvedValue({ stepsCreated: 0, templateFound: false });

    const result = await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any);

    expect(prismaMock.payerEnrollment.update).not.toHaveBeenCalled();
    expect(result.workflowType).toBeNull();
  });

  it('returns workflowType=null when template not found', async () => {
    mockedHydrate.mockResolvedValue({ stepsCreated: 0, templateFound: false });

    const result = await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any);

    expect(result).toEqual({ stepsCreated: 0, templateFound: false, workflowType: null });
  });

  it('passes through stepsCreated count from hydrateWorkflowSteps', async () => {
    mockedHydrate.mockResolvedValue({ stepsCreated: 7, templateFound: true });
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    const result = await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any);

    expect(result.stepsCreated).toBe(7);
  });

  it('handles payer.workflowKey=null in fetched relations', async () => {
    const bareEnrollment = { id: 'enr-null-key' } as any;
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...bareEnrollment,
      payer: { workflowKey: null, name: 'No Workflow Payer' },
      provider: { providerType: 'lcsw' },
    } as any);

    const result = await onEnrollmentCreated(prismaMock, bareEnrollment);

    expect(result).toEqual({ stepsCreated: 0, templateFound: false, workflowType: null });
    expect(mockedHydrate).not.toHaveBeenCalled();
  });
});
