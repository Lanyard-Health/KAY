# Automated Aetna Provider Enrollment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable credentialing specialists to submit Aetna provider enrollment applications directly from Lanyard with Playwright automation, human review gate, and full audit trail.

**Architecture:** Four layers — (1) readiness check validates provider data completeness against 39 required Aetna fields, (2) Playwright form filler navigates the 10-page Angular SPA, (3) review/approval API holds browser for human review then submits or rejects, (4) AetnaEnrollmentRun model tracks the full lifecycle with screenshots, logs, and confirmation PDF.

**Tech Stack:** Playwright (new), Prisma, Express, R2/S3 (existing), React + Tailwind + React Query (existing)

**Design doc:** `docs/plans/2026-02-18-aetna-enrollment-automation-design.md`

**Reference files:**
- `/Users/kay/KAY/aetna-form-complete.json` — curated field map (10 pages, formcontrolnames, navigation notes)
- `/Users/kay/KAY/aetna-fields.json` — raw DOM extraction (selectors, CSS classes, hidden fields)

---

## Task 1: Prisma Schema Changes + Migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Modify: `packages/shared/src/validation/credentials.ts` (add new HospitalAffiliation fields to schema)

### Step 1: Add AetnaRunStatus enum and AetnaEnrollmentRun model to schema.prisma

After the existing `WorkflowStepOwner` enum (around line 188), add:

```prisma
enum AetnaRunStatus {
  pending
  filling
  awaiting_review
  submitting
  completed
  failed
  rejected
  timed_out
}
```

After the last model in the file, add:

```prisma
model AetnaEnrollmentRun {
  id                String         @id @default(uuid())
  payerEnrollmentId String         @map("payer_enrollment_id")
  payerEnrollment   PayerEnrollment @relation(fields: [payerEnrollmentId], references: [id], onDelete: Cascade)

  status            AetnaRunStatus @default(pending)
  aetnaRequestId    String?        @map("aetna_request_id")

  formPayload       Json           @map("form_payload")
  automationLog     String?        @map("automation_log") @db.Text
  errorMessage      String?        @map("error_message")
  errorPage         Int?           @map("error_page")

  screenshotDocIds  String[]       @map("screenshot_doc_ids")
  confirmationPdfId String?        @map("confirmation_pdf_id")

  startedAt         DateTime?      @map("started_at")
  reviewExpiresAt   DateTime?      @map("review_expires_at")
  submittedAt       DateTime?      @map("submitted_at")
  completedAt       DateTime?      @map("completed_at")

  initiatedById     String         @map("initiated_by_id")
  initiatedBy       User           @relation(fields: [initiatedById], references: [id])

  createdAt         DateTime       @default(now()) @map("created_at")
  updatedAt         DateTime       @updatedAt @map("updated_at")

  @@map("aetna_enrollment_runs")
}
```

### Step 2: Add relation on PayerEnrollment model

Find the `PayerEnrollment` model (around line 1187). After the `workflowSteps` relation, add:

```prisma
  aetnaRuns         AetnaEnrollmentRun[]
```

### Step 3: Add relation on User model

Find the `User` model. Add:

```prisma
  aetnaEnrollmentRuns AetnaEnrollmentRun[]
```

### Step 4: Add new fields to Provider model

Find the `Provider` model (around line 191). After the `languages` field (around line 220), add:

```prisma
  acceptingMedicare Boolean  @default(false) @map("accepting_medicare")
  acceptingMedicaid Boolean  @default(false) @map("accepting_medicaid")
  ePrescribing      Boolean  @default(false) @map("e_prescribing")
```

### Step 5: Add new fields to HospitalAffiliation model

Find the `HospitalAffiliation` model (around line 624). After the `state` field, add:

```prisma
  facilityNpi          String? @map("facility_npi")
  facilityPhone        String? @map("facility_phone")
  facilityAddressLine1 String? @map("facility_address_line1")
  facilityCity         String? @map("facility_city")
  facilityState        String? @map("facility_state")
  facilityZipCode      String? @map("facility_zip_code")
```

### Step 6: Update shared validation schema for HospitalAffiliation

In `packages/shared/src/validation/credentials.ts`, find `createHospitalAffiliationSchema` and add the new optional fields:

```typescript
  facilityNpi: z.string().max(10).optional(),
  facilityPhone: z.string().max(20).optional(),
  facilityAddressLine1: z.string().max(200).optional(),
  facilityCity: z.string().max(100).optional(),
  facilityState: z.string().length(2).optional(),
  facilityZipCode: z.string().max(10).optional(),
```

### Step 7: Rebuild shared and generate migration

```bash
npm run build --workspace=packages/shared
cd packages/backend
npx prisma migrate dev --name add-aetna-enrollment-automation
npx prisma generate
```

### Step 8: Verify migration

```bash
npx prisma migrate status
```

Expected: Migration applied, no pending migrations.

### Step 9: Run existing tests to verify no regressions

```bash
cd packages/backend
npx vitest run
```

Expected: All existing tests pass (1514+).

### Step 10: Commit

```bash
git add packages/backend/prisma/ packages/shared/src/validation/credentials.ts packages/shared/dist/
git commit -m "feat: add AetnaEnrollmentRun model + provider/hospital affiliation fields for Aetna automation"
```

---

## Task 2: Aetna Field Mapper

Pure function — maps Lanyard data to Aetna form field values. No side effects, easy to test.

**Files:**
- Create: `packages/backend/src/services/aetna/field-mapper.ts`
- Create: `packages/backend/src/services/aetna/field-mapper.test.ts`
- Create: `packages/backend/src/services/aetna/types.ts`

### Step 1: Create the types file

Create `packages/backend/src/services/aetna/types.ts`:

```typescript
/**
 * Shape of data loaded from Prisma for one provider enrollment.
 * Passed to the field mapper and readiness checker.
 */
export interface AetnaProviderData {
  provider: {
    id: string;
    npi: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    dateOfBirth: Date;
    gender: string;
    email: string;
    phone: string;
    fax: string | null;
    providerType: string;
    specialties: string[];
    languages: string[];
    caqhProviderId: string | null;
    acceptingMedicare: boolean;
    acceptingMedicaid: boolean;
    ePrescribing: boolean;
    ssnEncrypted: string | null;
  };
  practice: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
  } | null;
  primaryLocation: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    zipCode: string;
    county: string | null;
    phone: string;
    fax: string | null;
    taxId: string | null;
    groupNpi: string | null;
    acceptingNewPatients: boolean;
    languagesSpoken: string[];
    officeHours: Record<string, unknown> | null;
    billingAddressLine1: string | null;
    billingAddressCity: string | null;
    billingAddressState: string | null;
    billingAddressZipCode: string | null;
  } | null;
  primaryLicense: {
    licenseNumber: string;
    state: string | null;
    expirationDate: Date;
  } | null;
  education: {
    degree: string;
  } | null;
  hospitalAffiliations: Array<{
    facilityName: string;
    privilegeType: string;
    status: string;
  }>;
  submitter: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
}

/** Flat map of formcontrolname → value for each Aetna form page */
export interface AetnaFormPayload {
  gateway: { network: string; category: string; subcategory: string };
  page2: Record<string, string | boolean>;
  page3: Record<string, string | boolean>;
  page4: Record<string, string | boolean>;
  page5: Record<string, string | boolean>;
  page6: Record<string, string | boolean>;
  page7: Record<string, string | boolean>;
  page8: Record<string, string | boolean>;
  page9: Record<string, string | boolean>;
  page10: Record<string, string | boolean>;
}

/** Readiness check result */
export interface ReadinessResult {
  ready: boolean;
  pages: Array<{
    page: number;
    title: string;
    ready: boolean;
    missing: Array<{
      field: string;
      label: string;
      fixPath: string;
    }>;
  }>;
}

/** Run status returned to frontend */
export interface AetnaRunStatusResponse {
  id: string;
  status: string;
  aetnaRequestId: string | null;
  screenshotUrls: string[];
  automationLog: string | null;
  errorMessage: string | null;
  errorPage: number | null;
  startedAt: string | null;
  reviewExpiresAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  confirmationPdfUrl: string | null;
}
```

### Step 2: Write the failing test for the field mapper

