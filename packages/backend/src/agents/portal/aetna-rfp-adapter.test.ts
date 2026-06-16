import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  AetnaRfpAdapter,
  isAetnaRfpData,
  type AetnaRfpProviderData,
} from './aetna-rfp-adapter.js';
import {
  registerSubmissionAdapters,
  getSubmissionAdapter,
  clearSubmissionAdapters,
} from './adapter-factory.js';

const validData: AetnaRfpProviderData = {
  payer: 'Aetna',
  lineOfBusiness: 'BEHAVIORAL_HEALTH',
  joining: 'INDIVIDUAL_NEW',
  submitter: {
    lastName: 'Tester',
    firstName: 'Lanyard',
    role: 'Credentialing / Enrollment (Director, Manager, Coordinator)',
    email: 'rfp@example.com',
    phone: '316-555-0100',
  },
  provider: {
    lastName: 'Gray',
    firstName: 'Bethany',
    npi: '1234567890',
    taxIdType: 'E',
    taxIdName: 'Bethany Gray',
    taxId: '000000000',
    caqhId: '10000000',
    dob: '01/01/1985',
    licenseNumber: '928',
    licenseExp: '12/31/2027',
    degree: 'MFT',
    primarySpecialty: 'Marriage and Family Therapist',
  },
  location: {
    state: 'Kansas',
    zip: '67212',
    street: '123 Therapy Lane',
    city: 'Wichita',
    phone: '316-555-0100',
    fax: '316-555-0101',
    placeOfService: 'Office based',
    adaAccessible: true,
  },
  behavioralHealth: {
    ageGroup: 'Adults (Ages 18-64)',
    practiceFocus: 'Anxiety Disorders',
  },
  telehealth: false,
};

describe('AetnaRfpAdapter', () => {
  it('declares adapterType AETNA_RFP', () => {
    expect(new AetnaRfpAdapter().adapterType).toBe('AETNA_RFP');
  });

  describe('isAetnaRfpData', () => {
    it('accepts a well-formed payload', () => {
      expect(isAetnaRfpData(validData)).toBe(true);
    });

    it('rejects null / non-object', () => {
      expect(isAetnaRfpData(null)).toBe(false);
      expect(isAetnaRfpData(undefined)).toBe(false);
      expect(isAetnaRfpData('nope')).toBe(false);
    });

    it('rejects a payload missing required sections', () => {
      expect(isAetnaRfpData({ payer: 'Aetna', lineOfBusiness: 'BEHAVIORAL_HEALTH' })).toBe(false);
    });
  });

  describe('factory registration', () => {
    beforeEach(() => clearSubmissionAdapters());

    it('registers an AetnaRfpAdapter under AETNA_RFP', () => {
      registerSubmissionAdapters();
      const adapter = getSubmissionAdapter('AETNA_RFP');
      expect(adapter).toBeInstanceOf(AetnaRfpAdapter);
      expect(adapter.adapterType).toBe('AETNA_RFP');
    });
  });
});
