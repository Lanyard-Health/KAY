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
    ageGroup: ['Adults (Ages 18-64)'],
    practiceFocus: ['Anxiety Disorders'],
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

  describe('fillBehavioralHealth (multiselect)', () => {
    // A page mock that only needs to satisfy the trailing "Continue" click +
    // waitForTimeout — the multiselect/radio interactions are spied below.
    function mockPage() {
      const clickable = { click: vi.fn().mockResolvedValue(undefined) };
      return {
        locator: vi.fn(() => ({ first: () => clickable })),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as never;
    }

    it('selects EVERY age group and practice focus (not just the first)', async () => {
      const data: AetnaRfpProviderData = {
        ...validData,
        behavioralHealth: {
          ageGroup: ['Adults (Ages 18-64)', 'Geriatric (Ages 65+)'],
          practiceFocus: ['Anxiety Disorders', 'Depression'],
        },
      };
      const adapter = new AetnaRfpAdapter();
      const pick = vi
        .spyOn(adapter as never as { pickFromMultiSelect: () => Promise<void> }, 'pickFromMultiSelect')
        .mockResolvedValue(undefined);
      vi.spyOn(
        adapter as never as { pickYesNo: () => Promise<void> },
        'pickYesNo'
      ).mockResolvedValue(undefined);

      await (
        adapter as never as {
          fillBehavioralHealth: (p: unknown, d: AetnaRfpProviderData) => Promise<void>;
        }
      ).fillBehavioralHealth(mockPage(), data);

      // Both age groups + both focuses selected = 4 picks, each with its value.
      expect(pick).toHaveBeenCalledTimes(4);
      expect(pick).toHaveBeenCalledWith(expect.anything(), 'ageGroupsDropdown', 'Adults (Ages 18-64)');
      expect(pick).toHaveBeenCalledWith(expect.anything(), 'ageGroupsDropdown', 'Geriatric (Ages 65+)');
      expect(pick).toHaveBeenCalledWith(expect.anything(), 'practiceFocusDropdown', 'Anxiety Disorders');
      expect(pick).toHaveBeenCalledWith(expect.anything(), 'practiceFocusDropdown', 'Depression');
    });

    it('throws before fill when an age group / focus array is empty', async () => {
      const data: AetnaRfpProviderData = {
        ...validData,
        behavioralHealth: { ageGroup: [], practiceFocus: ['Anxiety Disorders'] },
      };
      const adapter = new AetnaRfpAdapter();
      await expect(
        (
          adapter as never as {
            fillBehavioralHealth: (p: unknown, d: AetnaRfpProviderData) => Promise<void>;
          }
        ).fillBehavioralHealth({} as unknown, data)
      ).rejects.toThrow(/at least one value/);
    });
  });
});
