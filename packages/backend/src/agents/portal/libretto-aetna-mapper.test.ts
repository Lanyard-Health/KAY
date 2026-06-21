import { describe, it, expect } from 'vitest';
import type { AetnaRfpProviderData } from './aetna-rfp-adapter.js';
import { aetnaPacketToLibrettoParams } from './libretto-aetna-mapper.js';

// Synthetic packet — fabricated values, no real provider PII.
const packet: AetnaRfpProviderData = {
  payer: 'Aetna',
  lineOfBusiness: 'BEHAVIORAL_HEALTH',
  joining: 'INDIVIDUAL_NEW',
  submitter: {
    lastName: 'Ops',
    firstName: 'Enroll',
    role: 'Credentialing / Enrollment (Director, Manager, Coordinator)',
    email: 'enroll@example.com',
    phone: '316-555-0100',
  },
  provider: {
    lastName: 'Gray',
    firstName: 'Bethany',
    npi: '0000000000',
    taxIdType: 'E',
    taxIdName: 'Example Therapy LLC',
    taxId: '00-0000000',
    caqhId: '99999999',
    dob: '01/02/1980',
    licenseNumber: 'LIC-TEST-1',
    licenseExp: '12/31/2027',
    degree: 'MFT',
    primarySpecialty: 'Marriage and Family Therapist',
  },
  location: {
    state: 'Kansas',
    zip: '67202',
    street: '123 Therapy Lane',
    city: 'Wichita',
    phone: '316-555-0100',
    fax: '',
    placeOfService: 'Office based',
    adaAccessible: true,
  },
  behavioralHealth: {
    ageGroup: ['Adults (Ages 18-64)', 'Geriatric (Ages 65+)'],
    practiceFocus: ['Anxiety Disorders', 'Depression'],
  },
  medicareCertified: false,
  medicaidCertified: false,
  hospitalist: false,
  ePrescribing: false,
  telehealth: false,
};

describe('aetnaPacketToLibrettoParams', () => {
  it('flattens nested fields onto the flat workflow schema', () => {
    const p = aetnaPacketToLibrettoParams(packet);
    expect(p.submitterLast).toBe('Ops');
    expect(p.providerFirst).toBe('Bethany');
    expect(p.npi).toBe('0000000000');
    expect(p.caqhId).toBe('99999999');
    expect(p.locationPhone).toBe('316-555-0100'); // location.phone -> locationPhone
  });

  it('converts the two enums to their on-form dropdown labels', () => {
    const p = aetnaPacketToLibrettoParams(packet);
    expect(p.applyingFor).toBe('Behavioral Health');
    expect(p.joining).toContain('individual provider applying under a SSN');
  });

  it('converts telehealth boolean to Yes/No', () => {
    expect(aetnaPacketToLibrettoParams(packet).telehealth).toBe('No');
    expect(aetnaPacketToLibrettoParams({ ...packet, telehealth: true }).telehealth).toBe('Yes');
  });

  it('takes the first value of each multiselect', () => {
    const p = aetnaPacketToLibrettoParams(packet);
    expect(p.ageGroup).toBe('Adults (Ages 18-64)');
    expect(p.practiceFocus).toBe('Anxiety Disorders');
  });

  it('defaults confirmSubmit to false and honors an explicit opt-in', () => {
    expect(aetnaPacketToLibrettoParams(packet).confirmSubmit).toBe(false);
    expect(aetnaPacketToLibrettoParams(packet, { confirmSubmit: true }).confirmSubmit).toBe(true);
  });

  it('tolerates a missing behavioralHealth block', () => {
    const { behavioralHealth, ...rest } = packet;
    void behavioralHealth;
    const p = aetnaPacketToLibrettoParams(rest as AetnaRfpProviderData);
    expect(p.ageGroup).toBe('');
    expect(p.practiceFocus).toBe('');
  });
});
