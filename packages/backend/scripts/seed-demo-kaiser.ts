/**
 * Demo seed — Kaiser ABA Group Application end-to-end.
 *
 * Idempotently creates everything the Monday sales demo needs:
 *   1. Practice "Lanyard Demo Behavioral Health" (full address, group NPI, tax ID)
 *   2. Provider "Dr. Sarah Chen" with PracticeLocation, license
 *   3. Kaiser Permanente Mid-Atlantic Payer
 *   4. PracticePayer linking the two (group NPI + group tax ID for Kaiser)
 *   5. PayerTrack "Behavioral Health — Group" for VA
 *   6. PayerForm pointing at S3 key templates/kaiser/aba-group-application.pdf
 *   7. ~25 PayerFormField rows mapping the obvious top-level group fields
 *      on the Kaiser ABA Group Application PDF (the 12-row roster +
 *      regulatory yes/no questions are intentionally skipped — they're
 *      not needed for the live demo narrative)
 *   8. Enrollment for the provider × Kaiser
 *
 * Usage:
 *   tsx scripts/seed-demo-kaiser.ts
 *
 * Then upload the template PDF to LocalStack S3 (separate step):
 *   awslocal s3 cp <PDF> s3://credentials-documents/templates/kaiser/aba-group-application.pdf
 */

import { prisma } from '../src/utils/prisma.js';
import { encryptSafe } from '../src/utils/crypto.js';

// ─── Demo data (fake but realistic) ──────────────────────────────────────

const PRACTICE = {
  name: 'Lanyard Demo Behavioral Health',
  groupNpi: '1487654321',
  taxIdPlain: '54-7891234',
  phone: '(703) 555-0142',
  email: 'admin@lanyard-demo.health',
  billingEmail: 'billing@lanyard-demo.health',
  addressLine1: '1100 Wilson Boulevard',
  addressLine2: 'Suite 800',
  city: 'Arlington',
  state: 'VA',
  zipCode: '22209',
  organizationType: 'Group Practice',
  states: ['VA', 'MD', 'DC'],
};

const PROVIDER = {
  npi: '1326783402',
  firstName: 'Sarah',
  middleName: 'M',
  lastName: 'Chen',
  email: 'sarah.chen@lanyard-demo.health',
  phone: '(703) 555-0142',
  fax: '(703) 555-0143',
  dateOfBirth: new Date('1985-04-12'),
  gender: 'female' as const,
  providerType: 'lcsw' as const,
  taxonomy: '103K00000X',
  specialties: ['Applied Behavior Analysis', 'Behavioral Health'],
  languages: ['English', 'Spanish'],
};

const PRIMARY_LOCATION = {
  locationName: 'Arlington Office',
  locationType: 'office',
  isPrimary: true,
  addressLine1: PRACTICE.addressLine1,
  addressLine2: PRACTICE.addressLine2,
  city: PRACTICE.city,
  state: PRACTICE.state,
  zipCode: PRACTICE.zipCode,
  phone: PRACTICE.phone,
  fax: '(703) 555-0143',
  email: PROVIDER.email,
  npi: PROVIDER.npi,
  groupNpi: PRACTICE.groupNpi,
};

const PAYER = {
  name: 'Kaiser Permanente of the Mid-Atlantic',
  payerId: 'KAISER-MAS-DEMO',
  payerType: 'Commercial',
  addressLine1: '2101 East Jefferson Street',
  city: 'Rockville',
  state: 'MD',
  zipCode: '20852',
  phone: '(800) 777-7902',
  website: 'https://providers.kaiserpermanente.org/wps/portal/providers/midatlantic',
  averageProcessingDays: 60,
};

const PRACTICE_PAYER = {
  groupNpi: PRACTICE.groupNpi,
  groupTaxIdPlain: PRACTICE.taxIdPlain,
  primaryContactName: 'Sarah M. Chen',
  primaryContactEmail: 'sarah.chen@lanyard-demo.health',
  primaryContactPhone: '(703) 555-0142',
};

