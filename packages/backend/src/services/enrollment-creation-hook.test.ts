import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnrollmentWithPayer } from '../../tests/helpers/workflow-fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('./workflow-instantiation.service.js', () => ({
  instantiateWorkflow: vi.fn(),
}));

vi.mock('../config/workflow-mapping.js', () => ({
  resolveWorkflowType: vi.fn(),
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { instantiateWorkflow } from './workflow-instantiation.service.js';
import { resolveWorkflowType } from '../config/workflow-mapping.js';
import { onEnrollmentCreated } from './enrollment-creation-hook.js';

const mockedInstantiate = vi.mocked(instantiateWorkflow);
const mockedResolve = vi.mocked(resolveWorkflowType);

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue('medical');
  mockedInstantiate.mockResolvedValue({
    stepsCreated: 3,
    templateFound: true,
    templateId: 'tmpl-1',
    templateName: 'Aetna Medical Provider Enrollment',
    conditionsApplied: 0,
  });
  prismaMock.payerTrack.findUnique.mockResolvedValue({ stateRegion: 'Nationwide' } as any);
});

describe('onEnrollmentCreated', () => {
  describe('Path A — enrollment already has payerTrackId', () => {
    it('calls instantiateWorkflow and returns its result', async () => {
      const result = await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any);

      expect(mockedInstantiate).toHaveBeenCalledWith(
        prismaMock,
        mockEnrollmentWithPayer.id,
        mockEnrollmentWithPayer.payerTrackId,
        expect.objectContaining({
          state: 'Nationwide',
          providerType: 'lcsw',
        })
      );
      expect(result).toEqual({
        stepsCreated: 3,
        templateFound: true,
        workflowType: null,
      });
    });

    it('returns {0, false, null} when no active template exists for the PayerTrack', async () => {
      mockedInstantiate.mockResolvedValue({
        stepsCreated: 0,
        templateFound: false,
        templateId: null,
        templateName: null,
        conditionsApplied: 0,
      });

      const result = await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any);

      expect(result).toEqual({ stepsCreated: 0, templateFound: false, workflowType: null });
    });

    it('swallows errors from instantiateWorkflow and returns null result', async () => {
      mockedInstantiate.mockRejectedValue(new Error('boom'));

      const result = await onEnrollmentCreated(prismaMock, mockEnrollmentWithPayer as any);

      expect(result).toEqual({ stepsCreated: 0, templateFound: false, workflowType: null });
    });
  });

  describe('Pre-Path-A resolver — enrollment lacks payerTrackId', () => {
    // Built fresh per test — onEnrollmentCreated mutates enrollment.payerTrackId
    // in place after resolving it, so sharing a single object across tests
    // would leak state between them.
    const makeEnrollmentNoTrack = () => ({ ...mockEnrollmentWithPayer, payerTrackId: null });

    it('resolves payerTrackId from payer name + provider type and then runs Path A', async () => {
      const enrollmentNoTrack = makeEnrollmentNoTrack();
      prismaMock.payerTrack.findFirst.mockResolvedValue({ id: 'resolved-track-id' } as any);
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await onEnrollmentCreated(prismaMock, enrollmentNoTrack as any);

      expect(mockedResolve).toHaveBeenCalledWith('lcsw', 'Aetna', undefined);
      expect(prismaMock.payerTrack.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          payerName: { equals: 'Aetna', mode: 'insensitive' },
          track: 'Medical / Primary Care',
          isActive: true,
        }),
        select: { id: true },
      });
      expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentNoTrack.id },
        data: { payerTrackId: 'resolved-track-id' },
      });
      expect(mockedInstantiate).toHaveBeenCalledWith(
        prismaMock,
        enrollmentNoTrack.id,
        'resolved-track-id',
        expect.any(Object)
      );
      expect(result.templateFound).toBe(true);
    });

    it('returns null result when no matching PayerTrack is found', async () => {
      const enrollmentNoTrack = makeEnrollmentNoTrack();
      prismaMock.payerTrack.findFirst.mockResolvedValue(null);

      const result = await onEnrollmentCreated(prismaMock, enrollmentNoTrack as any);

      expect(mockedInstantiate).not.toHaveBeenCalled();
      expect(result).toEqual({ stepsCreated: 0, templateFound: false, workflowType: null });
    });

    it('uses behavioral_health track when resolveWorkflowType returns behavioral_health', async () => {
      const enrollmentNoTrack = makeEnrollmentNoTrack();
      mockedResolve.mockReturnValue('behavioral_health');
      prismaMock.payerTrack.findFirst.mockResolvedValue({ id: 'bh-track-id' } as any);
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await onEnrollmentCreated(prismaMock, enrollmentNoTrack as any);

      expect(prismaMock.payerTrack.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ track: 'Behavioral Health' }),
        select: { id: true },
      });
    });

    it('passes explicitWorkflowType through to resolveWorkflowType', async () => {
      const enrollmentNoTrack = makeEnrollmentNoTrack();
      prismaMock.payerTrack.findFirst.mockResolvedValue({ id: 'track-id' } as any);
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await onEnrollmentCreated(prismaMock, enrollmentNoTrack as any, 'behavioral_health');

      expect(mockedResolve).toHaveBeenCalledWith('lcsw', 'Aetna', 'behavioral_health');
    });

    it('fetches payer/provider from DB when relations are missing', async () => {
      const bareEnrollment = {
        id: 'enr-bare',
        providerId: 'p-1',
        payerId: 'pay-1',
        payerTrackId: null,
      } as any;
      prismaMock.payer.findUnique.mockResolvedValue({ name: 'Cigna Healthcare' } as any);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ providerType: 'psychiatrist' } as any);
      prismaMock.payerTrack.findFirst.mockResolvedValue({ id: 'cigna-med' } as any);
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await onEnrollmentCreated(prismaMock, bareEnrollment);

      expect(prismaMock.payer.findUnique).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        select: { name: true },
      });
      expect(prismaMock.providerProfile.findUnique).toHaveBeenCalledWith({
        where: { id: 'p-1' },
        select: { providerType: true },
      });
      expect(mockedResolve).toHaveBeenCalledWith('psychiatrist', 'Cigna Healthcare', undefined);
    });

    it('returns null result when payer + provider context cannot be resolved', async () => {
      const bareEnrollment = { id: 'enr-empty', providerId: 'p-1', payerId: 'pay-1', payerTrackId: null } as any;
      prismaMock.payer.findUnique.mockResolvedValue(null);
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const result = await onEnrollmentCreated(prismaMock, bareEnrollment);

      expect(prismaMock.payerTrack.findFirst).not.toHaveBeenCalled();
      expect(mockedInstantiate).not.toHaveBeenCalled();
      expect(result).toEqual({ stepsCreated: 0, templateFound: false, workflowType: null });
    });
  });
});
