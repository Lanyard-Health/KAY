/**
 * Demo Aetna Payer Seed (test data — safe to remove)
 *
 * Creates an "Aetna (DEMO)" payer + PayerSubmissionConfig that routes
 * portal submissions through the AetnaAdapter, which drives the local
 * mock-aetna static site at http://localhost:3002/mock-aetna. This is
 * the demo target for the orchestrator's `submit_to_aetna_demo` scripted
 * goal — used to show real Puppeteer browser automation against an
 * Aetna-shaped target without hitting real production Aetna.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-aetna-payer.ts             # create / refresh
 *   npx tsx scripts/seed-demo-aetna-payer.ts --cleanup    # delete
 */

import { PrismaClient } from '@prisma/client';
import { encrypt } from '../src/utils/crypto.js';

const prisma = new PrismaClient();
const CLEANUP = process.argv.includes('--cleanup');

const DEMO_PAYER_ID = 'AETNA-DEMO-001';
const DEMO_PAYER_NAME = 'Aetna (DEMO)';
const DEMO_USERNAME = 'lanyard.demo';
const DEMO_PASSWORD = 'Lan9ardDemo!Sentinel#2026';

async function cleanup() {
  const payer = await prisma.payer.findUnique({
    where: { payerId: DEMO_PAYER_ID },
    select: { id: true, name: true },
  });
  if (!payer) {
    console.log(`No demo Aetna payer found at payerId ${DEMO_PAYER_ID} — nothing to clean up.`);
    return;
  }
  await prisma.payerSubmissionConfig.deleteMany({ where: { payerId: payer.id } });
  await prisma.payer.delete({ where: { id: payer.id } });
  console.log(`Deleted demo Aetna payer ${payer.name} (id ${payer.id}).`);
}

async function seed() {
  console.log(`Demo Aetna Payer Seed — payerId ${DEMO_PAYER_ID}`);
  console.log('────────────────────────────────────────');

  const payer = await prisma.payer.upsert({
    where: { payerId: DEMO_PAYER_ID },
    create: {
      payerId: DEMO_PAYER_ID,
      name: DEMO_PAYER_NAME,
      payerType: 'commercial',
      website: 'https://www.aetna.com',
      notes: 'Demo payer for Aetna browser-automation showcase. Drives a local mock portal — does NOT hit real Aetna.',
      verticalTags: ['demo'],
    },
    update: {
      name: DEMO_PAYER_NAME,
    },
  });
  console.log(`✓ Payer: ${payer.name} (id ${payer.id})`);

  const credentialsJson = JSON.stringify({ username: DEMO_USERNAME, password: DEMO_PASSWORD });
  const credentialsEncrypted = encrypt(credentialsJson);

  const config = await prisma.payerSubmissionConfig.upsert({
    where: { payerId: payer.id },
    create: {
      payerId: payer.id,
      adapterType: 'aetna_demo',
      submissionMethod: 'web_automation',
      config: { mockUrl: 'http://localhost:3002/mock-aetna' },
      credentialsEncrypted,
      requiredFields: ['npi', 'medical_license'],
      isActive: true,
    },
    update: {
      adapterType: 'aetna_demo',
      submissionMethod: 'web_automation',
      config: { mockUrl: 'http://localhost:3002/mock-aetna' },
      credentialsEncrypted,
      requiredFields: ['npi', 'medical_license'],
      isActive: true,
    },
  });
  console.log(`✓ PayerSubmissionConfig: adapterType=${config.adapterType}, isActive=${config.isActive}`);

  console.log('\n────────────────────────────────────────');
  console.log(`Demo Aetna payer ready. Use payerId ${payer.id} when launching workflows.`);
  console.log(`To remove: npx tsx scripts/seed-demo-aetna-payer.ts --cleanup`);
}

(CLEANUP ? cleanup() : seed())
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