const TRACK = {
  payerName: PAYER.name,
  parentOrg: 'Kaiser Permanente',
  payerType: 'Commercial',
  stateRegion: 'VA',
  track: 'Behavioral Health — Group ABA',
  submissionMethod: 'email_pdf',
  isActive: true,
};

const FORM = {
  formName: 'Kaiser Permanente — Applied Behavior Analysis Group Application',
  format: 'PDF',
  deliveryEngine: 'pdf',
  assetUrl: 'templates/kaiser/aba-group-application.pdf',
  isRequired: true,
};

// ─── Field recipe (Kaiser ABA Group Application top-level group fields) ──

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
  // ── Page 1: top group block ────────────────────────────────────────
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
    // computed always returns null → fallback plaintext fires (avoids writing ciphertext)
    mappings: [{ sourceKind: 'computed', sourcePath: '_taxId', fallbackValue: PRACTICE.taxIdPlain }],
  },
  {
    fieldKey: 'NPI',
    fieldLabel: 'Group NPI',
    fieldType: 'text',
    required: true,
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'groupNpi', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'groupNpi', priority: 5 },
    ],
  },
  {
    fieldKey: 'Contact Street Address',
    fieldLabel: 'Contact street address',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'addressLine1' }],
  },
  {
    fieldKey: 'City',
    fieldLabel: 'City',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'city' }],
  },
  {
    fieldKey: 'State',
    fieldLabel: 'State',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'state' }],
  },
  {
    fieldKey: 'ZIP',
    fieldLabel: 'ZIP code',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'zipCode' }],
  },
  {
    fieldKey: 'Phone',
    fieldLabel: 'Phone',
    fieldType: 'phone',
    mappings: [{ sourceKind: 'practice', sourcePath: 'phone' }],
  },
  {
    fieldKey: 'FAX',
    fieldLabel: 'Fax',
    fieldType: 'phone',
    mappings: [{ sourceKind: 'provider', sourcePath: 'fax' }],
  },

  // ── Group Legal Entity block ───────────────────────────────────────
  {
    fieldKey: 'Group Legal Entity Name',
    fieldLabel: 'Group legal entity name',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'name' }],
  },
  {
    fieldKey: 'Group Tax ID',
    fieldLabel: 'Group tax ID',
    fieldType: 'text',
    mappings: [{ sourceKind: 'computed', sourcePath: '_taxId', fallbackValue: PRACTICE.taxIdPlain }],
  },
  {
    fieldKey: 'Group NPI',
    fieldLabel: 'Group NPI',
    fieldType: 'text',
    mappings: [
      { sourceKind: 'practicePayer', sourcePath: 'groupNpi', priority: 10 },
      { sourceKind: 'practice', sourcePath: 'groupNpi', priority: 5 },
    ],
  },

  // ── Primary Contact block ──────────────────────────────────────────
  {
    fieldKey: 'Primary Contact Name',
    fieldLabel: 'Primary contact name',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practicePayer', sourcePath: 'primaryContactName' }],
  },
  {
    fieldKey: 'Job Title',
    fieldLabel: 'Primary contact job title',
    fieldType: 'text',
    mappings: [{ sourceKind: 'constant', sourcePath: 'Practice Administrator' }],
  },
  {
    fieldKey: 'Address',
    fieldLabel: 'Primary contact address',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'addressLine1' }],
  },
  {
    fieldKey: 'Suite  Floor Info',
    fieldLabel: 'Primary contact suite/floor',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'addressLine2' }],
  },
  {
    fieldKey: 'Group City State Zip',
    fieldLabel: 'Primary contact city/state/zip',
    fieldType: 'text',
    mappings: [
      {
        sourceKind: 'computed',
        sourcePath: 'cityStateZip',
        priority: 10,
        fallbackValue: `${PRACTICE.city}, ${PRACTICE.state} ${PRACTICE.zipCode}`,
      },
    ],
  },
  {
    fieldKey: 'Phone Number',
    fieldLabel: 'Primary contact phone',
    fieldType: 'phone',
    mappings: [{ sourceKind: 'practicePayer', sourcePath: 'primaryContactPhone' }],
  },
  {
    fieldKey: 'Email',
    fieldLabel: 'Primary contact email',
    fieldType: 'email',
    mappings: [{ sourceKind: 'practicePayer', sourcePath: 'primaryContactEmail' }],
  },

  // ── Billing Contact block ──────────────────────────────────────────
  {
    fieldKey: 'Billing Contact Name',
    fieldLabel: 'Billing contact name',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practicePayer', sourcePath: 'primaryContactName' }],
  },
  {
    fieldKey: 'Email_2',
    fieldLabel: 'Billing contact email',
    fieldType: 'email',
    mappings: [
      { sourceKind: 'practice', sourcePath: 'billingEmail', priority: 10 },
      { sourceKind: 'practicePayer', sourcePath: 'primaryContactEmail', priority: 5 },
    ],
  },

  // ── Practice Location 1 block ──────────────────────────────────────
  {
    fieldKey: '1 Practice Location Address',
    fieldLabel: 'Practice location 1 address',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'addressLine1' }],
  },
  {
    fieldKey: 'Suite  Floor Info_4',
    fieldLabel: 'Practice location 1 suite',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'addressLine2' }],
  },
  {
    fieldKey: 'Practice Location City State Zip',
    fieldLabel: 'Practice location 1 city/state/zip',
    fieldType: 'text',
    mappings: [
      {
        sourceKind: 'computed',
        sourcePath: 'cityStateZip',
        fallbackValue: `${PRACTICE.city}, ${PRACTICE.state} ${PRACTICE.zipCode}`,
      },
    ],
  },
  {
    fieldKey: 'Practice Location NPI',
    fieldLabel: 'Practice location 1 NPI',
    fieldType: 'text',
    mappings: [{ sourceKind: 'practice', sourcePath: 'groupNpi' }],
  },
  {
    fieldKey: 'Practice Location Phone',
    fieldLabel: 'Practice location 1 phone',
    fieldType: 'phone',
    mappings: [{ sourceKind: 'practice', sourcePath: 'phone' }],
  },
  {
    fieldKey: 'Practice Location Fax',
    fieldLabel: 'Practice location 1 fax',
    fieldType: 'phone',
    mappings: [{ sourceKind: 'provider', sourcePath: 'fax' }],
  },

  // ── First roster row (provider) ────────────────────────────────────
  {
    fieldKey: 'First NameRow1',
    fieldLabel: 'Roster row 1 first name',
    fieldType: 'text',
    mappings: [{ sourceKind: 'provider', sourcePath: 'firstName' }],
  },
  {
    fieldKey: 'MIRow1',
    fieldLabel: 'Roster row 1 MI',
    fieldType: 'text',
    mappings: [{ sourceKind: 'provider', sourcePath: 'middleName' }],
  },
  {
    fieldKey: 'Last NameRow1',
    fieldLabel: 'Roster row 1 last name',
    fieldType: 'text',
    mappings: [{ sourceKind: 'provider', sourcePath: 'lastName' }],
  },
  {
    fieldKey: 'Individual NPIRow1',
    fieldLabel: 'Roster row 1 NPI',
    fieldType: 'text',
    mappings: [{ sourceKind: 'provider', sourcePath: 'npi' }],
  },
  {
    fieldKey: 'Ge nde rRow1',
    fieldLabel: 'Roster row 1 gender',
    fieldType: 'text',
    mappings: [{ sourceKind: 'provider', sourcePath: 'gender' }],
  },
  {
    fieldKey: 'TitleRow1',
    fieldLabel: 'Roster row 1 title',
    fieldType: 'text',
    mappings: [{ sourceKind: 'provider', sourcePath: 'providerType' }],
  },
  {
    fieldKey: 'Specialtyie sRow1',
    fieldLabel: 'Roster row 1 specialty',
    fieldType: 'text',
    mappings: [{ sourceKind: 'constant', sourcePath: 'Applied Behavior Analysis' }],
  },
];

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ Demo seed: Kaiser ABA Group Application ━━━\n');

  // 1. Practice — find-or-create on (name, groupNpi)
  const existingPractice = await prisma.practice.findFirst({
    where: { name: PRACTICE.name, groupNpi: PRACTICE.groupNpi },
  });
  const practice = existingPractice ?? await prisma.practice.create({
    data: {
      name: PRACTICE.name,
      status: 'ACTIVE',
      phone: PRACTICE.phone,
      email: PRACTICE.email,
      billingEmail: PRACTICE.billingEmail,
      taxIdEncrypted: encryptSafe(PRACTICE.taxIdPlain),
      groupNpi: PRACTICE.groupNpi,
      addressLine1: PRACTICE.addressLine1,
      addressLine2: PRACTICE.addressLine2,
      city: PRACTICE.city,
      state: PRACTICE.state,
      zipCode: PRACTICE.zipCode,
      organizationType: PRACTICE.organizationType,
      states: PRACTICE.states,
      setupComplete: true,
    },
  });
  console.log(`Practice:     ${practice.id} — ${practice.name}`);

  // 2. Provider (unique on npi)
  const provider = await prisma.providerProfile.upsert({
    where: { npi: PROVIDER.npi },
    create: {
      npi: PROVIDER.npi,
      firstName: PROVIDER.firstName,
      middleName: PROVIDER.middleName,
      lastName: PROVIDER.lastName,
      email: PROVIDER.email,
      phone: PROVIDER.phone,
      fax: PROVIDER.fax,
      dateOfBirth: PROVIDER.dateOfBirth,
      gender: PROVIDER.gender,
      providerType: PROVIDER.providerType,
      taxonomy: PROVIDER.taxonomy,
      specialties: PROVIDER.specialties,
      languages: PROVIDER.languages,
      practiceId: practice.id,
      status: 'active',
      acceptingMedicare: true,
      acceptingMedicaid: false,
    },
    update: {
      practiceId: practice.id,
    },
  });
  console.log(`Provider:     ${provider.id} — ${provider.firstName} ${provider.lastName}`);

  // 3. PracticeLocation
  const existingLocation = await prisma.practiceLocation.findFirst({
    where: { providerId: provider.id, isPrimary: true },
  });
  const location = existingLocation
    ? await prisma.practiceLocation.update({
        where: { id: existingLocation.id },
        data: {
          locationName: PRIMARY_LOCATION.locationName,
          addressLine1: PRIMARY_LOCATION.addressLine1,
          addressLine2: PRIMARY_LOCATION.addressLine2,
          city: PRIMARY_LOCATION.city,
          state: PRIMARY_LOCATION.state,
          zipCode: PRIMARY_LOCATION.zipCode,
          phone: PRIMARY_LOCATION.phone,
          fax: PRIMARY_LOCATION.fax,
          email: PRIMARY_LOCATION.email,
          npi: PRIMARY_LOCATION.npi,
          groupNpi: PRIMARY_LOCATION.groupNpi,
          practiceId: practice.id,
        },
      })
    : await prisma.practiceLocation.create({
        data: {
          providerId: provider.id,
          locationName: PRIMARY_LOCATION.locationName,
          locationType: PRIMARY_LOCATION.locationType,
          isPrimary: true,
          addressLine1: PRIMARY_LOCATION.addressLine1,
          addressLine2: PRIMARY_LOCATION.addressLine2,
          city: PRIMARY_LOCATION.city,
          state: PRIMARY_LOCATION.state,
          zipCode: PRIMARY_LOCATION.zipCode,
          phone: PRIMARY_LOCATION.phone,
          fax: PRIMARY_LOCATION.fax,
          email: PRIMARY_LOCATION.email,
          npi: PRIMARY_LOCATION.npi,
          groupNpi: PRIMARY_LOCATION.groupNpi,
          practiceId: practice.id,
        },
      });
  console.log(`Location:     ${location.id} — ${location.locationName}`);

  // 4. Payer (unique on payerId)
  const payer = await prisma.payer.upsert({
    where: { payerId: PAYER.payerId },
    create: {
      name: PAYER.name,
      payerId: PAYER.payerId,
      payerType: PAYER.payerType,
      addressLine1: PAYER.addressLine1,
      city: PAYER.city,
      state: PAYER.state,
      zipCode: PAYER.zipCode,
      phone: PAYER.phone,
      website: PAYER.website,
      averageProcessingDays: PAYER.averageProcessingDays,
      verticalTags: ['behavioral_health', 'aba'],
    },
    update: {},
  });
  console.log(`Payer:        ${payer.id} — ${payer.name}`);

  // 5. PracticePayer (unique on practiceId + payerId)
  const practicePayer = await prisma.practicePayer.upsert({
    where: { practiceId_payerId: { practiceId: practice.id, payerId: payer.id } },
    create: {
      practiceId: practice.id,
      payerId: payer.id,
      groupNpi: PRACTICE_PAYER.groupNpi,
      groupTaxIdEncrypted: encryptSafe(PRACTICE_PAYER.groupTaxIdPlain),
      primaryContactName: PRACTICE_PAYER.primaryContactName,
      primaryContactEmail: PRACTICE_PAYER.primaryContactEmail,
      primaryContactPhone: PRACTICE_PAYER.primaryContactPhone,
    },
    update: {
      groupNpi: PRACTICE_PAYER.groupNpi,
      groupTaxIdEncrypted: encryptSafe(PRACTICE_PAYER.groupTaxIdPlain),
      primaryContactName: PRACTICE_PAYER.primaryContactName,
      primaryContactEmail: PRACTICE_PAYER.primaryContactEmail,
      primaryContactPhone: PRACTICE_PAYER.primaryContactPhone,
    },
  });
  console.log(`PracticePayer:${practicePayer.id}`);

  // 6. PayerTrack (unique on payerName + track + stateRegion)
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
  console.log(`PayerTrack:   ${track.id} — ${track.payerName} / ${track.track} / ${track.stateRegion}`);

  // 7. PayerForm (find-or-create on track + formName)
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
  console.log(`PayerForm:    ${form.id} — ${form.formName}`);

  // 8. Fields + mappings (idempotent: replace mappings on each run)
  let fieldCount = 0;
  let mappingCount = 0;
  for (let i = 0; i < FIELDS.length; i++) {
    const fs = FIELDS[i]!;
    const field = await prisma.payerFormField.upsert({
      where: { payerFormId_fieldKey: { payerFormId: form.id, fieldKey: fs.fieldKey } },
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
    fieldCount++;
    await prisma.payerFormFieldMapping.deleteMany({ where: { payerFormFieldId: field.id } });
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
      mappingCount++;
    }
  }
  console.log(`Fields:       ${fieldCount} upserted`);
  console.log(`Mappings:     ${mappingCount} re-created`);

  // 9. Enrollment (find-or-create on provider + payer)
  const existingEnrollment = await prisma.enrollment.findFirst({
    where: { providerId: provider.id, payerId: payer.id },
  });
  const enrollment = existingEnrollment
    ? existingEnrollment
    : await prisma.enrollment.create({
        data: {
          providerId: provider.id,
          payerId: payer.id,
          payerTrackId: track.id,
          status: 'in_progress',
          productTypes: ['Commercial', 'Medicare Advantage'],
          notes: 'Demo enrollment for Kaiser ABA Group Application',
        },
      });
  console.log(`Enrollment:   ${enrollment.id}`);

  console.log('\n━━━ Done ━━━');
  console.log(`\nNext step: upload PDF template to LocalStack S3 at key:`);
  console.log(`  ${FORM.assetUrl}`);
  console.log(`\nThen test fill:`);
  console.log(`  curl -X POST http://localhost:3002/api/v1/enrollments/${enrollment.id}/populate-forms`);
  console.log(`\nOr launch agent:`);
  console.log(`  POST /api/v1/agent/workflows  body: { goal: "populate_forms", providerId: "${provider.id}", enrollmentId: "${enrollment.id}" }`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
