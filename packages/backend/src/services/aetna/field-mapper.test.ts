import { describe, it, expect } from 'vitest';
import { mapProviderToAetnaPayload, mapDegreeToAetna, mapTaxIdType, maskSensitivePayload } from './field-mapper.js';
import type { AetnaProviderData } from './types.js';

function makeProviderData(overrides: Partial<AetnaProviderData> = {}): AetnaProviderData {
  return {
    provider: {
      id: 'provider-1',
      npi: '1234567890',
      firstName: 'Jane',
      lastName: 'Doe',
      middleName: 'M',
      dateOfBirth: new Date(1980, 4, 15), // May 15, 1980 in local time
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

      expect(payload.page2['lastName']).toBe('User');
      expect(payload.page2['firstName']).toBe('Admin');
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

    it('maps page 9 hospital privileges', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);
      expect(payload.page9['hospitalPrivileges']).toBe('Yes');

      const noPrivileges = makeProviderData({ hospitalAffiliations: [] });
      const payload2 = mapProviderToAetnaPayload(noPrivileges);
      expect(payload2.page9['hospitalPrivileges']).toBe('No');
    });

    it('maps page 10 medicare/medicaid', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);
      expect(payload.page10['medicareCertified']).toBe('Yes');
      expect(payload.page10['medicaidCertified']).toBe('No');
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

      expect(payload.page3['zipCode']).toBe('');
      expect(payload.page5['medicalLicenseNumber']).toBe('');
      expect(payload.page4['degreeType']).toBe('');
    });
  });

  describe('maskSensitivePayload', () => {
    it('masks tax ID in page 3', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);
      const masked = maskSensitivePayload(payload);

      expect(masked.page3['taxID']).toBe('***-***-6789');
      expect(masked.page3['verifyTaxID']).toBe('***-***-6789');
    });

    it('does not mutate original payload', () => {
      const data = makeProviderData();
      const payload = mapProviderToAetnaPayload(data);
      maskSensitivePayload(payload);

      expect(payload.page3['taxID']).toBe('12-3456789');
    });
  });
});
