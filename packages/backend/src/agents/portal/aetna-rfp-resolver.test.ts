import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// decryptSafe needs no real ENCRYPTION_KEY in unit tests — stub it to a known
// plaintext so we can assert the EIN flows through to the packet.
vi.mock('../../utils/crypto.js', () => ({
  decryptSafe: vi.fn(() => '987654321'),
}));

import {
  buildAetnaRfpProviderData,
  AETNA_AGE_GROUP_MAP,
  AETNA_PRACTICE_FOCUS_MAP,
} from './aetna-rfp-resolver.js';

const IDS = { providerId: 'prov-1', practiceId: 'prac-1', payerId: 'payer-1' };

const REQUIRED_FIELDS = [
  'provider.firstName',
  'provider.lastName',
  'provider.npi',
  'provider.dateOfBirth',
  'provider.caqhProviderId',
  'license.licenseNumber',
  'license.expirationDate',
  'practice.taxIdEncrypted',
  'practice.addressLine1',
  'practice.city',
  'practice.state',
  'practice.zipCode',
];

/** A fully-populated, ready-to-submit provider/practice/config set. */
function fakeRecords() {
  const provider = {
    id: IDS.providerId,
    firstName: 'Bethany',
    lastName: 'Gray',
    npi: '1234567890',
    dateOfBirth: new Date('1985-01-01T00:00:00Z'),
    caqhProviderId: '10000000',
    providerType: 'psychiatrist',
    entityType: 'individual',
    taxonomy: '2084P0800X', // NUCC Psychiatry -> Aetna "Psychiatry"
    educations: [{ degree: 'md' }], // -> Aetna degree "MD"
    languages: ['English'],
    ageGroup: ['adults', 'geriatric'],
    practiceFocus: ['anxiety', 'depression'],
    acceptingMedicare: false,
    acceptingMedicaid: true,
    hospitalist: false,
    ePrescribing: true,
    licenses: [
      {
        licenseNumber: '928',
        expirationDate: new Date('2027-12-31T00:00:00Z'),
        isPrimary: true,
        status: 'active',
      },
    ],
  };
  const practice = {
    id: IDS.practiceId,
    name: 'Gray Therapy',
    legalName: 'Gray Therapy LLC',
    taxIdEncrypted: 'enc:whatever',
    addressLine1: '123 Main St',
    city: 'Wichita',
    state: 'KS', // stored as a 2-letter code; resolver expands to "Kansas"
    zipCode: '67201',
    phone: '316-555-0100',
  };
  const practicePayer = {
    id: 'pp-1',
    practiceId: IDS.practiceId,
    payerId: IDS.payerId,
    primaryContactEmail: 'office@graytherapy.example',
  };
  const config = {
    id: 'cfg-1',
    payerId: IDS.payerId,
    adapterType: 'AETNA_RFP',
    requiredFields: REQUIRED_FIELDS,
    config: {
      payer: 'Aetna',
      aetnaEapParticipation: true,
      submitter: {
        lastName: 'Tester',
        firstName: 'Lanyard',
        role: 'Credentialing / Enrollment (Director, Manager, Coordinator)',
        email: 'rfp@example.com',
        phone: '316-555-0100',
      },
    },
  };
  return { provider, practice, practicePayer, config };
}

/** Build a fake PrismaClient from a records bundle (with optional overrides). */
function fakePrisma(records: ReturnType<typeof fakeRecords>): PrismaClient {
  return {
    providerProfile: { findUnique: vi.fn(async () => records.provider) },
    practice: { findUnique: vi.fn(async () => records.practice) },
    practicePayer: { findFirst: vi.fn(async () => records.practicePayer) },
    payerSubmissionConfig: { findUnique: vi.fn(async () => records.config) },
  } as unknown as PrismaClient;
}

function clearMap(m: Record<string, string>) {
  for (const k of Object.keys(m)) delete m[k];
}

