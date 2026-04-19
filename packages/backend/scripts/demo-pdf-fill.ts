/**
 * Zero-setup demo for the PDF fill pipeline.
 *
 * No Docker, no database, no S3 — just a hardcoded fake "credentialing
 * packet" that flows through the real recipe resolver and pdf-engine.
 * Proves the pipeline works end-to-end and produces a filled PDF you
 * can open and look at.
 *
 * Usage:  cd packages/backend && npx tsx scripts/demo-pdf-fill.ts
 * Output: fixtures/output/demo-filled.pdf
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveRecipe, type RecipeField } from '../src/services/form-fill/recipe-resolver.js';
import { fillPdfForm } from '../src/services/form-fill/pdf-engine.js';
import type { CredentialingPacket } from '../src/services/credentialing-packet.service.js';

const TEMPLATE = path.resolve('fixtures/healthchoice-application.pdf');
const OUTPUT_DIR = path.resolve('fixtures/output');
const OUTPUT = path.join(OUTPUT_DIR, 'demo-filled.pdf');

// ── Fake data (stands in for a real CredentialingPacket) ────────────────
const fakePacket = {
  provider: {
    id: 'demo-provider',
    firstName: 'Pat',
    lastName: "O'Brien",
    npi: '9876543210',
    email: 'pat.obrien@demo-practice.example',
    phone: '5551234567',
    practiceLocations: [
      {
        addressLine1: '123 Main Street, Suite 4B',
        city: 'Richmond',
        state: 'VA',
        zipCode: '23220',
        fax: '5551239999',
      },
    ],
  },
  practice: {
    id: 'demo-practice',
    name: 'Lanyard Demo Behavioral Health',
    groupNpi: '1122334455',
    taxIdEncrypted: null,
    addressLine1: '123 Main Street, Suite 4B',
    city: 'Richmond',
    state: 'VA',
    zipCode: '23220',
  },
  practicePayer: {
    id: 'demo-pp',
    groupNpi: '1122334455',
    groupTaxIdEncrypted: '87-1234567',
    primaryContactName: 'Jamie Rivera',
    primaryContactEmail: 'credentialing@demo-practice.example',
    primaryContactPhone: '5559990001',
  },
  primaryLocation: null,
  sensitive: {
    ssn: null,
    taxIdPersonal: null,
    taxIdGroup: '87-1234567',
    bankingAccountNumber: null,
    bankingRoutingNumber: null,
  },
  meta: {
    builtAt: new Date().toISOString(),
    decrypted: true,
    payerId: null,
    practicePayerId: 'demo-pp',
  },
} as unknown as CredentialingPacket;

// ── Recipe (same shape as seed-healthchoice-recipe.ts writes to the DB) ─
const recipe: RecipeField[] = [
  {
    id: '1',
    fieldKey: 'GroupPractice Name',
    fieldLabel: 'Group practice name',
    fieldType: 'text',
    required: true,
    validationRegex: null,
    mappings: [{ sourceKind: 'practice', sourcePath: 'name' }],
  },
  {
    id: '2',
    fieldKey: 'Federal Tax ID Number',
    fieldLabel: 'Federal tax ID',
    fieldType: 'text',
    required: true,
    validationRegex: null,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'groupTaxIdEncrypted', priority: 10 },
    ],
  },
  {
    id: '3',
    fieldKey: 'NPI',
    fieldLabel: 'Group NPI',
    fieldType: 'text',
    required: true,
    validationRegex: null,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'groupNpi', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'groupNpi', priority: 5 },
      { sourceKind: 'provider', sourcePath: 'npi', priority: 1 },
    ],
  },
  {
    id: '4',
    fieldKey: 'Contact Name',
    fieldLabel: 'Contact name',
    fieldType: 'text',
    required: true,
    validationRegex: null,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'primaryContactName', priority: 10 },
      { sourceKind: 'provider', sourcePath: 'firstName', priority: 5 },
    ],
  },
  {
    id: '5',
    fieldKey: 'Contact Street Address',
    fieldLabel: 'Street address',
    fieldType: 'text',
    required: false,
    validationRegex: null,
    mappings: [
      { sourceKind: 'provider', sourcePath: 'practiceLocations[0].addressLine1' },
    ],
  },
  {
    id: '6',
    fieldKey: 'City',
    fieldLabel: 'City',
    fieldType: 'text',
    required: false,
    validationRegex: null,
    mappings: [{ sourceKind: 'provider', sourcePath: 'practiceLocations[0].city' }],
  },
  {
    id: '7',
    fieldKey: 'State',
    fieldLabel: 'State',
    fieldType: 'text',
    required: false,
    validationRegex: null,
    mappings: [{ sourceKind: 'provider', sourcePath: 'practiceLocations[0].state' }],
  },
  {
    id: '8',
    fieldKey: 'ZIP',
    fieldLabel: 'ZIP',
    fieldType: 'text',
    required: false,
    validationRegex: null,
    mappings: [{ sourceKind: 'provider', sourcePath: 'practiceLocations[0].zipCode' }],
  },
  {
    id: '9',
    fieldKey: 'Phone',
    fieldLabel: 'Phone',
    fieldType: 'phone',
    required: false,
    validationRegex: null,
    mappings: [
      {
        sourceKind: 'practicePayer',
        sourcePath: 'primaryContactPhone',
        priority: 10,
        transform: { fn: 'phoneFormat' },
      },
      {
        sourceKind: 'provider',
        sourcePath: 'phone',
        priority: 5,
        transform: { fn: 'phoneFormat' },
      },
    ],
  },
  {
    id: '10',
    fieldKey: 'FAX',
    fieldLabel: 'Fax',
    fieldType: 'phone',
    required: false,
    validationRegex: null,
    mappings: [
      {
        sourceKind: 'provider',
        sourcePath: 'practiceLocations[0].fax',
        transform: { fn: 'phoneFormat' },
      },
    ],
  },
  {
    id: '11',
    fieldKey: 'Email',
    fieldLabel: 'Email',
    fieldType: 'email',
    required: true,
    validationRegex: null,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'primaryContactEmail', priority: 10 },
      { sourceKind: 'provider', sourcePath: 'email', priority: 5 },
    ],
  },
  {
    id: '12',
    fieldKey: 'Legal Entity Name-',
    fieldLabel: 'Legal entity name',
    fieldType: 'text',
    required: false,
    validationRegex: null,
    mappings: [{ sourceKind: 'practice', sourcePath: 'name' }],
  },
  {
    id: '13',
    fieldKey: 'Legal Entity NPI-',
    fieldLabel: 'Legal entity NPI',
    fieldType: 'text',
    required: false,
    validationRegex: null,
    mappings: [{ sourceKind: 'practice', sourcePath: 'groupNpi' }],
  },
  {
    id: '14',
    fieldKey: 'Primary Contact Name-',
    fieldLabel: 'Primary contact name',
    fieldType: 'text',
    required: false,
    validationRegex: null,
    mappings: [{ sourceKind: 'practicePayer', sourcePath: 'primaryContactName' }],
  },
];

async function main() {
  console.log('\nReading template:', TEMPLATE);
  let templateBytes: Uint8Array;
  try {
    templateBytes = new Uint8Array(await fs.readFile(TEMPLATE));
  } catch {
    console.error(
      `\n✗ Template not found. Make sure the file exists at:\n  ${TEMPLATE}\n`
    );
    process.exit(1);
  }

  console.log('Resolving recipe against fake provider data...');
  const resolved = resolveRecipe(recipe, fakePacket);

  console.log('\nResolved values:');
  for (const f of resolved.fields) {
    const val = f.value ?? '(empty)';
    const mark = f.missing ? '✗' : f.value ? '✓' : '·';
    console.log(`  ${mark}  ${f.fieldKey.padEnd(32)} ${val}`);
  }

  console.log('\nFilling PDF...');
  const result = await fillPdfForm(templateBytes, resolved.fields);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT, result.filledBytes);

  console.log(`\n✓ Filled PDF written: ${OUTPUT}`);
  console.log(`  filled:  ${result.filledCount}`);
  console.log(`  skipped: ${result.skippedCount}`);
  if (resolved.missingRequired.length) {
    console.log(`  missing required: ${resolved.missingRequired.map((f) => f.fieldKey).join(', ')}`);
  }
  console.log('\nOpen the PDF in Preview to verify:');
  console.log(`  open "${OUTPUT}"\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
