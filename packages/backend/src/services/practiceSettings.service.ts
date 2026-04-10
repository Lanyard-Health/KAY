import { prisma } from '../utils/prisma.js';

const DEFAULTS = {
  enrollmentCap: null,
  followUpSubmissions: true,
  followUpDenialTriage: true,
  multipleLocations: false,
} as const;

export async function getOrCreateSettings(practiceId: string) {
  const existing = await prisma.practiceSettings.findUnique({
    where: { practiceId },
  });
  if (existing) return existing;

  return prisma.practiceSettings.create({
    data: { practiceId, ...DEFAULTS },
  });
}

export async function upsertSettings(
  practiceId: string,
  data: {
    enrollmentCap?: number | null;
    followUpSubmissions: boolean;
    followUpDenialTriage: boolean;
    multipleLocations: boolean;
  },
) {
  return prisma.practiceSettings.upsert({
    where: { practiceId },
    create: {
      practiceId,
      ...DEFAULTS,
      ...data,
    },
    update: data,
  });
}