Create `packages/backend/src/services/aetna/field-mapper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapProviderToAetnaPayload, mapDegreeToAetna, mapTaxIdType } from './field-mapper.js';
import type { AetnaProviderData } from './types.js';

function makeProviderData(overrides: Partial<AetnaProviderData> = {}): AetnaProviderData {
  return {
    provider: {
      id: 'provider-1',
      npi: '1234567890',
      firstName: 'Jane',
      lastName: 'Doe',
      middleName: 'M',
      dateOfBirth: new Date('1980-05-15'),
      gender: 'female',
      email: 'jane@test.com',
      phone: '555-123-4567',
      fax: '555-123-4568',
      providerType: 'psychiatrist',
      specialties: ['Psychiatry'],
      languages: ['English', 'Spanish'],
      caqhProviderId: 'CAQH-12345',
      acceptingMedicare: true,
      acceptingMedicaid: false,
      ePrescribing: true,
      ssnEncrypted: null,
    },
    practice: {
      id: 'practice-1',
      name: 'Test Practice',
      phone: '555-999-0000',
      email: 'office@test.com',
      website: 'https://testpractice.com',
    },
    primaryLocation: {
      addressLine1: '123 Main St',
      addressLine2: 'Suite 100',
      city: 'Hartford',
      state: 'CT',
      zipCode: '06101',
      county: 'Hartford',
      phone: '555-111-2222',
      fax: '555-111-2223',
      taxId: '12-3456789',
      groupNpi: '9876543210',
      acceptingNewPatients: true,
      languagesSpoken: ['English', 'Spanish'],
      officeHours: null,
      billingAddressLine1: null,
      billingAddressCity: null,
      billingAddressState: null,
      billingAddressZipCode: null,
    },
    primaryLicense: {
      licenseNumber: 'MD-12345',
      state: 'CT',
      expirationDate: new Date('2027-12-31'),
    },
    education: {
      degree: 'md',
    },
    hospitalAffiliations: [
      { facilityName: 'Hartford Hospital', privilegeType: 'admitting', status: 'active' },
    ],
    submitter: {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@test.com',
      phone: '555-000-0000',
    },
    ...overrides,
  };
}

describe('aetna field-mapper', () => {
  describe('mapDegreeToAetna', () => {
    it('maps md to MD', () => expect(mapDegreeToAetna('md')).toBe('MD'));
    it('maps do to DO', () => expect(mapDegreeToAetna('do')).toBe('DO'));
    it('maps phd to PhD', () => expect(mapDegreeToAetna('phd')).toBe('PhD'));
    it('maps psyd to PsyD', () => expect(mapDegreeToAetna('psyd')).toBe('PsyD'));
    it('maps msw to MSW', () => expect(mapDegreeToAetna('msw')).toBe('MSW'));
    it('maps dnp to DNP', () => expect(mapDegreeToAetna('dnp')).toBe('DNP'));
    it('maps msn to MSN', () => expect(mapDegreeToAetna('msn')).toBe('MSN'));
    it('returns uppercase for unknown degrees', () => expect(mapDegreeToAetna('xyz')).toBe('XYZ'));
  });

  describe('mapTaxIdType', () => {
    it('detects EIN format (XX-XXXXXXX)', () => {
      expect(mapTaxIdType('12-3456789')).toBe('E - Employer identification number');
    });
    it('detects SSN format (XXX-XX-XXXX)', () => {
      expect(mapTaxIdType('123-45-6789')).toBe('S - Social Security number');
    });
    it('defaults to EIN for ambiguous format', () => {
      expect(mapTaxIdType('123456789')).toBe('E - Employer identification number');
    });
  });

  describe('mapProviderToAetnaPayload', () => {
    it('maps page 2 submitter info correctly', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);

      expect(payload.page2['lastName']).toBe('User');        // submitter last name
      expect(payload.page2['firstName']).toBe('Admin');       // submitter first name
      expect(payload.page2['email']).toBe('admin@test.com');
      expect(payload.page2['verifyEmail']).toBe('admin@test.com');
      expect(payload.page2['phoneNumber']).toBe('555-000-0000');
      expect(payload.page2['newNpiId']).toBe('1234567890');
      expect(payload.page2['role']).toBe('Credentialing / Enrollment (Director, Manager, Coordinator)');
    });

    it('maps page 3 network/tax info correctly', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);

      expect(payload.page3['practLastName']).toBe('Doe');
      expect(payload.page3['practFirstName']).toBe('Jane');
      expect(payload.page3['npi']).toBe('1234567890');
      expect(payload.page3['state']).toBe('CT');
      expect(payload.page3['zipCode']).toBe('06101');
      expect(payload.page3['taxIdType']).toBe('E - Employer identification number');
      expect(payload.page3['taxIDName']).toBe('Test Practice');
      expect(payload.page3['taxID']).toBe('12-3456789');
      expect(payload.page3['verifyTaxID']).toBe('12-3456789');
    });

    it('maps page 4 degree and specialty', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);

      expect(payload.page4['degreeType']).toBe('MD');
      expect(payload.page4['specialty']).toBe('Psychiatry');
    });

    it('maps page 5 provider details', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);

      expect(payload.page5['lastName']).toBe('Doe');
      expect(payload.page5['firstName']).toBe('Jane');
      expect(payload.page5['middleInitial']).toBe('M');
      expect(payload.page5['dob']).toBe('05/15/1980');
      expect(payload.page5['medicalLicenseNumber']).toBe('MD-12345');
      expect(payload.page5['state']).toBe('CT');
      expect(payload.page5['caqhID']).toBe('CAQH-12345');
      expect(payload.page5['providerURL']).toBe('https://testpractice.com');
    });

    it('maps page 7 practice location', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);

      expect(payload.page7['street']).toBe('123 Main St');
      expect(payload.page7['street2']).toBe('Suite 100');
      expect(payload.page7['city']).toBe('Hartford');
      expect(payload.page7['state']).toBe('CT');
      expect(payload.page7['zipcode']).toBe('06101');
      expect(payload.page7['county']).toBe('Hartford');
      expect(payload.page7['phoneNumber']).toBe('555-111-2222');
      expect(payload.page7['faxNumber']).toBe('555-111-2223');
    });

    it('masks sensitive fields in payload', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);

      // Tax ID in formPayload should be the real value (needed for form fill)
      // but the formPayload stored in DB will be masked separately
      expect(payload.page3['taxID']).toBe('12-3456789');
    });

    it('handles missing optional data gracefully', () => {
      const data = makeProviderData({
        primaryLocation: null,
        primaryLicense: null,
        education: null,
        practice: null,
        hospitalAffiliations: [],
      });
      const payload = mapProviderToAetnaPayload(data);

      // Should not throw — returns empty strings for missing data
      expect(payload.page3['zipCode']).toBe('');
      expect(payload.page5['medicalLicenseNumber']).toBe('');
      expect(payload.page4['degreeType']).toBe('');
    });
  });
});
```

### Step 3: Run test to verify it fails

```bash
npx vitest run src/services/aetna/field-mapper.test.ts
```

Expected: FAIL (module not found)

### Step 4: Implement the field mapper

Create `packages/backend/src/services/aetna/field-mapper.ts`:

```typescript
import type { AetnaProviderData, AetnaFormPayload } from './types.js';

const DEGREE_MAP: Record<string, string> = {
  md: 'MD', do: 'DO', phd: 'PhD', psyd: 'PsyD', msw: 'MSW',
  ma: 'MA', ms: 'MS', med: 'MED', dnp: 'DNP', msn: 'MSN',
  bs: 'BS', ba: 'BA', other: 'Other',
};

export function mapDegreeToAetna(degree: string): string {
  return DEGREE_MAP[degree.toLowerCase()] ?? degree.toUpperCase();
}

export function mapTaxIdType(taxId: string): string {
  // EIN format: XX-XXXXXXX (2 digits, dash, 7 digits)
  if (/^\d{2}-\d{7}$/.test(taxId)) return 'E - Employer identification number';
  // SSN format: XXX-XX-XXXX
  if (/^\d{3}-\d{2}-\d{4}$/.test(taxId)) return 'S - Social Security number';
  // Default to EIN for raw 9-digit or other formats
  return 'E - Employer identification number';
}

function formatDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

function formatLicenseExpiration(date: Date): string {
  return formatDate(date);
}

export function mapProviderToAetnaPayload(data: AetnaProviderData): AetnaFormPayload {
  const { provider, practice, primaryLocation, primaryLicense, education, hospitalAffiliations, submitter } = data;
  const loc = primaryLocation;
  const taxId = loc?.taxId ?? '';

  return {
    gateway: {
      network: 'Aetna',
      category: 'Medical',
      subcategory: 'second_option',
    },

    // Page 2: Submitter Information
    page2: {
      lastName: submitter.lastName,
      firstName: submitter.firstName,
      role: 'Credentialing / Enrollment (Director, Manager, Coordinator)',
      email: submitter.email,
      verifyEmail: submitter.email,
      phoneNumber: submitter.phone,
      ext: '',
      faxNumber: provider.fax ?? '',
      newNpiId: provider.npi,
      emailAcknowledgement: 'Agree',
      checkboxSelect: 'true',
    },

    // Page 3: Network & Tax Information
    page3: {
      existingAetnaProvider: 'No',
      networkJoining: 'As an individual provider joining an existing group practice',
      applicableSituation: 'I want to be contracted in the state selected below',
      state: loc?.state ?? '',
      zipCode: loc?.zipCode ?? '',
      ext: '',
      taxIdType: taxId ? mapTaxIdType(taxId) : '',
      taxIDName: practice?.name ?? '',
      taxID: taxId,
      verifyTaxID: taxId,
      practLastName: provider.lastName,
      practFirstName: provider.firstName,
      npi: provider.npi,
      checkboxSelect: 'true',
    },

    // Page 4: Degree & Specialty
    page4: {
      degreeType: education?.degree ? mapDegreeToAetna(education.degree) : '',
      specialty: provider.specialties[0] ?? '',
      providerClassification: 'Specialist',
      checkboxSelect: 'true',
    },

    // Page 5: Provider Details & Credentials
    page5: {
      lastName: provider.lastName,
      firstName: provider.firstName,
      middleInitial: provider.middleName ?? '',
      dob: formatDate(provider.dateOfBirth),
      state: primaryLicense?.state ?? '',
      medicalLicenseNumber: primaryLicense?.licenseNumber ?? '',
      medLicenseExpDate: primaryLicense ? formatLicenseExpiration(primaryLicense.expirationDate) : '',
      caqhID: provider.caqhProviderId ?? '',
      providerURL: practice?.website ?? '',
      acceptingNewPatients: loc?.acceptingNewPatients ? 'Yes' : 'No',
      electronicPrescribing: provider.ePrescribing ? 'Yes' : 'No',
    },

    // Page 6: Contact Preferences
    page6: {
      contractingContact: 'Submitter',
      preferredContactMethod: 'Email',
      authorizedContact: 'Submitter',
    },

    // Page 7: Primary Practice Location
    page7: {
      street: loc?.addressLine1 ?? '',
      street2: loc?.addressLine2 ?? '',
      city: loc?.city ?? '',
      state: loc?.state ?? '',
      zipcode: loc?.zipCode ?? '',
      ext: '',
      county: loc?.county ?? '',
      phoneNumber: loc?.phone ?? '',
      phoneExt: '',
      faxNumber: loc?.fax ?? '',
      languages: (loc?.languagesSpoken ?? []).join(', '),
      workingDays: 'WEEKDAYS ONLY (MONDAY-FRIDAY)',
      otherTelehealth: '',
      checkboxAttest: 'true',
    },

    // Page 8: Mailing & Billing Addresses
    page8: {
      mailingAddress: 'Same as primary address',
      billingAddress: loc?.billingAddressLine1
        ? 'New billing address'
        : 'Same as primary address',
      ...(loc?.billingAddressLine1 ? {
        billingStreet: loc.billingAddressLine1,
        billingCity: loc.billingAddressCity ?? '',
        billingState: loc.billingAddressState ?? '',
        billingZipCode: loc.billingAddressZipCode ?? '',
      } : {}),
    },

    // Page 9: Hospital Privileges & Attachments
    page9: {
      hospitalPrivileges: hospitalAffiliations.some(a => a.privilegeType === 'admitting' && a.status === 'active') ? 'Yes' : 'No',
      facilityBased: 'No',
    },

    // Page 10: Additional Questions & Final Review
    page10: {
      medicareCertified: provider.acceptingMedicare ? 'Yes' : 'No',
      medicaidCertified: provider.acceptingMedicaid ? 'Yes' : 'No',
      aetnaEAPProgram: 'No',
      americanSignLanguage: 'No',
    },
  };
}

/**
 * Mask sensitive fields for storage in formPayload.
 * Real values are used during form fill; masked values are persisted.
 */
export function maskSensitivePayload(payload: AetnaFormPayload): AetnaFormPayload {
  const masked = JSON.parse(JSON.stringify(payload)) as AetnaFormPayload;
  if (masked.page3['taxID']) {
    const raw = masked.page3['taxID'] as string;
    masked.page3['taxID'] = `***-***-${raw.slice(-4)}`;
    masked.page3['verifyTaxID'] = masked.page3['taxID'];
  }
  return masked;
}
```