describe('buildAetnaRfpProviderData', () => {
  // Degree/specialty come from populated module constants (AETNA_DEGREE_MAP +
  // AETNA_SPECIALTY_CROSSWALK) and need no per-test setup. The ageGroup/
  // practiceFocus maps are still empty-by-default, so populate + wipe just those.
  beforeEach(() => {
    AETNA_AGE_GROUP_MAP['adults'] = 'Adults (Ages 18-64)';
    AETNA_AGE_GROUP_MAP['geriatric'] = 'Geriatric (Ages 65+)';
    AETNA_PRACTICE_FOCUS_MAP['anxiety'] = 'Anxiety Disorders';
    AETNA_PRACTICE_FOCUS_MAP['depression'] = 'Depression';
  });
  afterEach(() => {
    clearMap(AETNA_AGE_GROUP_MAP);
    clearMap(AETNA_PRACTICE_FOCUS_MAP);
  });

  it('builds a complete packet when the gate passes and maps are populated', async () => {
    const packet = await buildAetnaRfpProviderData(IDS, fakePrisma(fakeRecords()));

    expect(packet.payer).toBe('Aetna');
    expect(packet.lineOfBusiness).toBe('BEHAVIORAL_HEALTH');
    expect(packet.joining).toBe('INDIVIDUAL_NEW');

    // submitter from payer config
    expect(packet.submitter.email).toBe('rfp@example.com');

    // provider direct mappings + formatting + decrypt
    expect(packet.provider.npi).toBe('1234567890');
    expect(packet.provider.dob).toBe('01/01/1985');
    expect(packet.provider.licenseNumber).toBe('928');
    expect(packet.provider.licenseExp).toBe('12/31/2027');
    expect(packet.provider.taxIdType).toBe('E');
    expect(packet.provider.taxId).toBe('987654321'); // from mocked decryptSafe
    expect(packet.provider.taxIdName).toBe('Gray Therapy LLC');
    expect(packet.provider.caqhId).toBe('10000000');

    // degree from Education, specialty from NPI taxonomy crosswalk
    expect(packet.provider.degree).toBe('MD');
    expect(packet.provider.primarySpecialty).toBe('Psychiatry');
    // ALL mapped values carried through, not just the first.
    expect(packet.behavioralHealth?.ageGroup).toEqual([
      'Adults (Ages 18-64)',
      'Geriatric (Ages 65+)',
    ]);
    expect(packet.behavioralHealth?.practiceFocus).toEqual(['Anxiety Disorders', 'Depression']);

    // state code expanded to full name
    expect(packet.location.state).toBe('Kansas');

    // attestation passthroughs
    expect(packet.medicareCertified).toBe(false);
    expect(packet.medicaidCertified).toBe(true);
    expect(packet.hospitalist).toBe(false);
    expect(packet.ePrescribing).toBe(true);
    expect(packet.aetnaEapParticipation).toBe(true);
    expect(packet.telehealth).toBe(false);
  });

  it('throws fail-closed when requiredFields is not configured', async () => {
    const records = fakeRecords();
    records.config.requiredFields = [];
    await expect(buildAetnaRfpProviderData(IDS, fakePrisma(records))).rejects.toThrow(
      'Aetna requiredFields not configured — refusing to build packet (fail-closed).'
    );
  });

  it('throws listing ALL missing fields at once', async () => {
    const records = fakeRecords();
    records.provider.npi = '';
    records.provider.caqhProviderId = '';
    await expect(buildAetnaRfpProviderData(IDS, fakePrisma(records))).rejects.toThrow(
      /Provider not ready for Aetna RFP — missing: \[.*provider\.npi.*provider\.caqhProviderId.*\]/
    );
  });

  it('throws on an unmapped education degree', async () => {
    const records = fakeRecords();
    records.provider.educations = [{ degree: 'ba' }]; // 'ba' not in AETNA_DEGREE_MAP
    await expect(buildAetnaRfpProviderData(IDS, fakePrisma(records))).rejects.toThrow(
      "unmapped AETNA_DEGREE_MAP value 'ba'"
    );
  });

  it('falls back to providerType for degree when no education is on file', async () => {
    const records = fakeRecords();
    records.provider.educations = [];
    const packet = await buildAetnaRfpProviderData(IDS, fakePrisma(records));
    expect(packet.provider.degree).toBe('MD'); // psychiatrist -> MD fallback
  });

  it('fails closed on a taxonomy with no specialty crosswalk (non-BH code)', async () => {
    const records = fakeRecords();
    records.provider.taxonomy = '207RC0000X'; // cardiology — no BH crosswalk
    await expect(buildAetnaRfpProviderData(IDS, fakePrisma(records))).rejects.toThrow(
      /no specialty crosswalk for taxonomy '207RC0000X'/
    );
  });

  it('fails closed on a degree/specialty pair Aetna would not allow', async () => {
    const records = fakeRecords();
    // MD (from md education) + Clinical Social Worker (from 1041 taxonomy) is not
    // a combination Aetna's form offers.
    records.provider.taxonomy = '1041C0700X';
    await expect(buildAetnaRfpProviderData(IDS, fakePrisma(records))).rejects.toThrow(
      /is not a valid Aetna combination/
    );
  });

  it('expands a 2-letter state code to the full Aetna name (KS -> Kansas)', async () => {
    const packet = await buildAetnaRfpProviderData(IDS, fakePrisma(fakeRecords()));
    expect(packet.location.state).toBe('Kansas');
  });

  it('throws fail-closed when practice state is empty', async () => {
    const records = fakeRecords();
    records.practice.state = '';
    // Drop practice.state from requiredFields so the completeness gate doesn't
    // preempt — this isolates the resolver's own state guard (the belt-and-
    // suspenders case where a payer config forgets to require state).
    records.config.requiredFields = REQUIRED_FIELDS.filter((f) => f !== 'practice.state');
    await expect(buildAetnaRfpProviderData(IDS, fakePrisma(records))).rejects.toThrow(
      'Practice state missing — required for Aetna RFP'
    );
  });

  it('throws on an unrecognized state code (does not pass it through)', async () => {
    const records = fakeRecords();
    records.practice.state = 'ZZ'; // present, so the gate passes; toFullStateName rejects it
    await expect(buildAetnaRfpProviderData(IDS, fakePrisma(records))).rejects.toThrow(
      "unrecognized state code 'ZZ' — not in US_STATE_CODE_TO_NAME"
    );
  });

  it('throws naming which record is missing', async () => {
    const prisma = {
      providerProfile: { findUnique: vi.fn(async () => null) },
      practice: { findUnique: vi.fn(async () => ({})) },
      practicePayer: { findFirst: vi.fn(async () => ({})) },
      payerSubmissionConfig: { findUnique: vi.fn(async () => ({})) },
    } as unknown as PrismaClient;
    await expect(buildAetnaRfpProviderData(IDS, prisma)).rejects.toThrow(
      "ProviderProfile not found for providerId 'prov-1'"
    );
  });
});
