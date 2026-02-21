/**
 * Seed script: Upsert PayerAdapterConfig records with requiredFields.
 *
 * Usage: npx tsx prisma/seeds/payer-adapter-seed.ts
 *
 * This updates existing PayerAdapterConfig records (matched by payerId)
 * with the requiredFields appropriate for their adapter type. If no
 * PayerAdapterConfig records exist, it logs a message and exits.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REQUIRED_FIELDS_BY_ADAPTER_TYPE: Record<string, string[]> = {
  caqh_directassure: [
    'npi',
    'medical_license',
    'board_certification',
    'malpractice_insurance',
    'dea_registration',
    'education',
  ],
  manual_submission: [
    'npi',
    'medical_license',
    'malpractice_insurance',
  ],
};

async function main() {
  const configs = await prisma.payerAdapterConfig.findMany();

  if (configs.length === 0) {
    console.log('No PayerAdapterConfig records found. Skipping seed.');
    return;
  }

  let updated = 0;
  for (const config of configs) {
    const requiredFields = REQUIRED_FIELDS_BY_ADAPTER_TYPE[config.adapterType];
    if (!requiredFields) {
      console.log(`  Skipping ${config.id}: unknown adapter type "${config.adapterType}"`);
      continue;
    }

    await prisma.payerAdapterConfig.update({
      where: { id: config.id },
      data: { requiredFields },
    });
    console.log(`  Updated ${config.id} (${config.adapterType}): ${requiredFields.length} required fields`);
    updated++;
  }

  console.log(`Done. Updated ${updated}/${configs.length} configs.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
