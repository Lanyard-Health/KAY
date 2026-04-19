/**
 * Idempotently seed a PayerTrack + PayerForm + PayerFormField +
 * PayerFormFieldMapping recipe for the HealthChoice practitioner
 * application PDF. Used by the test harness in scripts/test-pdf-fill.ts.
 *
 * Usage: tsx scripts/seed-healthchoice-recipe.ts
 */

import { prisma } from '../src/utils/prisma.js';

const TRACK = {
  payerName: 'HealthChoice',
  parentOrg: 'HealthChoice',
  payerType: 'Medicaid',
  stateRegion: 'VA',
  track: 'Behavioral Health — Group',
  submissionMethod: 'email_pdf',
  isActive: true,
};

const FORM = {
  formName: 'HealthChoice Practitioner & Ancillary Application for Participation (2024)',
  format: 'PDF',
  deliveryEngine: 'pdf',
  assetUrl: 'templates/healthchoice/practitioner-ancillary-application-2024.pdf',
  isRequired: true,
  url: null as string | null,
  destination: null as string | null,
};

// Field-level recipe — maps PDF AcroForm field names (as they appear in
// the template) to our CredentialingPacket source paths. Names taken
// from `tsx scripts/inspect-pdf-fields.ts fixtures/healthchoice-application.pdf`.
interface FieldSeed {
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  required?: boolean;
  mappings: Array<{
    sourceKind: string;
    sourcePath: string;
    priority?: number;
    fallbackValue?: string;
    transform?: Record<string, unknown>;
  }>;
}

const FIELDS: FieldSeed[] = [
  {
    fieldKey: 'GroupPractice Name',
    fieldLabel: 'Group practice name',
    fieldType: 'text',
    required: true,
    mappings: [{ sourceKind: 'practice', sourcePath: 'name' }],
  },
  {
    fieldKey: 'Federal Tax ID Number',
    fieldLabel: 'Federal tax ID',
    fieldType: 'text',
    required: true,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'groupTaxIdEncrypted', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'taxIdEncrypted', priority: 5 },
    ],
  },
  {
    fieldKey: 'NPI',
    fieldLabel: 'Group NPI',
    fieldType: 'text',
    required: true,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'groupNpi', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'groupNpi', priority: 5 },
      { sourceKind: 'provider', sourcePath: 'npi', priority: 1 },
    ],
  },
  {
    fieldKey: 'Contact Name',
    fieldLabel: 'Contact name',
    fieldType: 'text',
    required: true,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'primaryContactName', priority: 10 },
      { sourceKind: 'provider', sourcePath: 'firstName', priority: 5 },
    ],
  },
  {
    fieldKey: 'Contact Street Address',
    fieldLabel: 'Street address',
    fieldType: 'text',
    mappings: [
      { sourceKind: 'provider', sourcePath: 'practiceLocations[0].addressLine1', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'addressLine1', priority: 5 },
    ],
  },
  {
    fieldKey: 'City',
    fieldLabel: 'City',
    fieldType: 'text',
    mappings: [
      { sourceKind: 'provider', sourcePath: 'practiceLocations[0].city', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'city', priority: 5 },
    ],
  },
  {
    fieldKey: 'State',
    fieldLabel: 'State',
    fieldType: 'text',
    mappings: [
      { sourceKind: 'provider', sourcePath: 'practiceLocations[0].state', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'state', priority: 5 },
    ],
  },
  {
    fieldKey: 'ZIP',
    fieldLabel: 'ZIP',
    fieldType: 'text',
    mappings: [
      { sourceKind: 'provider', sourcePath: 'practiceLocations[0].zipCode', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'zipCode', priority: 5 },
    ],
  },
  {
    fieldKey: 'Phone',
    fieldLabel: 'Phone',
    fieldType: 'phone',
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
    fieldKey: 'FAX',
    fieldLabel: 'Fax',
    fieldType: 'phone',
    mappings: [
      {
        sourceKind: 'provider',
        sourcePath: 'practiceLocations[0].fax',
        transform: { fn: 'phoneFormat' },
      },
    ],
  },
  {
    fieldKey: 'Email',
    fieldLabel: 'Email',
    fieldType: 'email',
    required: true,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'primaryContactEmail', priority: 10 },
      { sourceKind: 'provider', sourcePath: 'email', priority: 5 },
    ],
  },
  {
    fieldKey: 'Legal Entity Name-',
    fieldLabel: 'Legal entity name',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'name' }],
  },
  {
    fieldKey: 'Legal Entity NPI-',
    fieldLabel: 'Legal entity NPI',
    fieldType: 'text',
    mappings: [
      { sourceKind: 'practice', sourcePath: 'groupNpi', priority: 10 },
      { sourceKind: 'provider', sourcePath: 'npi', priority: 5 },
    ],
  },
  {
    fieldKey: 'Primary Contact Name-',
    fieldLabel: 'Primary contact name',
    fieldType: 'text',
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'primaryContactName', priority: 10 },
    ],
  },
];

