import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

import { computeOnboardingProgress } from './onboarding.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const fullProvider = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@test.com',
  phone: '555-1234',
  dateOfBirth: new Date('1985-01-01'),
  providerType: 'psychiatrist',
  onboardingCompletedAt: null,
};

describe('Onboarding Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeOnboardingProgress', () => {
    it('returns empty progress when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const result = await computeOnboardingProgress('nonexistent-id');

      expect(result).toEqual({ percentage: 0, steps: [], isComplete: false });
    });

    it('returns 20% when only profile is complete', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider as any);
      prismaMock.document.count.mockResolvedValue(0);
      prismaMock.license.count.mockResolvedValue(0);
      prismaMock.practiceLocation.count.mockResolvedValue(0);

      const result = await computeOnboardingProgress('provider-1');

      expect(result.percentage).toBe(20);
      expect(result.isComplete).toBe(false);
      expect(result.steps).toHaveLength(5);
      expect(result.steps[0]).toEqual({ key: 'profile', label: 'Profile', complete: true });
      expect(result.steps[1]).toEqual({ key: 'documents', label: 'Documents', complete: false });
      expect(result.steps[2]).toEqual({ key: 'licenses', label: 'Licenses', complete: false });
      expect(result.steps[3]).toEqual({ key: 'locations', label: 'Locations', complete: false });
      expect(result.steps[4]).toEqual({ key: 'review', label: 'Review', complete: false });
    });

    it('marks profile incomplete when fields are missing', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        ...fullProvider,
        dateOfBirth: null,
      } as any);
      prismaMock.document.count.mockResolvedValue(0);
      prismaMock.license.count.mockResolvedValue(0);
      prismaMock.practiceLocation.count.mockResolvedValue(0);

      const result = await computeOnboardingProgress('provider-1');

      expect(result.percentage).toBe(0);
      expect(result.steps[0]!.complete).toBe(false);
    });

    it('returns 60% when profile, documents, and licenses are complete', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider as any);
      prismaMock.document.count.mockResolvedValue(2);
      prismaMock.license.count.mockResolvedValue(1);
      prismaMock.practiceLocation.count.mockResolvedValue(0);

      const result = await computeOnboardingProgress('provider-1');

      expect(result.percentage).toBe(60);
      expect(result.steps[1]!.complete).toBe(true);
      expect(result.steps[2]!.complete).toBe(true);
      expect(result.steps[3]!.complete).toBe(false);
      expect(result.steps[4]!.complete).toBe(false);
    });

    it('returns 100% and marks review complete when all steps done', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider as any);
      prismaMock.document.count.mockResolvedValue(1);
      prismaMock.license.count.mockResolvedValue(1);
      prismaMock.practiceLocation.count.mockResolvedValue(1);
      prismaMock.providerProfile.update.mockResolvedValue({} as any);

      const result = await computeOnboardingProgress('provider-1');

      expect(result.percentage).toBe(100);
      expect(result.isComplete).toBe(true);
      expect(result.steps.every(s => s.complete)).toBe(true);
    });

    it('auto-sets onboardingCompletedAt when all steps complete and not yet set', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider as any);
      prismaMock.document.count.mockResolvedValue(1);
      prismaMock.license.count.mockResolvedValue(1);
      prismaMock.practiceLocation.count.mockResolvedValue(1);
      prismaMock.providerProfile.update.mockResolvedValue({} as any);

      await computeOnboardingProgress('provider-1');

      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'provider-1' },
          data: { onboardingCompletedAt: expect.any(Date) },
        })
      );
    });

    it('does not update onboardingCompletedAt if already set', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        ...fullProvider,
        onboardingCompletedAt: new Date('2026-01-01'),
      } as any);
      prismaMock.document.count.mockResolvedValue(1);
      prismaMock.license.count.mockResolvedValue(1);
      prismaMock.practiceLocation.count.mockResolvedValue(1);

      await computeOnboardingProgress('provider-1');

      expect(prismaMock.providerProfile.update).not.toHaveBeenCalled();
    });

    it('does not update onboardingCompletedAt when incomplete', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider as any);
      prismaMock.document.count.mockResolvedValue(0);
      prismaMock.license.count.mockResolvedValue(0);
      prismaMock.practiceLocation.count.mockResolvedValue(0);

      await computeOnboardingProgress('provider-1');

      expect(prismaMock.providerProfile.update).not.toHaveBeenCalled();
    });

    it('only counts portal-uploaded documents', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(fullProvider as any);
      prismaMock.document.count.mockResolvedValue(0);
      prismaMock.license.count.mockResolvedValue(0);
      prismaMock.practiceLocation.count.mockResolvedValue(0);

      await computeOnboardingProgress('provider-1');

      expect(prismaMock.document.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1', uploadedViaPortal: true },
        })
      );
    });
  });
});
