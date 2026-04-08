import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import {
  getOrganizationTypes,
  getSpecialties,
  getSubSpecialties,
  getServices,
  getPracticeClinicalProfile,
  savePracticeClinicalProfile,
  createCustomService,
} from '../clinicalProfile.service.js';

describe('clinicalProfile.service', () => {
  // ── getOrganizationTypes ─────────────────────────────────────────
  describe('getOrganizationTypes', () => {
    it('should call prisma.organizationType.findMany with orderBy name asc', async () => {
      const mockData = [{ id: '1', name: 'Hospital' }];
      prismaMock.organizationType.findMany.mockResolvedValue(mockData as any);

      const result = await getOrganizationTypes();

      expect(prismaMock.organizationType.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(mockData);
    });
  });

  // ── getSpecialties ───────────────────────────────────────────────
  describe('getSpecialties', () => {
    it('should call with section filter when provided', async () => {
      prismaMock.specialty.findMany.mockResolvedValue([]);

      await getSpecialties('INDIVIDUAL');

      expect(prismaMock.specialty.findMany).toHaveBeenCalledWith({
        where: { isActive: true, taxonomySection: 'INDIVIDUAL' },
        orderBy: { name: 'asc' },
      });
    });

    it('should call without section filter when not provided', async () => {
      prismaMock.specialty.findMany.mockResolvedValue([]);

      await getSpecialties();

      expect(prismaMock.specialty.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    });

    it('should filter by isActive: true', async () => {
      prismaMock.specialty.findMany.mockResolvedValue([]);

      await getSpecialties();

      const call = prismaMock.specialty.findMany.mock.calls[0]![0]!;
      expect((call as any).where.isActive).toBe(true);
    });
  });

  // ── getSubSpecialties ────────────────────────────────────────────
  describe('getSubSpecialties', () => {
    it('should call with specialtyId in filter', async () => {
      prismaMock.subSpecialty.findMany.mockResolvedValue([]);

      const ids = ['id-1', 'id-2'];
      await getSubSpecialties(ids);

      expect(prismaMock.subSpecialty.findMany).toHaveBeenCalledWith({
        where: { isActive: true, specialtyId: { in: ids } },
        include: { specialty: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      });
    });
  });

  // ── getServices ──────────────────────────────────────────────────
  describe('getServices', () => {
    it('should call serviceCategory.findMany with include serviceOfferings', async () => {
      prismaMock.serviceCategory.findMany.mockResolvedValue([]);

      await getServices();

      expect(prismaMock.serviceCategory.findMany).toHaveBeenCalledWith({
        include: {
          serviceOfferings: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: [{ domain: 'asc' }, { name: 'asc' }],
      });
    });
  });

  // ── getPracticeClinicalProfile ───────────────────────────────────
  describe('getPracticeClinicalProfile', () => {
    it('should call practice.findUnique with all includes', async () => {
      const mockProfile = { organizationTypeId: 'org-1' };
      prismaMock.practice.findUnique.mockResolvedValue(mockProfile as any);

      const result = await getPracticeClinicalProfile('practice-1');

      expect(prismaMock.practice.findUnique).toHaveBeenCalledWith({
        where: { id: 'practice-1' },
        select: expect.objectContaining({
          organizationTypeId: true,
          organizationTypeRef: true,
          practiceSpecialties: expect.any(Object),
          practiceSubSpecialties: expect.any(Object),
          practiceServices: expect.any(Object),
          practiceAgeGroups: expect.any(Object),
          practiceGenderIdentities: expect.any(Object),
          practiceSexualOrientations: expect.any(Object),
          practiceSpecialPopulations: expect.any(Object),
          customServices: true,
        }),
      });
      expect(result).toEqual(mockProfile);
    });

    it('should return null if practice not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const result = await getPracticeClinicalProfile('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── savePracticeClinicalProfile ──────────────────────────────────
  describe('savePracticeClinicalProfile', () => {
    const practiceId = 'practice-1';
    const baseInput = {
      organizationTypeId: 'org-type-1',
      specialtyIds: ['sp-1'],
      subSpecialtyIds: [],
      serviceOfferingIds: [],
      customServices: [],
      patientAgeGroupIds: [],
      patientGenderIdentityIds: [],
      patientSexualOrientationIds: [],
      specialPopulationIds: [],
    };

    let txMock: Record<string, any>;

    beforeEach(() => {
      txMock = {
        practice: { update: vi.fn().mockResolvedValue({}) },
        practiceSpecialty: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        practiceSubSpecialty: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        practiceService: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        practiceAgeGroup: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        practiceGenderIdentity: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        practiceSexualOrientation: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        practiceSpecialPopulation: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        customService: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
      };

      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(txMock));
    });

    it('should call $transaction', async () => {
      await savePracticeClinicalProfile(practiceId, baseInput);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it('should delete all existing join rows first', async () => {
      await savePracticeClinicalProfile(practiceId, baseInput);

      expect(txMock.practiceSpecialty.deleteMany).toHaveBeenCalledWith({ where: { practiceId } });
      expect(txMock.practiceSubSpecialty.deleteMany).toHaveBeenCalledWith({ where: { practiceId } });
      expect(txMock.practiceService.deleteMany).toHaveBeenCalledWith({ where: { practiceId } });
      expect(txMock.practiceAgeGroup.deleteMany).toHaveBeenCalledWith({ where: { practiceId } });
      expect(txMock.practiceGenderIdentity.deleteMany).toHaveBeenCalledWith({ where: { practiceId } });
      expect(txMock.practiceSexualOrientation.deleteMany).toHaveBeenCalledWith({ where: { practiceId } });
      expect(txMock.practiceSpecialPopulation.deleteMany).toHaveBeenCalledWith({ where: { practiceId } });
    });

    it('should create new join rows for non-empty arrays', async () => {
      const input = {
        ...baseInput,
        specialtyIds: ['sp-1', 'sp-2'],
        subSpecialtyIds: ['sub-1'],
      };

      await savePracticeClinicalProfile(practiceId, input);

      expect(txMock.practiceSpecialty.createMany).toHaveBeenCalledWith({
        data: [
          { practiceId, specialtyId: 'sp-1' },
          { practiceId, specialtyId: 'sp-2' },
        ],
      });
      expect(txMock.practiceSubSpecialty.createMany).toHaveBeenCalledWith({
        data: [{ practiceId, subSpecialtyId: 'sub-1' }],
      });
    });

    it('should skip createMany for empty arrays', async () => {
      await savePracticeClinicalProfile(practiceId, baseInput);

      // specialtyIds has ['sp-1'] so it WILL be called
      expect(txMock.practiceSpecialty.createMany).toHaveBeenCalled();
      // All others are empty
      expect(txMock.practiceSubSpecialty.createMany).not.toHaveBeenCalled();
      expect(txMock.practiceService.createMany).not.toHaveBeenCalled();
      expect(txMock.practiceAgeGroup.createMany).not.toHaveBeenCalled();
    });

    it('should NOT delete existing custom services', async () => {
      await savePracticeClinicalProfile(practiceId, baseInput);

      // There should be no deleteMany on customService
      expect(txMock.customService.findMany).not.toHaveBeenCalled();
    });

    it('should only insert new custom services that do not already exist (case-insensitive)', async () => {
      txMock.customService.findMany.mockResolvedValue([{ name: 'Existing Service' }]);

      const input = {
        ...baseInput,
        customServices: ['Existing Service', 'Brand New Service'],
      };

      await savePracticeClinicalProfile(practiceId, input);

      // Should query existing custom services
      expect(txMock.customService.findMany).toHaveBeenCalledWith({
        where: { practiceId },
        select: { name: true },
      });

      // Should NOT create the already-existing one (case-insensitive)
      expect(txMock.customService.create).toHaveBeenCalledTimes(1);
      expect(txMock.customService.create).toHaveBeenCalledWith({
        data: { name: 'Brand New Service', practiceId, status: 'PENDING_REVIEW' },
      });
    });
  });

  // ── createCustomService ──────────────────────────────────────────
  describe('createCustomService', () => {
    it('should create with PENDING_REVIEW status', async () => {
      const mockResult = { id: 'cs-1', name: 'New Service', status: 'PENDING_REVIEW' };
      prismaMock.customService.create.mockResolvedValue(mockResult as any);

      const result = await createCustomService('practice-1', 'New Service');

      expect(prismaMock.customService.create).toHaveBeenCalledWith({
        data: { name: 'New Service', practiceId: 'practice-1', status: 'PENDING_REVIEW' },
      });
      expect(result).toEqual(mockResult);
    });
  });
});