### Step 5: Run tests

```bash
npx vitest run src/services/aetna/field-mapper.test.ts
```

Expected: All tests PASS.

### Step 6: Commit

```bash
git add packages/backend/src/services/aetna/
git commit -m "feat: add Aetna field mapper with degree/tax-id translation and per-page payload"
```

---

## Task 3: Aetna Readiness Check Service

Pure validation — checks if a provider has all required data for Aetna enrollment.

**Files:**
- Create: `packages/backend/src/services/aetna/readiness.service.ts`
- Create: `packages/backend/src/services/aetna/readiness.service.test.ts`

### Step 1: Write the failing test

Create `packages/backend/src/services/aetna/readiness.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { checkAetnaReadiness } from './readiness.service.js';
import { prismaMock } from '../../../tests/helpers/mock-prisma.js';

function makeFullProvider() {
  return {
    id: 'provider-1',
    npi: '1234567890',
    firstName: 'Jane',
    lastName: 'Doe',
    middleName: 'M',
    dateOfBirth: new Date('1980-05-15'),
    gender: 'female',
    email: 'jane@test.com',
    phone: '555-123-4567',
    fax: '555-123-4568',
    providerType: 'psychiatrist',
    specialties: ['Psychiatry'],
    languages: ['English'],
    caqhProviderId: 'CAQH-12345',
    acceptingMedicare: true,
    acceptingMedicaid: false,
    ePrescribing: true,
    practiceId: 'practice-1',
    practice: { id: 'practice-1', name: 'Test Practice', phone: '555-999-0000', email: 'office@test.com', website: 'https://test.com' },
    practiceLocations: [{
      isPrimary: true,
      isActive: true,
      addressLine1: '123 Main St',
      addressLine2: null,
      city: 'Hartford',
      state: 'CT',
      zipCode: '06101',
      county: 'Hartford',
      phone: '555-111-2222',
      fax: '555-111-2223',
      taxId: '12-3456789',
      groupNpi: '9876543210',
      acceptingNewPatients: true,
      languagesSpoken: ['English'],
      officeHours: null,
      billingAddressLine1: null,
      billingAddressCity: null,
      billingAddressState: null,
      billingAddressZipCode: null,
    }],
    licenses: [{ licenseType: 'state_medical', licenseNumber: 'MD-12345', state: 'CT', expirationDate: new Date('2027-12-31'), status: 'active' }],
    educations: [{ degree: 'md', educationType: 'MEDICAL_SCHOOL' }],
    hospitalAffiliations: [{ facilityName: 'Hartford Hospital', privilegeType: 'admitting', status: 'active' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkAetnaReadiness', () => {
  it('returns ready=true when all required fields are present', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(makeFullProvider() as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(true);
    expect(result.pages.every(p => p.ready)).toBe(true);
  });

  it('returns ready=false when NPI is missing', async () => {
    const provider = makeFullProvider();
    provider.npi = '';
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page2 = result.pages.find(p => p.page === 2)!;
    expect(page2.ready).toBe(false);
    expect(page2.missing.some(m => m.field === 'npi')).toBe(true);
  });

  it('returns ready=false when primary location is missing', async () => {
    const provider = makeFullProvider();
    provider.practiceLocations = [];
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page7 = result.pages.find(p => p.page === 7)!;
    expect(page7.ready).toBe(false);
  });

  it('returns ready=false when no active license exists', async () => {
    const provider = makeFullProvider();
    provider.licenses = [];
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page5 = result.pages.find(p => p.page === 5)!;
    expect(page5.missing.some(m => m.field === 'medicalLicenseNumber')).toBe(true);
  });

  it('returns ready=false when CAQH ID is missing', async () => {
    const provider = makeFullProvider();
    provider.caqhProviderId = null;
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page5 = result.pages.find(p => p.page === 5)!;
    expect(page5.missing.some(m => m.field === 'caqhID')).toBe(true);
  });

  it('returns ready=false when tax ID is missing from primary location', async () => {
    const provider = makeFullProvider();
    provider.practiceLocations[0]!.taxId = null;
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page3 = result.pages.find(p => p.page === 3)!;
    expect(page3.missing.some(m => m.field === 'taxID')).toBe(true);
  });

  it('returns ready=false when education/degree is missing', async () => {
    const provider = makeFullProvider();
    provider.educations = [];
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page4 = result.pages.find(p => p.page === 4)!;
    expect(page4.missing.some(m => m.field === 'degreeType')).toBe(true);
  });

  it('includes fixPath for each missing field', async () => {
    const provider = makeFullProvider();
    provider.caqhProviderId = null;
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    const missing = result.pages.flatMap(p => p.missing);
    const caqhMissing = missing.find(m => m.field === 'caqhID');
    expect(caqhMissing?.fixPath).toContain('/providers/provider-1');
  });

  it('throws when provider not found', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(null);

    await expect(checkAetnaReadiness('nonexistent')).rejects.toThrow('Provider not found');
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run src/services/aetna/readiness.service.test.ts
```

### Step 3: Implement the readiness service

Create `packages/backend/src/services/aetna/readiness.service.ts`:

```typescript
import { prisma } from '../../utils/prisma.js';
import type { ReadinessResult } from './types.js';

interface MissingField {
  field: string;
  label: string;
  fixPath: string;
}

function check(condition: boolean, field: string, label: string, fixPath: string, missing: MissingField[]): void {
  if (!condition) missing.push({ field, label, fixPath });
}

export async function checkAetnaReadiness(providerId: string): Promise<ReadinessResult> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    include: {
      practice: true,
      practiceLocations: { where: { isPrimary: true, isActive: true }, take: 1 },
      licenses: { where: { status: 'active' }, orderBy: { expirationDate: 'desc' }, take: 1 },
      educations: { orderBy: { graduationDate: 'desc' }, take: 1 },
      hospitalAffiliations: { where: { status: 'active' } },
    },
  });

  if (!provider) throw new Error('Provider not found');

  const basePath = `/providers/${providerId}`;
  const loc = provider.practiceLocations[0] ?? null;
  const license = provider.licenses[0] ?? null;
  const edu = provider.educations[0] ?? null;

  // Page 2: Submitter Info — submitter is the logged-in user, always available.
  // Only provider NPI is needed from our data.
  const page2Missing: MissingField[] = [];
  check(!!provider.npi, 'npi', 'Individual Type 1 NPI #', basePath, page2Missing);

  // Page 3: Network & Tax Information
  const page3Missing: MissingField[] = [];
  check(!!loc?.state, 'state', 'Applying State', `${basePath}#locations`, page3Missing);
  check(!!loc?.zipCode, 'zipCode', 'Primary Location Zip Code', `${basePath}#locations`, page3Missing);
  check(!!loc?.taxId, 'taxID', 'Tax ID (TIN/EIN)', `${basePath}#locations`, page3Missing);
  check(!!provider.practice?.name, 'taxIDName', 'Tax ID Name (Practice Name)', `${basePath}#practice`, page3Missing);

  // Page 4: Degree & Specialty
  const page4Missing: MissingField[] = [];
  check(!!edu?.degree, 'degreeType', 'Degree Type', `${basePath}#education`, page4Missing);
  check(provider.specialties.length > 0, 'specialty', 'Primary Specialty', basePath, page4Missing);

  // Page 5: Provider Details & Credentials
  const page5Missing: MissingField[] = [];
  check(!!provider.firstName, 'firstName', 'Provider First Name', basePath, page5Missing);
  check(!!provider.lastName, 'lastName', 'Provider Last Name', basePath, page5Missing);
  check(!!provider.dateOfBirth, 'dob', 'Date of Birth', basePath, page5Missing);
  check(!!license?.licenseNumber, 'medicalLicenseNumber', 'Medical License Number', `${basePath}#licenses`, page5Missing);
  check(!!license?.state, 'licenseState', 'License State', `${basePath}#licenses`, page5Missing);
  check(!!provider.caqhProviderId, 'caqhID', 'CAQH Provider ID', basePath, page5Missing);

  // Page 6: Contact — uses submitter info, always available
  const page6Missing: MissingField[] = [];

  // Page 7: Primary Practice Location
  const page7Missing: MissingField[] = [];
  check(!!loc, 'primaryLocation', 'Primary Practice Location', `${basePath}#locations`, page7Missing);
  if (loc) {
    check(!!loc.addressLine1, 'street', 'Street Address', `${basePath}#locations`, page7Missing);
    check(!!loc.city, 'city', 'City', `${basePath}#locations`, page7Missing);
    check(!!loc.state, 'state', 'State', `${basePath}#locations`, page7Missing);
    check(!!loc.zipCode, 'zipcode', 'Zip Code', `${basePath}#locations`, page7Missing);
    check(!!loc.county, 'county', 'County', `${basePath}#locations`, page7Missing);
    check(!!loc.phone, 'phoneNumber', 'Phone Number', `${basePath}#locations`, page7Missing);
    check(!!loc.fax, 'faxNumber', 'Fax Number', `${basePath}#locations`, page7Missing);
  }

  // Page 8: Mailing & Billing — defaults to "same as primary", no required data
  const page8Missing: MissingField[] = [];

  // Page 9: Hospital Privileges — just needs yes/no, data optional
  const page9Missing: MissingField[] = [];

  // Page 10: Additional Questions — just needs yes/no selections, all have defaults
  const page10Missing: MissingField[] = [];

  const pages = [
    { page: 2, title: 'Submitter Information', ready: page2Missing.length === 0, missing: page2Missing },
    { page: 3, title: 'Network & Tax Information', ready: page3Missing.length === 0, missing: page3Missing },
    { page: 4, title: 'Degree & Specialty', ready: page4Missing.length === 0, missing: page4Missing },
    { page: 5, title: 'Provider Details & Credentials', ready: page5Missing.length === 0, missing: page5Missing },
    { page: 6, title: 'Contact Preferences', ready: page6Missing.length === 0, missing: page6Missing },
    { page: 7, title: 'Primary Practice Location', ready: page7Missing.length === 0, missing: page7Missing },
    { page: 8, title: 'Mailing & Billing Addresses', ready: page8Missing.length === 0, missing: page8Missing },
    { page: 9, title: 'Hospital Privileges & Attachments', ready: page9Missing.length === 0, missing: page9Missing },
    { page: 10, title: 'Additional Questions & Final Review', ready: page10Missing.length === 0, missing: page10Missing },
  ];

  return {
    ready: pages.every(p => p.ready),
    pages,
  };
}
```

### Step 4: Run tests

```bash
npx vitest run src/services/aetna/readiness.service.test.ts
```

Expected: All tests PASS.

### Step 5: Commit

```bash
git add packages/backend/src/services/aetna/readiness*
git commit -m "feat: add Aetna readiness check service with per-page field validation"
```

---

## Task 4: Aetna API Routes

Routes for readiness check, start enrollment, get status, approve, reject, retry.

**Files:**
- Create: `packages/backend/src/routes/aetna.routes.ts`
- Modify: `packages/backend/src/routes/index.ts` (or wherever routes are mounted)

### Step 1: Find where routes are mounted

Check how `enrollment.routes.ts` is mounted in the main app. Look at `src/index.ts` or `src/app.ts` for the `app.use()` calls. The new Aetna routes should be nested under enrollments.

### Step 2: Create the route file

Create `packages/backend/src/routes/aetna.routes.ts`:

```typescript
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { checkAetnaReadiness } from '../services/aetna/readiness.service.js';

