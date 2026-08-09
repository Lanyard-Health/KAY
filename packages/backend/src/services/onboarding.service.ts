import { prisma } from '../utils/prisma.js';
import { hasDob } from './provider-dob.service.js';

interface OnboardingStep {
  key: string;
  label: string;
  complete: boolean;
}

interface OnboardingProgress {
  percentage: number;
  steps: OnboardingStep[];
  isComplete: boolean;
}

/**
 * Compute onboarding progress for a provider.
 * Checks 5 steps: Profile, Documents, Licenses, Locations, Review.
 */
export async function computeOnboardingProgress(providerId: string): Promise<OnboardingProgress> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      dateOfBirth: true,
      dateOfBirthEncrypted: true,
      providerType: true,
      onboardingCompletedAt: true,
    },
  });

  if (!provider) {
    return { percentage: 0, steps: [], isComplete: false };
  }

  const [documentCount, licenseCount, locationCount] = await Promise.all([
    prisma.document.count({
      where: { providerId, uploadedViaPortal: true },
    }),
    prisma.license.count({
      where: { providerId },
    }),
    prisma.practiceLocation.count({
      where: { providerId },
    }),
  ]);

  const profileComplete = !!(
    provider.firstName &&
    provider.lastName &&
    provider.email &&
    provider.phone &&
    hasDob(provider) &&
    provider.providerType
  );

  const documentsComplete = documentCount > 0;
  const licensesComplete = licenseCount > 0;
  const locationsComplete = locationCount > 0;
  const reviewComplete = profileComplete && documentsComplete && licensesComplete && locationsComplete;

  const steps: OnboardingStep[] = [
    { key: 'profile', label: 'Profile', complete: profileComplete },
    { key: 'documents', label: 'Documents', complete: documentsComplete },
    { key: 'licenses', label: 'Licenses', complete: licensesComplete },
    { key: 'locations', label: 'Locations', complete: locationsComplete },
    { key: 'review', label: 'Review', complete: reviewComplete },
  ];

  const completedCount = steps.filter(s => s.complete).length;
  const percentage = Math.round((completedCount / steps.length) * 100);
  const isComplete = reviewComplete;

  // Auto-set onboardingCompletedAt when all steps are complete
  if (isComplete && !provider.onboardingCompletedAt) {
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { onboardingCompletedAt: new Date() },
    });
  }

  return { percentage, steps, isComplete };
}
