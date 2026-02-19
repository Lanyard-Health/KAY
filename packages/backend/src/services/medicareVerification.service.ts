import { prisma } from '../utils/prisma.js';
import { PECOSService } from './pecos.service.js';
import { logger } from '../utils/logger.js';
import type { MedicareEnrollmentResult } from './pecos.service.js';

const pecosService = new PECOSService();

/**
 * Verify a single provider's Medicare enrollment status via PECOS/CMS
 * and persist the result to the database.
 */
export async function verifyProvider(providerId: string) {
  // 1. Look up provider NPI from DB
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { npi: true },
  });

  if (!provider) {
    throw new Error('Provider not found');
  }
  if (!provider.npi) {
    throw new Error('Provider has no NPI');
  }

  // 2. Call CMS/PECOS API
  const cmsResult: MedicareEnrollmentResult = await pecosService.lookupByNPI(provider.npi);

  // 3. Determine status and extract fields
  const status = cmsResult.found ? 'ENROLLED' : 'NOT_ENROLLED';
  const enrollments = cmsResult.enrollments ?? [];
  const uniqueStates = [...new Set(enrollments.map(e => e.state))];

  const data = {
    status: status as 'ENROLLED' | 'NOT_ENROLLED',
    verifiedAt: new Date(),
    npi: provider.npi,
    pacId: cmsResult.pacId ?? null,
    enrollmentCount: enrollments.length,
    enrollmentStates: uniqueStates,
    rawData: cmsResult as unknown as Record<string, unknown>,
  };

  // 4. Upsert verification record
  const record = await prisma.medicareVerification.upsert({
    where: { providerId },
    create: {
      providerId,
      ...data,
    },
    update: data,
  });

  logger.info(
    `Medicare verification for provider ${providerId}: ${status} (${enrollments.length} enrollments)`
  );

  return record;
}

/**
 * Verify Medicare enrollment for multiple providers in batches.
 * Processes in chunks of 5 using Promise.allSettled for resilience.
 */
export async function verifyProviderBatch(providerIds: string[]) {
  // 1. Fetch all providers
  const providers = await prisma.provider.findMany({
    where: { id: { in: providerIds } },
    select: { id: true, npi: true },
  });

  const summary = { verified: 0, enrolled: 0, notEnrolled: 0, errors: 0 };
  const CHUNK_SIZE = 5;

  // 2. Process in chunks
  for (let i = 0; i < providers.length; i += CHUNK_SIZE) {
    const chunk = providers.slice(i, i + CHUNK_SIZE);

    const results = await Promise.allSettled(
      chunk.map(async (provider) => {
        if (!provider.npi) {
          throw new Error(`Provider ${provider.id} has no NPI`);
        }

        const cmsResult = await pecosService.lookupByNPI(provider.npi);
        const status = cmsResult.found ? 'ENROLLED' : 'NOT_ENROLLED';
        const enrollments = cmsResult.enrollments ?? [];
        const uniqueStates = [...new Set(enrollments.map(e => e.state))];

        const data = {
          status: status as 'ENROLLED' | 'NOT_ENROLLED',
          verifiedAt: new Date(),
          npi: provider.npi,
          pacId: cmsResult.pacId ?? null,
          enrollmentCount: enrollments.length,
          enrollmentStates: uniqueStates,
          rawData: cmsResult as unknown as Record<string, unknown>,
        };

        await prisma.medicareVerification.upsert({
          where: { providerId: provider.id },
          create: { providerId: provider.id, ...data },
          update: data,
        });

        return { status, enrolled: cmsResult.found };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        summary.verified++;
        if (result.value.enrolled) {
          summary.enrolled++;
        } else {
          summary.notEnrolled++;
        }
      } else {
        summary.errors++;
        logger.error('Batch Medicare verification error:', result.reason);
      }
    }
  }

  logger.info(
    `Batch Medicare verification complete: ${summary.verified} verified, ${summary.enrolled} enrolled, ${summary.notEnrolled} not enrolled, ${summary.errors} errors`
  );

  return summary;
}