export const aetnaRoutes = Router({ mergeParams: true });

// All routes require auth + staff role
aetnaRoutes.use(authenticate);
aetnaRoutes.use(authorize('admin', 'credentialing_staff', 'practice_admin'));

// POST /api/v1/enrollments/:enrollmentId/aetna/readiness
aetnaRoutes.post('/readiness', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enrollmentId } = req.params;

    const enrollment = await prisma.payerEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { payer: true },
    });

    if (!enrollment) {
      return res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
    }

    const result = await checkAetnaReadiness(enrollment.providerId);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/enrollments/:enrollmentId/aetna/start
aetnaRoutes.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enrollmentId } = req.params;
    const userId = req.user!.id;

    const enrollment = await prisma.payerEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      return res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
    }

    // Check for existing active run
    const activeRun = await prisma.aetnaEnrollmentRun.findFirst({
      where: {
        payerEnrollmentId: enrollmentId,
        status: { in: ['pending', 'filling', 'awaiting_review', 'submitting'] },
      },
    });

    if (activeRun) {
      return res.status(409).json({
        success: false,
        error: { message: 'An active enrollment run already exists', data: { runId: activeRun.id } },
      });
    }

    // Check readiness first
    const readiness = await checkAetnaReadiness(enrollment.providerId);
    if (!readiness.ready) {
      return res.status(400).json({
        success: false,
        error: { message: 'Provider data is not complete for Aetna enrollment', data: readiness },
      });
    }

    // Create the run record
    const run = await prisma.aetnaEnrollmentRun.create({
      data: {
        payerEnrollmentId: enrollmentId,
        status: 'pending',
        formPayload: {},
        initiatedById: userId,
      },
    });

    // TODO: Task 5 will add the actual form filler launch here
    // For now, return the run ID so the frontend can poll status
    logger.info(`Aetna enrollment run ${run.id} created for enrollment ${enrollmentId}`);

    res.status(201).json({ success: true, data: { runId: run.id, status: run.status } });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/enrollments/:enrollmentId/aetna/runs/:runId
aetnaRoutes.get('/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runId } = req.params;

    const run = await prisma.aetnaEnrollmentRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return res.status(404).json({ success: false, error: { message: 'Run not found' } });
    }

    // TODO: Task 5 will generate signed URLs for screenshots here
    res.json({
      success: true,
      data: {
        id: run.id,
        status: run.status,
        aetnaRequestId: run.aetnaRequestId,
        screenshotDocIds: run.screenshotDocIds,
        screenshotUrls: [], // Will be populated in Task 5
        automationLog: run.automationLog,
        errorMessage: run.errorMessage,
        errorPage: run.errorPage,
        startedAt: run.startedAt,
        reviewExpiresAt: run.reviewExpiresAt,
        submittedAt: run.submittedAt,
        completedAt: run.completedAt,
        confirmationPdfUrl: null, // Will be populated in Task 5
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/enrollments/:enrollmentId/aetna/runs/:runId/approve
aetnaRoutes.post('/runs/:runId/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runId } = req.params;

    const run = await prisma.aetnaEnrollmentRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return res.status(404).json({ success: false, error: { message: 'Run not found' } });
    }

    if (run.status !== 'awaiting_review') {
      return res.status(400).json({
        success: false,
        error: { message: `Cannot approve run in status: ${run.status}` },
      });
    }

    if (run.reviewExpiresAt && new Date() > run.reviewExpiresAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'Review window has expired. Please start a new enrollment run.' },
      });
    }

    // TODO: Task 5 will trigger Playwright final submit here
    const updated = await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: { status: 'submitting' },
    });

    res.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/enrollments/:enrollmentId/aetna/runs/:runId/reject
aetnaRoutes.post('/runs/:runId/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runId } = req.params;

    const run = await prisma.aetnaEnrollmentRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return res.status(404).json({ success: false, error: { message: 'Run not found' } });
    }

    if (!['awaiting_review', 'filling', 'pending'].includes(run.status)) {
      return res.status(400).json({
        success: false,
        error: { message: `Cannot reject run in status: ${run.status}` },
      });
    }

    // TODO: Task 5 will close the held Playwright browser here
    const updated = await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: { status: 'rejected', completedAt: new Date() },
    });

    res.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/enrollments/:enrollmentId/aetna/runs/:runId/retry
aetnaRoutes.post('/runs/:runId/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { runId } = req.params;

    const run = await prisma.aetnaEnrollmentRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return res.status(404).json({ success: false, error: { message: 'Run not found' } });
    }

    if (!['failed', 'timed_out'].includes(run.status)) {
      return res.status(400).json({
        success: false,
        error: { message: `Cannot retry run in status: ${run.status}` },
      });
    }

    // Reset the run
    const updated = await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'pending',
        errorMessage: null,
        errorPage: null,
        automationLog: null,
        screenshotDocIds: [],
        startedAt: null,
        reviewExpiresAt: null,
        submittedAt: null,
        completedAt: null,
      },
    });

    // TODO: Task 5 will re-launch the form filler here
    res.json({ success: true, data: { id: updated.id, status: updated.status } });
  } catch (error) {
    next(error);
  }
});
```

### Step 3: Mount the routes

Find the main route mounting file. The Aetna routes need to be nested under the enrollment router. In the file where enrollment routes are mounted (likely `src/index.ts` or `src/app.ts`), add:

```typescript
import { aetnaRoutes } from './routes/aetna.routes.js';

// Mount under enrollments
app.use('/api/v1/enrollments/:enrollmentId/aetna', aetnaRoutes);
```

### Step 4: Run existing tests to verify no regressions

```bash
npx vitest run
```

### Step 5: Commit

```bash
git add packages/backend/src/routes/aetna.routes.ts packages/backend/src/index.ts
git commit -m "feat: add Aetna enrollment API routes (readiness, start, status, approve, reject, retry)"
```

---

## Task 5: Playwright Form Filler + Enrollment Orchestrator

The core automation — launches Playwright, fills 10 pages, screenshots each, holds browser for review.

**Files:**
- Create: `packages/backend/src/services/aetna/form-filler.ts`
- Create: `packages/backend/src/services/aetna/enrollment.service.ts`
- Create: `packages/backend/src/services/aetna/browser-pool.ts`
- Modify: `packages/backend/src/routes/aetna.routes.ts` (wire up orchestrator)

### Step 1: Install Playwright

```bash
cd packages/backend
npm install playwright
npx playwright install chromium
```

**Note:** On Render, Playwright Chromium must be installed at build time. Add to the Render build command:
```
npx playwright install chromium --with-deps
```

### Step 2: Create the browser pool (concurrency guard)

Create `packages/backend/src/services/aetna/browser-pool.ts`:

```typescript
import { logger } from '../../utils/logger.js';
import type { Browser, Page } from 'playwright';

/**
 * Manages held browser sessions for the review-then-submit flow.
 * Key: runId, Value: { browser, page, timeoutId }
 */
