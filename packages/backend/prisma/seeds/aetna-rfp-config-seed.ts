/**
 * Seed: create/refresh the Aetna AETNA_RFP PayerSubmissionConfig.
 *
 * Resolves go-live blocker #1 (no payer config → resolver fails at its first
 * gate). Idempotent upsert keyed on payerId. DML only (INSERT/UPDATE), so it
 * runs fine as the runtime `lanyard_app` role — no DATABASE_URL_ADMIN needed.
 *
 * Usage: npx tsx prisma/seeds/aetna-rfp-config-seed.ts
 *
 * SAFETY: refuses to run until SUBMITTER.phone is a real number, so a
 * placeholder can never reach Aetna. Set it, then run against the target env.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// The submitter is the Lanyard contact Aetna sees on every RFP. role MUST be a
// verbatim Aetna #role <option> label (the adapter selects it by label).
const SUBMITTER = {
  firstName: 'Kay',
  lastName: 'Ward',
  role: 'Credentialing / Enrollment (Director, Manager, Coordinator)',
  email: 'credentialing@lanyardhealth.com',
  phone: '__SET_REAL_PHONE__', // ← replace before running; seed refuses otherwise
};

// Dotted keys map to REQUIRED_FIELD_ACCESSORS in aetna-rfp-resolver.ts. Only
// fields the BH individual path actually consumes — ageGroup/practiceFocus are
// optional multiselects (left out so the completeness gate doesn't fail on the
// empty columns we have today).
const REQUIRED_FIELDS = [
  'provider.firstName',
  'provider.lastName',
  'provider.npi',
  'provider.dateOfBirth',
  'provider.caqhProviderId',
  'provider.providerType',
  'provider.entityType',
  'provider.specialties',
  'license.licenseNumber',
  'license.expirationDate',
  'practice.taxIdEncrypted',
  'practice.legalName',
  'practice.addressLine1',
  'practice.city',
  'practice.state',
  'practice.zipCode',
  'practice.phone',
];

async function main() {
  if (SUBMITTER.phone === '__SET_REAL_PHONE__') {
    throw new Error('Set SUBMITTER.phone to the real Lanyard credentialing number before running.');
  }

  // Match the plain "Aetna" payer, not "CVS Health / Aetna".
  const payer = await prisma.payer.findFirst({ where: { name: 'Aetna' } });
  if (!payer) throw new Error('Payer "Aetna" not found — cannot seed config.');

  const config = {
    submitter: SUBMITTER,
    payer: 'Aetna' as const,
    placeOfService: 'Office based' as const,
    adaAccessible: false,
    aetnaEapParticipation: false,
  };

  const row = await prisma.payerSubmissionConfig.upsert({
    where: { payerId: payer.id },
    create: {
      payerId: payer.id,
      adapterType: 'AETNA_RFP',
      config,
      requiredFields: REQUIRED_FIELDS,
      isActive: true,
    },
    update: {
      adapterType: 'AETNA_RFP',
      config,
      requiredFields: REQUIRED_FIELDS,
      isActive: true,
    },
  });

  console.log(`Upserted AETNA_RFP config ${row.id} for payer ${payer.name} (${payer.id}).`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
