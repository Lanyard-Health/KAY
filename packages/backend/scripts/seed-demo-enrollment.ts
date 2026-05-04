/**
 * Demo Enrollment Seed (test data — safe to remove)
 *
 * Creates an Enrollment row linking the demo CAQH provider (NPI 9999999991)
 * to the demo Availity payer (payerId AVAILITY-DEMO-001), so the
 * EnrollmentDetail page renders an enrollment card and the Availity demo
 * button has somewhere to live.
 *
 * Prerequisites — both must already exist:
 *   1. Demo CAQH provider:  npx tsx scripts/seed-demo-caqh-provider.ts
 *   2. Demo Availity payer: npx tsx scripts/seed-demo-availity-payer.ts
 *
 * Usage:
 *   npx tsx scripts/seed-demo-enrollment.ts             # create / refresh
 *   npx tsx scripts/seed-demo-enrollment.ts --cleanup    # delete the enrollment
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CLEANUP = process.argv.includes('--cleanup');

const DEMO_PROVIDER_NPI = '9999999991';
const DEMO_PAYER_ID = 'AVAILITY-DEMO-001';

async function findIds() {
  const [provider, payer] = await Promise.all([
    prisma.providerProfile.findUnique({
      where: { npi: DEMO_PROVIDER_NPI },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.payer.findUnique({
      where: { payerId: DEMO_PAYER_ID },
      select: { id: true, name: true },
    }),
  ]);
  return { provider, payer };
}

async function cleanup() {
  const { provider, payer } = await findIds();
  if (!provider || !payer) {
    console.log('Demo provider or payer not found — nothing to clean up.');
    return;
  }
  const result = await prisma.enrollment.deleteMany({
    where: { providerId: provider.id, payerId: payer.id },
  });
  console.log(`Deleted ${result.count} demo enrollment(s) for ${provider.firstName} ${provider.lastName} → ${payer.name}.`);
}

async function seed() {
  console.log(`Demo Enrollment Seed`);
  console.log('────────────────────────────────────────');

  const { provider, payer } = await findIds();
  if (!provider) {
    console.error(`Demo CAQH provider (NPI ${DEMO_PROVIDER_NPI}) not found.`);
    console.error(`Run first: npx tsx scripts/seed-demo-caqh-provider.ts`);
    process.exit(1);
  }
  if (!payer) {
    console.error(`Demo Availity payer (payerId ${DEMO_PAYER_ID}) not found.`);
    console.error(`Run first: npx tsx scripts/seed-demo-availity-payer.ts`);
    process.exit(1);
  }

  // Find existing enrollment for this provider/payer pair to avoid dup rows
  const existing = await prisma.enrollment.findFirst({
    where: { providerId: provider.id, payerId: payer.id },
    select: { id: true },
  });

  let enrollment;
  if (existing) {
    enrollment = await prisma.enrollment.update({
      where: { id: existing.id },
      data: {
        status: 'in_progress',
        applicationDate: new Date(),
        notes: 'Demo enrollment for the Availity browser-automation showcase. Safe to delete.',
      },
    });
    console.log(`✓ Updated existing enrollment ${enrollment.id}`);
  } else {
    enrollment = await prisma.enrollment.create({
      data: {
        providerId: provider.id,
        payerId: payer.id,
        status: 'in_progress',
        applicationDate: new Date(),
        notes: 'Demo enrollment for the Availity browser-automation showcase. Safe to delete.',
      },
    });
    console.log(`✓ Created enrollment ${enrollment.id}`);
  }

  console.log(`  Provider: ${provider.firstName} ${provider.lastName} (NPI ${DEMO_PROVIDER_NPI})`);
  console.log(`  Payer:    ${payer.name}`);
  console.log(`  Status:   ${enrollment.status}`);
  console.log('\n────────────────────────────────────────');
  console.log(`View at: /enrollments/${enrollment.id}`);
  console.log(`To remove: npx tsx scripts/seed-demo-enrollment.ts --cleanup`);
}

(CLEANUP ? cleanup() : seed())
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