interface HeldSession {
  browser: Browser;
  page: Page;
  timeoutId: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, HeldSession>();
let activeBrowserCount = 0;
const MAX_CONCURRENT = 1;
const REVIEW_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function getActiveCount(): number {
  return activeBrowserCount;
}

export function canLaunch(): boolean {
  return activeBrowserCount < MAX_CONCURRENT;
}

export function holdSession(
  runId: string,
  browser: Browser,
  page: Page,
  onTimeout: () => Promise<void>,
): void {
  activeBrowserCount++;
  const timeoutId = setTimeout(async () => {
    logger.warn(`Aetna run ${runId} review timed out after 30 minutes`);
    await onTimeout();
    releaseSession(runId);
  }, REVIEW_TIMEOUT_MS);

  sessions.set(runId, { browser, page, timeoutId });
}

export function getSession(runId: string): { browser: Browser; page: Page } | null {
  const session = sessions.get(runId);
  if (!session) return null;
  return { browser: session.browser, page: session.page };
}

export async function releaseSession(runId: string): Promise<void> {
  const session = sessions.get(runId);
  if (!session) return;

  clearTimeout(session.timeoutId);
  sessions.delete(runId);
  activeBrowserCount--;

  try {
    await session.browser.close();
  } catch (err) {
    logger.error(`Error closing browser for run ${runId}`, err);
  }
}
```

### Step 3: Create the form filler

Create `packages/backend/src/services/aetna/form-filler.ts`. This file contains one function per form page. It reads the field values from the `AetnaFormPayload` and fills them using Playwright selectors.

```typescript
import type { Page } from 'playwright';
import type { AetnaFormPayload } from './types.js';
import { logger } from '../../utils/logger.js';

const FORM_URL = 'https://extaz-oci.aetna.com/pocui/join-the-aetna-network';

interface FillResult {
  requestId: string | null;
  screenshots: Buffer[];
  log: string[];
}

function log(lines: string[], msg: string): void {
  const ts = new Date().toISOString();
  lines.push(`[${ts}] ${msg}`);
  logger.info(`[aetna-filler] ${msg}`);
}

async function fillInput(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.clear();
  await locator.fill(value);
}

async function selectDropdown(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.selectOption({ label: value });
}

async function clickRadio(page: Page, id: string): Promise<void> {
  const label = page.locator(`label[for="${id}"]`);
  await label.waitFor({ state: 'visible', timeout: 10000 });
  await label.click();
}

async function clickCheckbox(page: Page, formcontrol: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  if (!(await locator.isChecked())) {
    await locator.click();
  }
}

async function clickNextButton(page: Page): Promise<void> {
  // Aetna uses mat-raised-button with text "Next" or similar
  const next = page.locator('button:has-text("Next"), button:has-text("NEXT"), button:has-text("Continue")').first();
  await next.waitFor({ state: 'visible', timeout: 10000 });
  await next.click();
}

async function screenshotPage(page: Page): Promise<Buffer> {
  await page.waitForTimeout(500); // Let Angular finish rendering
  return await page.screenshot({ fullPage: true, type: 'png' });
}

// ---- Page fillers ----

async function fillGateway(page: Page, _payload: AetnaFormPayload, lines: string[]): Promise<void> {
  log(lines, 'Navigating to Aetna form');
  await page.goto(FORM_URL, { waitUntil: 'networkidle' });

  log(lines, 'Filling gateway dropdowns');
  // Three cascading dropdowns — select in sequence
  const firstDropdown = page.locator('mat-select').first();
  await firstDropdown.click();
  await page.locator('mat-option:has-text("Aetna")').click();
  await page.waitForTimeout(500);

  const secondDropdown = page.locator('mat-select').nth(1);
  await secondDropdown.click();
  await page.locator('mat-option:has-text("Medical")').click();
  await page.waitForTimeout(500);

  const thirdDropdown = page.locator('mat-select').nth(2);
  await thirdDropdown.click();
  // Select second option in third dropdown
  await page.locator('mat-option').nth(1).click();
  await page.waitForTimeout(1000);
  log(lines, 'Gateway selections complete');
}

async function fillPage2(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 2: Submitter Information');
  const p = payload.page2;

  await fillInput(page, 'lastName', p['lastName'] as string);
  await fillInput(page, 'firstName', p['firstName'] as string);
  await selectDropdown(page, 'role', p['role'] as string);
  await fillInput(page, 'email', p['email'] as string);
  await fillInput(page, 'verifyEmail', p['verifyEmail'] as string);
  await fillInput(page, 'phoneNumber', p['phoneNumber'] as string);
  await fillInput(page, 'newNpiId', p['newNpiId'] as string);

  // Email acknowledgement: click the link first, then select Agree
  log(lines, 'Handling email acknowledgement');
  const ackLink = page.locator('a:has-text("EMAIL ACKNOWLEDGEMENT"), a:has-text("email acknowledgement")').first();
  if (await ackLink.isVisible()) {
    await ackLink.click();
    await page.waitForTimeout(500);
  }
  await clickRadio(page, 'agree-input');
  await clickCheckbox(page, 'checkboxSelect');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);

  log(lines, 'Page 2 complete');
  return screenshot;
}

