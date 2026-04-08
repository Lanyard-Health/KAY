import { prisma } from '../utils/prisma.js';
import type { TaxonomySection } from '@prisma/client';

// ── Reference data getters ──────────────────────────────────────────

export async function getOrganizationTypes() {
  return prisma.organizationType.findMany({ orderBy: { name: 'asc' } });
}

export async function getSpecialties(section?: TaxonomySection) {
  return prisma.specialty.findMany({
    where: { isActive: true, ...(section && { taxonomySection: section }) },
    orderBy: { name: 'asc' },
  });
}

export async function getSubSpecialties(specialtyIds: string[]) {
  return prisma.subSpecialty.findMany({
    where: { isActive: true, specialtyId: { in: specialtyIds } },
    include: { specialty: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function getServices() {
  return prisma.serviceCategory.findMany({
    include: {
      serviceOfferings: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: [{ domain: 'asc' }, { name: 'asc' }],
  });
}

export async function getAgeGroups() {
  return prisma.patientAgeGroup.findMany({ orderBy: { ageRangeStart: 'asc' } });
}

export async function getGenderIdentities() {
  return prisma.patientGenderIdentity.findMany({ orderBy: { name: 'asc' } });
}

export async function getSexualOrientations() {
  return prisma.patientSexualOrientation.findMany({ orderBy: { name: 'asc' } });
}

export async function getSpecialPopulations() {
  return prisma.specialPopulation.findMany({ orderBy: { name: 'asc' } });
}

// ── Practice profile CRUD ───────────────────────────────────────────

export async function getPracticeClinicalProfile(practiceId: string) {
  return prisma.practice.findUnique({
    where: { id: practiceId },
    select: {
      organizationTypeId: true,
      organizationTypeRef: true,
      practiceSpecialties: { include: { specialty: true } },
      practiceSubSpecialties: { include: { subSpecialty: true } },
      practiceServices: { include: { serviceOffering: { include: { serviceCategory: true } } } },
      practiceAgeGroups: { include: { patientAgeGroup: true } },
      practiceGenderIdentities: { include: { patientGenderIdentity: true } },
      practiceSexualOrientations: { include: { patientSexualOrientation: true } },
      practiceSpecialPopulations: { include: { specialPopulation: true } },
      customServices: true,
    },
  });
}

interface ClinicalProfileInput {
  organizationTypeId: string;
  specialtyIds: string[];
  subSpecialtyIds: string[];
  serviceOfferingIds: string[];
  customServices: string[];
  patientAgeGroupIds: string[];
  patientGenderIdentityIds: string[];
  patientSexualOrientationIds: string[];
  specialPopulationIds: string[];
}

export async function savePracticeClinicalProfile(practiceId: string, data: ClinicalProfileInput) {
  return prisma.$transaction(async (tx) => {
    // Update org type FK on Practice
    await tx.practice.update({
      where: { id: practiceId },
      data: { organizationTypeId: data.organizationTypeId },
    });

    // Delete all existing join rows (NOT custom services — they have their own lifecycle)
    await tx.practiceSpecialty.deleteMany({ where: { practiceId } });
    await tx.practiceSubSpecialty.deleteMany({ where: { practiceId } });
    await tx.practiceService.deleteMany({ where: { practiceId } });
    await tx.practiceAgeGroup.deleteMany({ where: { practiceId } });
    await tx.practiceGenderIdentity.deleteMany({ where: { practiceId } });
    await tx.practiceSexualOrientation.deleteMany({ where: { practiceId } });
    await tx.practiceSpecialPopulation.deleteMany({ where: { practiceId } });

    // Insert new join rows
    if (data.specialtyIds.length) {
      await tx.practiceSpecialty.createMany({
        data: data.specialtyIds.map((id) => ({ practiceId, specialtyId: id })),
      });
    }
    if (data.subSpecialtyIds.length) {
      await tx.practiceSubSpecialty.createMany({
        data: data.subSpecialtyIds.map((id) => ({ practiceId, subSpecialtyId: id })),
      });
    }
    if (data.serviceOfferingIds.length) {
      await tx.practiceService.createMany({
        data: data.serviceOfferingIds.map((id) => ({ practiceId, serviceOfferingId: id })),
      });
    }
    if (data.patientAgeGroupIds.length) {
      await tx.practiceAgeGroup.createMany({
        data: data.patientAgeGroupIds.map((id) => ({ practiceId, patientAgeGroupId: id })),
      });
    }
    if (data.patientGenderIdentityIds.length) {
      await tx.practiceGenderIdentity.createMany({
        data: data.patientGenderIdentityIds.map((id) => ({ practiceId, patientGenderIdentityId: id })),
      });
    }
    if (data.patientSexualOrientationIds.length) {
      await tx.practiceSexualOrientation.createMany({
        data: data.patientSexualOrientationIds.map((id) => ({ practiceId, patientSexualOrientationId: id })),
      });
    }
    if (data.specialPopulationIds.length) {
      await tx.practiceSpecialPopulation.createMany({
        data: data.specialPopulationIds.map((id) => ({ practiceId, specialPopulationId: id })),
      });
    }

    // Handle custom services — DO NOT delete existing ones.
    // Only INSERT new ones that don't already exist for this practice (case-insensitive check by name).
    if (data.customServices?.length) {
      const existing = await tx.customService.findMany({
        where: { practiceId },
        select: { name: true },
      });
      const existingNames = new Set(existing.map((cs) => cs.name.toLowerCase()));
      for (const name of data.customServices) {
        if (!existingNames.has(name.toLowerCase())) {
          await tx.customService.create({
            data: { name, practiceId, status: 'PENDING_REVIEW' },
          });
        }
      }
    }
  });
}

export async function createCustomService(practiceId: string, name: string) {
  return prisma.customService.create({
    data: { name, practiceId, status: 'PENDING_REVIEW' },
  });
}