async function main() {
  // 1. Ensure PayerTrack exists (unique on payerName + track + stateRegion)
  const track = await prisma.payerTrack.upsert({
    where: {
      payerName_track_stateRegion: {
        payerName: TRACK.payerName,
        track: TRACK.track,
        stateRegion: TRACK.stateRegion,
      },
    },
    create: TRACK,
    update: {},
  });
  console.log(`PayerTrack: ${track.id} (${track.payerName} / ${track.track} / ${track.stateRegion})`);

  // 2. Ensure PayerForm exists (upsert by payerTrackId + formName)
  const existingForm = await prisma.payerForm.findFirst({
    where: { payerTrackId: track.id, formName: FORM.formName },
  });
  const form = existingForm
    ? await prisma.payerForm.update({
        where: { id: existingForm.id },
        data: {
          deliveryEngine: FORM.deliveryEngine,
          assetUrl: FORM.assetUrl,
          format: FORM.format,
          isRequired: FORM.isRequired,
        },
      })
    : await prisma.payerForm.create({
        data: { ...FORM, payerTrackId: track.id },
      });
  console.log(`PayerForm:  ${form.id} (${form.formName})`);

  // 3. Upsert fields + mappings
  let createdFields = 0;
  let createdMappings = 0;
  for (let i = 0; i < FIELDS.length; i++) {
    const fs = FIELDS[i]!;
    const field = await prisma.payerFormField.upsert({
      where: {
        payerFormId_fieldKey: { payerFormId: form.id, fieldKey: fs.fieldKey },
      },
      create: {
        payerFormId: form.id,
        fieldKey: fs.fieldKey,
        fieldLabel: fs.fieldLabel,
        fieldType: fs.fieldType,
        required: fs.required ?? false,
        orderIndex: i,
      },
      update: {
        fieldLabel: fs.fieldLabel,
        fieldType: fs.fieldType,
        required: fs.required ?? false,
        orderIndex: i,
      },
    });
    createdFields++;

    // Replace mappings (simpler than merging): delete then create
    await prisma.payerFormFieldMapping.deleteMany({
      where: { payerFormFieldId: field.id },
    });
    for (const m of fs.mappings) {
      await prisma.payerFormFieldMapping.create({
        data: {
          payerFormFieldId: field.id,
          sourceKind: m.sourceKind,
          sourcePath: m.sourcePath,
          priority: m.priority ?? 0,
          fallbackValue: m.fallbackValue ?? null,
          transform: (m.transform as any) ?? null,
        },
      });
      createdMappings++;
    }
  }
  console.log(`Fields:     ${createdFields} upserted`);
  console.log(`Mappings:   ${createdMappings} (re)created`);
  console.log(`\nPayerFormId: ${form.id}`);
  console.log(`AssetUrl:    ${FORM.assetUrl}`);
  console.log('\nNext: upload the template PDF to the asset URL, then run:');
  console.log(`  tsx scripts/test-pdf-fill.ts <enrollmentId> ${form.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