async function fillPage3(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<{ screenshot: Buffer; requestId: string | null }> {
  log(lines, 'Filling Page 3: Network & Tax Information');
  const p = payload.page3;

  // Existing Aetna provider? radio
  const isExisting = p['existingAetnaProvider'] as string;
  await clickRadio(page, isExisting === 'Yes' ? 'Yes-input' : 'No-input');

  await selectDropdown(page, 'networkJoining', p['networkJoining'] as string);
  await selectDropdown(page, 'applicableSituation', p['applicableSituation'] as string);
  await selectDropdown(page, 'state', p['state'] as string);
  await fillInput(page, 'zipCode', p['zipCode'] as string);
  await selectDropdown(page, 'taxIdType', p['taxIdType'] as string);
  await fillInput(page, 'taxIDName', p['taxIDName'] as string);
  await fillInput(page, 'taxID', p['taxID'] as string);
  await fillInput(page, 'verifyTaxID', p['verifyTaxID'] as string);
  await fillInput(page, 'practLastName', p['practLastName'] as string);
  await fillInput(page, 'practFirstName', p['practFirstName'] as string);
  await fillInput(page, 'npi', p['npi'] as string);
  await clickCheckbox(page, 'checkboxSelect');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(2000); // Wait for Request ID to populate

  // Capture the Request ID from the page after submit
  let requestId: string | null = null;
  try {
    const requestIdEl = page.locator('text=/Request ID/i').first();
    if (await requestIdEl.isVisible()) {
      const text = await requestIdEl.textContent();
      const match = text?.match(/Request ID[:\s]*([A-Z0-9-]+)/i);
      if (match) requestId = match[1] ?? null;
    }
    // Fallback: look for the value in a span or heading near "Request ID"
    if (!requestId) {
      const idSpan = page.locator('[class*="request-id"], [data-testid*="request"]').first();
      if (await idSpan.isVisible()) {
        requestId = (await idSpan.textContent())?.trim() ?? null;
      }
    }
  } catch {
    log(lines, 'Warning: Could not capture Request ID from page 3');
  }

  log(lines, `Page 3 complete. Request ID: ${requestId ?? 'not captured'}`);
  return { screenshot, requestId };
}

async function fillPage4(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 4: Degree & Specialty');
  const p = payload.page4;

  await selectDropdown(page, 'degreeType', p['degreeType'] as string);
  await page.waitForTimeout(1000); // Wait for specialty dropdown to populate based on degree

  await selectDropdown(page, 'specialty', p['specialty'] as string);

  // Provider classification radio — click Specialist
  await clickRadio(page, 'Specialist-input');
  await clickCheckbox(page, 'checkboxSelect');

  const screenshot = await screenshotPage(page);

  // Page 4 uses a hyperlink (not button) to proceed
  log(lines, 'Clicking hyperlink to proceed from Page 4');
  const continueLink = page.locator('a:has-text("Continue"), a:has-text("Next"), a:has-text("click here")').first();
  await continueLink.click();

  // Dismiss "Credentialing with CAQH" popup
  await page.waitForTimeout(1000);
  const ackButton = page.locator('button:has-text("Acknowledge"), button:has-text("Continue")').first();
  if (await ackButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    log(lines, 'Dismissing CAQH credentialing popup');
    await ackButton.click();
  }

  await page.waitForTimeout(1000);
  log(lines, 'Page 4 complete');
  return screenshot;
}

async function fillPage5(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 5: Provider Details & Credentials');
  const p = payload.page5;

  await fillInput(page, 'lastName', p['lastName'] as string);
  await fillInput(page, 'firstName', p['firstName'] as string);
  if (p['middleInitial']) await fillInput(page, 'middleInitial', p['middleInitial'] as string);
  await fillInput(page, 'dob', p['dob'] as string);
  await selectDropdown(page, 'state', p['state'] as string);
  await fillInput(page, 'medicalLicenseNumber', p['medicalLicenseNumber'] as string);
  await fillInput(page, 'medLicenseExpDate', p['medLicenseExpDate'] as string);
  await fillInput(page, 'caqhID', p['caqhID'] as string);
  if (p['providerURL']) await fillInput(page, 'providerURL', p['providerURL'] as string);

  // Accepting new patients radio
  const accepting = p['acceptingNewPatients'] as string;
  await clickRadio(page, accepting === 'Yes' ? 'Yes-input' : 'mat-radio-20-input');

  // Electronic prescribing radio
  const ePrescribing = p['electronicPrescribing'] as string;
  await clickRadio(page, ePrescribing === 'Yes' ? 'electronicPrescribingYes-input' : 'electronicPrescribingNo-input');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 5 complete');
  return screenshot;
}

async function fillPage6(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 6: Contact Preferences');
  const p = payload.page6;

  // Contracting contact
  await clickRadio(page, `${p['contractingContact']}-input`);

  // Preferred contact method
  const method = p['preferredContactMethod'] as string;
  if (method === 'Email') await page.locator('#EmailSub').check();
  else if (method === 'Phone') await page.locator('#PhoneSub').check();
  else if (method === 'Fax') await page.locator('#FaxSub').check();

  // Authorized contact
  await clickRadio(page, `auth_${p['authorizedContact']}-input`);

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 6 complete');
  return screenshot;
}

async function fillPage7(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 7: Primary Practice Location');
  const p = payload.page7;

  await fillInput(page, 'street', p['street'] as string);
  if (p['street2']) await fillInput(page, 'street2', p['street2'] as string);
  await fillInput(page, 'city', p['city'] as string);
  await fillInput(page, 'state', p['state'] as string);
  await fillInput(page, 'zipcode', p['zipcode'] as string);
  await fillInput(page, 'county', p['county'] as string);
  await fillInput(page, 'phoneNumber', p['phoneNumber'] as string);
  await fillInput(page, 'faxNumber', p['faxNumber'] as string);

  // Languages — Material chip input
  const languages = (p['languages'] as string).split(', ').filter(Boolean);
  if (languages.length > 0) {
    const chipInput = page.locator('#mat-chip-list-input-2');
    for (const lang of languages) {
      await chipInput.fill(lang);
      await chipInput.press('Enter');
      await page.waitForTimeout(200);
    }
  }

  if (p['workingDays']) await selectDropdown(page, 'workingDays', p['workingDays'] as string);
  await clickCheckbox(page, 'checkboxAttest');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 7 complete');
  return screenshot;
}

async function fillPage8(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 8: Mailing & Billing Addresses');
  const p = payload.page8;

  // Mailing address
  await clickRadio(page, `${p['mailingAddress']}-input`);

  // Billing address
  await clickRadio(page, `${p['billingAddress']}-input`);

  // If new billing address, fill the additional fields
  if (p['billingAddress'] === 'New billing address' && p['billingStreet']) {
    await fillInput(page, 'billingStreet', p['billingStreet'] as string);
    await fillInput(page, 'billingCity', p['billingCity'] as string);
    await fillInput(page, 'billingState', p['billingState'] as string);
    await fillInput(page, 'billingZipCode', p['billingZipCode'] as string);
  }

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 8 complete');
  return screenshot;
}

async function fillPage9(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 9: Hospital Privileges & Attachments');
  const p = payload.page9;

  const hasPrivileges = p['hospitalPrivileges'] as string;
  await clickRadio(page, hasPrivileges === 'Yes' ? 'privilegeYes-input' : 'privilegeNo-input');

  const facilityBased = p['facilityBased'] as string;
  await clickRadio(page, facilityBased === 'Yes' ? 'facilityYes-input' : 'facilityNo-input');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 9 complete');
  return screenshot;
}

async function fillPage10(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 10: Additional Questions (WILL NOT SUBMIT)');
  const p = payload.page10;

  const medicare = p['medicareCertified'] as string;
  await clickRadio(page, medicare === 'Yes' ? 'medicareCertifiedYes-input' : 'medicareCertifiedNo-input');

  const medicaid = p['medicaidCertified'] as string;
  await clickRadio(page, medicaid === 'Yes' ? 'medicadCertifiedYes-input' : 'medicadCertifiedNo-input');

  const eap = p['aetnaEAPProgram'] as string;
  await clickRadio(page, eap === 'Yes' ? 'aetnaEAPProgramYes-input' : 'aetnaEAPProgramNo-input');

  const asl = p['americanSignLanguage'] as string;
  await clickRadio(page, asl === 'Yes' ? 'americanSignLangYes-input' : 'americanSignLangNo-input');

  const screenshot = await screenshotPage(page);

  // DO NOT click submit — hold here for human review
  log(lines, 'Page 10 filled. HOLDING FOR HUMAN REVIEW — submit button NOT clicked.');
  return screenshot;
}

/**
 * Submit the final form — called only after human approval.
 */
export async function submitFinalPage(page: Page): Promise<Buffer> {
  // Click the submit button inside the review popup
  const submitButton = page.locator('button:has-text("Submit Request for Participation")').first();
  await submitButton.waitFor({ state: 'visible', timeout: 10000 });
  await submitButton.click();
  await page.waitForTimeout(3000); // Wait for confirmation

  return await screenshotPage(page);
}

/**
 * Fill all pages of the Aetna enrollment form.
 * Returns screenshots, request ID, and log.
 * Does NOT submit — browser is held for review.
 */
export async function fillAetnaForm(page: Page, payload: AetnaFormPayload): Promise<FillResult> {
  const lines: string[] = [];
  const screenshots: Buffer[] = [];

  try {
    await fillGateway(page, payload, lines);

    screenshots.push(await fillPage2(page, payload, lines));

    const page3Result = await fillPage3(page, payload, lines);
    screenshots.push(page3Result.screenshot);

    screenshots.push(await fillPage4(page, payload, lines));
    screenshots.push(await fillPage5(page, payload, lines));
    screenshots.push(await fillPage6(page, payload, lines));
    screenshots.push(await fillPage7(page, payload, lines));
    screenshots.push(await fillPage8(page, payload, lines));
    screenshots.push(await fillPage9(page, payload, lines));
    screenshots.push(await fillPage10(page, payload, lines));

    return { requestId: page3Result.requestId, screenshots, log: lines };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(lines, `ERROR: ${msg}`);
    // Take error screenshot
    try { screenshots.push(await screenshotPage(page)); } catch { /* ignore */ }
    throw Object.assign(error as Error, { automationLog: lines.join('\n'), screenshots });
  }
}
```

### Step 4: Create the enrollment orchestrator

Create `packages/backend/src/services/aetna/enrollment.service.ts`:

```typescript
import { chromium } from 'playwright';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { DocumentService } from '../document.service.js';
import { fillAetnaForm, submitFinalPage } from './form-filler.js';
import { mapProviderToAetnaPayload, maskSensitivePayload } from './field-mapper.js';
import { checkAetnaReadiness } from './readiness.service.js';
import { holdSession, getSession, releaseSession, canLaunch } from './browser-pool.js';
import type { AetnaProviderData } from './types.js';

const documentService = new DocumentService();

async function loadProviderData(providerId: string, userId: string): Promise<AetnaProviderData> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    include: {
      practice: true,
      practiceLocations: { where: { isPrimary: true, isActive: true }, take: 1 },
      licenses: { where: { status: 'active' }, orderBy: { expirationDate: 'desc' }, take: 1 },
      educations: { orderBy: { graduationDate: 'desc' }, take: 1 },
      hospitalAffiliations: { where: { status: 'active' } },
    },
  });

  if (!provider) throw new Error('Provider not found');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const loc = provider.practiceLocations[0] ?? null;
  const license = provider.licenses[0] ?? null;
  const edu = provider.educations[0] ?? null;

  return {
    provider: {
      id: provider.id,
      npi: provider.npi,
      firstName: provider.firstName,
      lastName: provider.lastName,
      middleName: provider.middleName,
      dateOfBirth: provider.dateOfBirth,
      gender: provider.gender,
      email: provider.email,
      phone: provider.phone,
      fax: provider.fax,
      providerType: provider.providerType,
      specialties: provider.specialties,
      languages: provider.languages,
      caqhProviderId: provider.caqhProviderId,
      acceptingMedicare: (provider as any).acceptingMedicare ?? false,
      acceptingMedicaid: (provider as any).acceptingMedicaid ?? false,
      ePrescribing: (provider as any).ePrescribing ?? false,
      ssnEncrypted: provider.ssnEncrypted,
    },
    practice: provider.practice ? {
      id: provider.practice.id,
      name: provider.practice.name,
      phone: provider.practice.phone,
      email: provider.practice.email,
      website: provider.practice.website,
    } : null,
    primaryLocation: loc ? {
      addressLine1: loc.addressLine1,
      addressLine2: loc.addressLine2,
      city: loc.city,
      state: loc.state,
      zipCode: loc.zipCode,
      county: loc.county,
      phone: loc.phone,
      fax: loc.fax,
      taxId: loc.taxId,
      groupNpi: loc.groupNpi,
      acceptingNewPatients: loc.acceptingNewPatients,
      languagesSpoken: loc.languagesSpoken,
      officeHours: loc.officeHours as Record<string, unknown> | null,
      billingAddressLine1: loc.billingAddressLine1,
      billingAddressCity: loc.billingAddressCity,
      billingAddressState: loc.billingAddressState,
      billingAddressZipCode: loc.billingAddressZipCode,
    } : null,
    primaryLicense: license ? {
      licenseNumber: license.licenseNumber,
      state: license.state,
      expirationDate: license.expirationDate,
    } : null,
    education: edu ? { degree: edu.degree } : null,
    hospitalAffiliations: provider.hospitalAffiliations.map(ha => ({
      facilityName: ha.facilityName,
      privilegeType: ha.privilegeType,
      status: ha.status,
    })),
    submitter: {
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      email: user.email,
      phone: user.phone ?? '',
    },
  };
}

async function uploadScreenshot(buffer: Buffer, runId: string, pageNum: number): Promise<string> {
  // Upload to R2 via document service and return the document ID
  const key = `aetna-screenshots/${runId}/page-${pageNum}.png`;
  // Use the S3 client from document service to upload directly
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['S3_ENDPOINT'] ? {
      endpoint: process.env['S3_ENDPOINT'],
      forcePathStyle: true,
    } : {}),
  });

  await s3.send(new PutObjectCommand({
    Bucket: process.env['S3_BUCKET_NAME'] ?? 'credentials-documents',
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
  }));

  return key;
}

export async function startAetnaEnrollment(enrollmentId: string, runId: string, userId: string): Promise<void> {
  if (!canLaunch()) {
    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: { status: 'failed', errorMessage: 'Browser pool is busy. Try again later.' },
    });
    return;
  }

  let browser;
  try {
    // Load data and build payload
    const enrollment = await prisma.payerEnrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) throw new Error('Enrollment not found');

    const data = await loadProviderData(enrollment.providerId, userId);
    const payload = mapProviderToAetnaPayload(data);

    // Update run with payload (masked for storage)
    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'filling',
        startedAt: new Date(),
        formPayload: maskSensitivePayload(payload) as any,
      },
    });

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Fill the form
    const result = await fillAetnaForm(page, payload);

    // Upload screenshots to R2
    const screenshotKeys: string[] = [];
    for (let i = 0; i < result.screenshots.length; i++) {
      const key = await uploadScreenshot(result.screenshots[i]!, runId, i + 1);
      screenshotKeys.push(key);
    }

    // Hold browser for review
    const reviewExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    holdSession(runId, browser, page, async () => {
      // On timeout, mark as timed_out
      await prisma.aetnaEnrollmentRun.update({
        where: { id: runId },
        data: { status: 'timed_out', completedAt: new Date() },
      });
    });

    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'awaiting_review',
        aetnaRequestId: result.requestId,
        screenshotDocIds: screenshotKeys,
        automationLog: result.log.join('\n'),
        reviewExpiresAt,
      },
    });

    logger.info(`Aetna run ${runId} ready for review. Request ID: ${result.requestId}`);
  } catch (error: any) {
    logger.error(`Aetna run ${runId} failed`, error);

    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }

    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorMessage: error.message ?? 'Unknown error',
        automationLog: error.automationLog ?? null,
        completedAt: new Date(),
      },
    });
  }
}

export async function approveAndSubmit(runId: string): Promise<void> {
  const session = getSession(runId);
  if (!session) throw new Error('Browser session expired or not found');

  try {
    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: { status: 'submitting' },
    });

    // Click the final submit button
    const confirmationScreenshot = await submitFinalPage(session.page);

    // Upload confirmation screenshot
    const confirmKey = await uploadScreenshot(confirmationScreenshot, runId, 99);

    // TODO: Generate PDF from all screenshots (future enhancement)

    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        submittedAt: new Date(),
        completedAt: new Date(),
        confirmationPdfId: confirmKey, // Using screenshot key for now
      },
    });

    logger.info(`Aetna run ${runId} submitted successfully`);
  } catch (error: any) {
    logger.error(`Aetna run ${runId} submission failed`, error);

    await prisma.aetnaEnrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorMessage: `Submission failed: ${error.message}`,
        completedAt: new Date(),
      },
    });
  } finally {
    await releaseSession(runId);
  }
}

export async function rejectRun(runId: string): Promise<void> {
  await releaseSession(runId);

  await prisma.aetnaEnrollmentRun.update({
    where: { id: runId },
    data: { status: 'rejected', completedAt: new Date() },
  });

  logger.info(`Aetna run ${runId} rejected by user`);
}
```

### Step 5: Wire up the orchestrator in routes

Update `packages/backend/src/routes/aetna.routes.ts`:

Replace the `POST /start` handler's TODO with:

```typescript
import { startAetnaEnrollment, approveAndSubmit, rejectRun } from '../services/aetna/enrollment.service.js';

// In the POST /start handler, after creating the run:
// Launch async — don't await (long-running process)
startAetnaEnrollment(enrollmentId, run.id, userId).catch(err => {
  logger.error(`Aetna enrollment run ${run.id} failed`, err);
});
```

Replace the `POST /runs/:runId/approve` handler's TODO with:

```typescript
approveAndSubmit(runId).catch(err => {
  logger.error(`Aetna run ${runId} approval failed`, err);
});
```

Replace the `POST /runs/:runId/reject` handler with:

```typescript
await rejectRun(runId);
```

### Step 6: Add screenshot signed URL generation to GET /runs/:runId

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// In the GET handler, generate signed URLs for screenshots:
const s3 = new S3Client({ /* same config */ });
const screenshotUrls = await Promise.all(
  run.screenshotDocIds.map(async (key) => {
    return getSignedUrl(s3, new GetObjectCommand({
      Bucket: process.env['S3_BUCKET_NAME'],
      Key: key,
    }), { expiresIn: 3600 });
  })
);
```

### Step 7: Run existing tests

```bash
npx vitest run
```

### Step 8: Commit

```bash
git add packages/backend/src/services/aetna/ packages/backend/src/routes/aetna.routes.ts
git commit -m "feat: add Playwright form filler, browser pool, and enrollment orchestrator for Aetna automation"
```

---

## Task 6: Frontend — Readiness Panel + Start Button

Add Aetna automation UI to the enrollment detail page.

**Files:**
- Create: `packages/frontend/src/hooks/useAetnaEnrollment.ts`
- Create: `packages/frontend/src/components/enrollments/AetnaReadinessPanel.tsx`
- Modify: `packages/frontend/src/features/enrollments/EnrollmentDetail.tsx`

### Step 1: Create the React Query hooks

Create `packages/frontend/src/hooks/useAetnaEnrollment.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

interface ReadinessResult {
  ready: boolean;
  pages: Array<{
    page: number;
    title: string;
    ready: boolean;
    missing: Array<{ field: string; label: string; fixPath: string }>;
  }>;
}

interface AetnaRunStatus {
  id: string;
  status: string;
  aetnaRequestId: string | null;
  screenshotUrls: string[];
  automationLog: string | null;
  errorMessage: string | null;
  errorPage: number | null;
  startedAt: string | null;
  reviewExpiresAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  confirmationPdfUrl: string | null;
}

export function useAetnaReadiness(enrollmentId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: ReadinessResult }>(
        `/enrollments/${enrollmentId}/aetna/readiness`
      );
      return res.data.data;
    },
  });
}

export function useStartAetnaEnrollment(enrollmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { runId: string; status: string } }>(
        `/enrollments/${enrollmentId}/aetna/start`
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['aetna-run', data.runId] });
      toast.success('Aetna enrollment started');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Failed to start enrollment');
    },
  });
}

export function useAetnaRunStatus(runId: string | null, enrollmentId: string) {
  return useQuery({
    queryKey: ['aetna-run', runId],
    queryFn: async () => {
      if (!runId) return null;
      const res = await api.get<{ success: boolean; data: AetnaRunStatus }>(
        `/enrollments/${enrollmentId}/aetna/runs/${runId}`
      );
      return res.data.data;
    },
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 3s while filling, stop when done
      if (status === 'filling' || status === 'pending' || status === 'submitting') return 3000;
      return false;
    },
  });
}

export function useApproveAetnaRun(enrollmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await api.post(`/enrollments/${enrollmentId}/aetna/runs/${runId}/approve`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aetna-run'] });
      toast.success('Submission approved — submitting to Aetna');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Failed to approve');
    },
  });
}

export function useRejectAetnaRun(enrollmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await api.post(`/enrollments/${enrollmentId}/aetna/runs/${runId}/reject`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aetna-run'] });
      toast.success('Submission rejected');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Failed to reject');
    },
  });
}

export function useRetryAetnaRun(enrollmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await api.post(`/enrollments/${enrollmentId}/aetna/runs/${runId}/retry`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aetna-run'] });
      toast.success('Retrying enrollment');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Failed to retry');
    },
  });
}
```

### Step 2: Create the AetnaReadinessPanel component

Create `packages/frontend/src/components/enrollments/AetnaReadinessPanel.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { useAetnaReadiness, useStartAetnaEnrollment } from '../../hooks/useAetnaEnrollment';

interface Props {
  enrollmentId: string;
  payerName: string;
  onRunStarted: (runId: string) => void;
}

export function AetnaReadinessPanel({ enrollmentId, payerName, onRunStarted }: Props) {
  const readinessMutation = useAetnaReadiness(enrollmentId);
  const startMutation = useStartAetnaEnrollment(enrollmentId);
  const [readiness, setReadiness] = useState<any>(null);

  const handleCheckReadiness = async () => {
    const result = await readinessMutation.mutateAsync();
    setReadiness(result);
  };

  const handleStart = async () => {
    const result = await startMutation.mutateAsync();
    onRunStarted(result.runId);
  };

  // Only show for Aetna enrollments
  if (!payerName.toLowerCase().includes('aetna')) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <PlayIcon className="h-5 w-5 text-primary-600" />
          Aetna Enrollment Automation
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Auto-fill the Aetna enrollment form using provider data from Lanyard.
        </p>
      </div>

      <div className="px-6 py-4">
        {/* Check Readiness Button */}
        {!readiness && (
          <button
            onClick={handleCheckReadiness}
            disabled={readinessMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
          >
            {readinessMutation.isPending ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircleIcon className="h-4 w-4" />
            )}
            Check Readiness
          </button>
        )}

        {/* Readiness Results */}
        {readiness && (
          <div className="space-y-4">
            <div className={`flex items-center gap-2 text-sm font-medium ${readiness.ready ? 'text-green-700' : 'text-amber-700'}`}>
              {readiness.ready ? (
                <>
                  <CheckCircleIcon className="h-5 w-5 text-green-500" />
                  All required data is present. Ready to start.
                </>
              ) : (
                <>
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
                  Some required fields are missing.
                </>
              )}
            </div>

            {/* Per-page breakdown */}
            <div className="space-y-2">
              {readiness.pages.map((page: any) => (
                <div key={page.page} className="flex items-start gap-2">
                  {page.ready ? (
                    <CheckCircleIcon className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  ) : (
                    <XCircleIcon className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      Page {page.page}: {page.title}
                    </span>
                    {page.missing.length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {page.missing.map((m: any) => (
                          <li key={m.field} className="text-sm text-gray-600 flex items-center gap-1">
                            <span>{m.label}</span>
                            <Link to={m.fixPath} className="text-primary-600 hover:underline text-xs">
                              (fix)
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCheckReadiness}
                disabled={readinessMutation.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200"
              >
                <ArrowPathIcon className="h-4 w-4" />
                Re-check
              </button>

              {readiness.ready && (
                <button
                  onClick={handleStart}
                  disabled={startMutation.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                >
                  {startMutation.isPending ? (
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlayIcon className="h-4 w-4" />
                  )}
                  Start Aetna Enrollment
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 3: Add AetnaReadinessPanel to EnrollmentDetail page

In `packages/frontend/src/features/enrollments/EnrollmentDetail.tsx`, import and add the panel after the existing enrollment details section:

```tsx
import { AetnaReadinessPanel } from '../../components/enrollments/AetnaReadinessPanel';
import { AetnaReviewPanel } from '../../components/enrollments/AetnaReviewPanel';

// Inside the component, add state:
const [activeRunId, setActiveRunId] = useState<string | null>(null);

// Add after the enrollment details section:
<AetnaReadinessPanel
  enrollmentId={enrollment.id}
  payerName={enrollment.payer.name}
  onRunStarted={(runId) => setActiveRunId(runId)}
/>

{activeRunId && (
  <AetnaReviewPanel
    enrollmentId={enrollment.id}
    runId={activeRunId}
    onClose={() => setActiveRunId(null)}
  />
)}
```

### Step 4: Commit

```bash
git add packages/frontend/src/hooks/useAetnaEnrollment.ts packages/frontend/src/components/enrollments/AetnaReadinessPanel.tsx packages/frontend/src/features/enrollments/EnrollmentDetail.tsx
git commit -m "feat: add Aetna readiness panel and enrollment hooks to frontend"
```

---

## Task 7: Frontend — Review + Approve/Reject Screen

Screenshot carousel with approve/reject buttons and countdown timer.

**Files:**
- Create: `packages/frontend/src/components/enrollments/AetnaReviewPanel.tsx`

### Step 1: Create the review panel

Create `packages/frontend/src/components/enrollments/AetnaReviewPanel.tsx`:

```tsx
import { useState, useEffect } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  useAetnaRunStatus,
  useApproveAetnaRun,
  useRejectAetnaRun,
  useRetryAetnaRun,
} from '../../hooks/useAetnaEnrollment';

interface Props {
  enrollmentId: string;
  runId: string;
  onClose: () => void;
}

const PAGE_TITLES = [
  'Submitter Information',
  'Network & Tax Information',
  'Degree & Specialty',
  'Provider Details & Credentials',
  'Contact Preferences',
  'Primary Practice Location',
  'Mailing & Billing Addresses',
  'Hospital Privileges & Attachments',
  'Additional Questions & Final Review',
];

export function AetnaReviewPanel({ enrollmentId, runId, onClose }: Props) {
  const { data: run, isLoading } = useAetnaRunStatus(runId, enrollmentId);
  const approveMutation = useApproveAetnaRun(enrollmentId);
  const rejectMutation = useRejectAetnaRun(enrollmentId);
  const retryMutation = useRetryAetnaRun(enrollmentId);

  const [currentPage, setCurrentPage] = useState(0);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  // Countdown timer
  useEffect(() => {
    if (!run?.reviewExpiresAt || run.status !== 'awaiting_review') return;

    const interval = setInterval(() => {
      const remaining = new Date(run.reviewExpiresAt!).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeRemaining('Expired');
        clearInterval(interval);
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setTimeRemaining(`${mins}:${String(secs).padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [run?.reviewExpiresAt, run?.status]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (!run) return null;

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    filling: 'bg-blue-100 text-blue-700',
    awaiting_review: 'bg-amber-100 text-amber-700',
    submitting: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    rejected: 'bg-gray-100 text-gray-700',
    timed_out: 'bg-red-100 text-red-700',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Aetna Enrollment Review</h2>
          {run.aetnaRequestId && (
            <p className="text-sm text-gray-500">Request ID: {run.aetnaRequestId}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {run.status === 'awaiting_review' && timeRemaining && (
            <span className="inline-flex items-center gap-1 text-sm text-amber-700">
              <ClockIcon className="h-4 w-4" />
              {timeRemaining}
            </span>
          )}
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[run.status] ?? 'bg-gray-100'}`}>
            {run.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Content based on status */}
      <div className="px-6 py-4">
        {/* Filling in progress */}
        {(run.status === 'pending' || run.status === 'filling') && (
          <div className="flex items-center gap-3 text-blue-700">
            <ArrowPathIcon className="h-5 w-5 animate-spin" />
            <span>Filling Aetna enrollment form... This may take a few minutes.</span>
          </div>
        )}

        {/* Submitting */}
        {run.status === 'submitting' && (
          <div className="flex items-center gap-3 text-blue-700">
            <ArrowPathIcon className="h-5 w-5 animate-spin" />
            <span>Submitting to Aetna...</span>
          </div>
        )}

        {/* Awaiting review — show screenshots */}
        {run.status === 'awaiting_review' && run.screenshotUrls.length > 0 && (
          <div className="space-y-4">
            {/* Screenshot carousel */}
            <div className="relative">
              <div className="text-sm font-medium text-gray-700 mb-2">
                Page {currentPage + 2}: {PAGE_TITLES[currentPage] ?? ''}
                <span className="text-gray-400 ml-2">
                  ({currentPage + 1} of {run.screenshotUrls.length})
                </span>
              </div>
              <div className="border rounded-lg overflow-hidden bg-gray-50">
                <img
                  src={run.screenshotUrls[currentPage]}
                  alt={`Page ${currentPage + 2} screenshot`}
                  className="w-full"
                />
              </div>
              <div className="flex justify-between mt-2">
                <button
                  onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                >
                  <ChevronLeftIcon className="h-4 w-4" /> Previous
                </button>
                <button
                  onClick={() => setCurrentPage(Math.min(run.screenshotUrls.length - 1, currentPage + 1))}
                  disabled={currentPage === run.screenshotUrls.length - 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                >
                  Next <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Approve/Reject buttons */}
            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => setShowConfirmDialog(true)}
                disabled={approveMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircleIcon className="h-4 w-4" />
                Approve & Submit
              </button>
              <button
                onClick={() => rejectMutation.mutate(runId)}
                disabled={rejectMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
              >
                <XCircleIcon className="h-4 w-4" />
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Completed */}
        {run.status === 'completed' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircleIcon className="h-5 w-5" />
              <span className="font-medium">Enrollment submitted successfully</span>
            </div>
            {run.aetnaRequestId && (
              <p className="text-sm text-gray-600">Aetna Request ID: <strong>{run.aetnaRequestId}</strong></p>
            )}
            {run.submittedAt && (
              <p className="text-sm text-gray-600">Submitted: {new Date(run.submittedAt).toLocaleString()}</p>
            )}
            {run.confirmationPdfUrl && (
              <a
                href={run.confirmationPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary-600 hover:underline"
              >
                <DocumentArrowDownIcon className="h-4 w-4" />
                Download Confirmation
              </a>
            )}
          </div>
        )}

        {/* Failed */}
        {(run.status === 'failed' || run.status === 'timed_out') && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-700">
              <ExclamationTriangleIcon className="h-5 w-5" />
              <span className="font-medium">
                {run.status === 'timed_out' ? 'Review window expired' : 'Enrollment failed'}
              </span>
            </div>
            {run.errorMessage && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{run.errorMessage}</p>
            )}
            <button
              onClick={() => retryMutation.mutate(runId)}
              disabled={retryMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Retry
            </button>
          </div>
        )}

        {/* Automation log (expandable) */}
        {run.automationLog && (
          <details className="mt-4">
            <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
              View automation log
            </summary>
            <pre className="mt-2 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
              {run.automationLog}
            </pre>
          </details>
        )}
      </div>

      {/* Confirm dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowConfirmDialog(false)} />
            <div className="relative z-10 w-full max-w-md p-6 bg-white rounded-2xl shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900">Confirm Submission</h3>
              <p className="mt-2 text-sm text-gray-600">
                This will submit the enrollment application to Aetna. <strong>This action cannot be undone.</strong>
              </p>
              <div className="flex gap-3 mt-6 justify-end">
                <button
                  onClick={() => setShowConfirmDialog(false)}
                  className="px-4 py-2 text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowConfirmDialog(false);
                    approveMutation.mutate(runId);
                  }}
                  disabled={approveMutation.isPending}
                  className="px-4 py-2 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  Approve & Submit to Aetna
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 2: Commit

```bash
git add packages/frontend/src/components/enrollments/AetnaReviewPanel.tsx
git commit -m "feat: add Aetna review panel with screenshot carousel, approve/reject, countdown timer"
```

---

## Task 8: Integration Testing + Full Verification

End-to-end verification of the complete feature.

**Files:**
- Create: `packages/backend/src/services/aetna/readiness.service.test.ts` (if not done in Task 3)
- Run: full test suite

### Step 1: Run full backend test suite

```bash
cd packages/backend
npx vitest run
```

Expected: All tests pass, including the new readiness and field mapper tests.

### Step 2: Run frontend build to check for TypeScript errors

```bash
cd packages/frontend
npx tsc --noEmit
```

### Step 3: Manual smoke test checklist

1. Start dev environment: `./start-dev.sh`
2. Navigate to an Aetna enrollment detail page
3. Click "Check Readiness" — verify per-page breakdown appears
4. If data is incomplete, verify "fix" links navigate correctly
5. If data is complete, click "Start Aetna Enrollment"
6. Watch the status transition: pending → filling → awaiting_review
7. Review screenshots page by page
8. Test reject flow
9. Test approve flow (with confirmation dialog)
10. Verify Request ID and timestamp display after completion

### Step 4: Final commit

```bash
git add -A
git commit -m "feat: complete Aetna enrollment automation — readiness check, Playwright form fill, human review gate"
```

---

## Task Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Prisma schema changes + migration | None |
| 2 | Aetna field mapper (pure function) | Task 1 (types) |
| 3 | Readiness check service | Task 1 (schema) |
| 4 | API routes | Task 3 (readiness service) |
| 5 | Playwright form filler + orchestrator | Tasks 2, 3, 4 |
| 6 | Frontend readiness panel + hooks | Task 4 (API) |
| 7 | Frontend review/approve screen | Task 6 (hooks) |
| 8 | Integration testing + verification | All tasks |

Tasks 2 and 3 can be done in parallel after Task 1.
Tasks 6 and 7 can be started once Task 4 is done (backend API exists).
