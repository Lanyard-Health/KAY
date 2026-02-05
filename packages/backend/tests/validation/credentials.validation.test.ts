import { describe, it, expect } from 'vitest';
import {
  licenseTypeSchema,
  boardTypeSchema,
  degreeTypeSchema,
  credentialStatusSchema,
  createLicenseSchema,
  createBoardCertificationSchema,
  createMalpracticeInsuranceSchema,
  createEducationSchema,
  createWorkHistorySchema,
} from '@credential-management/shared';

describe('Credential Validation Schemas', () => {
  describe('licenseTypeSchema', () => {
    const validTypes = [
      'state_medical', 'state_psychology', 'state_social_work',
      'state_counseling', 'state_marriage_family', 'dea',
      'controlled_substance', 'npi',
    ];

    it.each(validTypes)('accepts "%s"', (val) => {
      expect(licenseTypeSchema.parse(val)).toBe(val);
    });

    it('rejects invalid license type', () => {
      expect(() => licenseTypeSchema.parse('invalid_type')).toThrow();
    });
  });

  describe('boardTypeSchema', () => {
    const validTypes = [
      'abpn_psychiatry', 'abpn_child_adolescent', 'abpn_addiction',
      'abpp_clinical', 'abpp_counseling', 'abecsw', 'nbcc',
      'aamft', 'ancc_pmhnp', 'other',
    ];

    it.each(validTypes)('accepts "%s"', (val) => {
      expect(boardTypeSchema.parse(val)).toBe(val);
    });

    it('rejects invalid board type', () => {
      expect(() => boardTypeSchema.parse('invalid_board')).toThrow();
    });
  });

  describe('degreeTypeSchema', () => {
    const validTypes = ['md', 'do', 'phd', 'psyd', 'msw', 'ma', 'ms', 'med', 'dnp', 'msn', 'bs', 'ba', 'other'];

    it.each(validTypes)('accepts "%s"', (val) => {
      expect(degreeTypeSchema.parse(val)).toBe(val);
    });

    it('rejects invalid degree type', () => {
      expect(() => degreeTypeSchema.parse('mba')).toThrow();
    });
  });

  describe('credentialStatusSchema', () => {
    it.each(['active', 'expired', 'pending', 'revoked'])('accepts "%s"', (val) => {
      expect(credentialStatusSchema.parse(val)).toBe(val);
    });

    it('rejects invalid status', () => {
      expect(() => credentialStatusSchema.parse('suspended')).toThrow();
    });
  });

  describe('createLicenseSchema', () => {
    const validLicense = {
      licenseType: 'state_medical',
      licenseNumber: 'MD-12345',
      state: 'NY',
      issueDate: '2020-01-15',
      expirationDate: '2025-01-15',
    };

    it('accepts valid license input', () => {
      const result = createLicenseSchema.parse(validLicense);
      expect(result.licenseType).toBe('state_medical');
      expect(result.licenseNumber).toBe('MD-12345');
    });

    it('requires licenseType', () => {
      const { licenseType, ...rest } = validLicense;
      expect(() => createLicenseSchema.parse(rest)).toThrow();
    });

    it('requires licenseNumber', () => {
      const { licenseNumber, ...rest } = validLicense;
      expect(() => createLicenseSchema.parse(rest)).toThrow();
    });

    it('validates date format YYYY-MM-DD for issueDate', () => {
      expect(() =>
        createLicenseSchema.parse({ ...validLicense, issueDate: '01/15/2020' })
      ).toThrow();
    });

    it('validates date format YYYY-MM-DD for expirationDate', () => {
      expect(() =>
        createLicenseSchema.parse({ ...validLicense, expirationDate: '2025-1-15' })
      ).toThrow();
    });

    it('accepts optional notes', () => {
      const result = createLicenseSchema.parse({ ...validLicense, notes: 'Test note' });
      expect(result.notes).toBe('Test note');
    });
  });

  describe('createBoardCertificationSchema', () => {
    const validCert = {
      boardType: 'abpn_psychiatry',
      boardName: 'American Board of Psychiatry and Neurology',
      specialty: 'General Psychiatry',
      initialCertificationDate: '2018-06-01',
    };

    it('accepts valid board certification', () => {
      const result = createBoardCertificationSchema.parse(validCert);
      expect(result.boardType).toBe('abpn_psychiatry');
    });

    it('requires boardName', () => {
      const { boardName, ...rest } = validCert;
      expect(() => createBoardCertificationSchema.parse(rest)).toThrow();
    });

    it('accepts optional expirationDate', () => {
      const result = createBoardCertificationSchema.parse(validCert);
      expect(result.expirationDate).toBeUndefined();
    });

    it('defaults isBoardEligible to false', () => {
      const result = createBoardCertificationSchema.parse(validCert);
      expect(result.isBoardEligible).toBe(false);
    });
  });

  describe('createMalpracticeInsuranceSchema', () => {
    const validInsurance = {
      carrierName: 'MMIC',
      policyNumber: 'POL-123456',
      coverageType: 'occurrence',
      perClaimAmount: 1000000,
      aggregateAmount: 3000000,
      effectiveDate: '2024-01-01',
      expirationDate: '2025-01-01',
    };

    it('accepts valid insurance input', () => {
      const result = createMalpracticeInsuranceSchema.parse(validInsurance);
      expect(result.carrierName).toBe('MMIC');
    });

    it('requires positive perClaimAmount', () => {
      expect(() =>
        createMalpracticeInsuranceSchema.parse({ ...validInsurance, perClaimAmount: 0 })
      ).toThrow();
    });

    it('requires positive aggregateAmount', () => {
      expect(() =>
        createMalpracticeInsuranceSchema.parse({ ...validInsurance, aggregateAmount: -1 })
      ).toThrow();
    });

    it('validates coverageType enum', () => {
      expect(() =>
        createMalpracticeInsuranceSchema.parse({ ...validInsurance, coverageType: 'invalid' })
      ).toThrow();
    });

    it('defaults hasTailCoverage to false', () => {
      const result = createMalpracticeInsuranceSchema.parse(validInsurance);
      expect(result.hasTailCoverage).toBe(false);
    });
  });

  describe('createEducationSchema', () => {
    const validEducation = {
      institutionName: 'Harvard Medical School',
      degree: 'md',
      fieldOfStudy: 'Medicine',
      country: 'US',
      startDate: '2010-08-01',
    };

    it('accepts valid education input', () => {
      const result = createEducationSchema.parse(validEducation);
      expect(result.institutionName).toBe('Harvard Medical School');
    });

    it('requires institution name', () => {
      const { institutionName, ...rest } = validEducation;
      expect(() => createEducationSchema.parse(rest)).toThrow();
    });

    it('validates degree enum', () => {
      expect(() =>
        createEducationSchema.parse({ ...validEducation, degree: 'mba' })
      ).toThrow();
    });

    it('defaults isCompleted to true', () => {
      const result = createEducationSchema.parse(validEducation);
      expect(result.isCompleted).toBe(true);
    });
  });

  describe('createWorkHistorySchema', () => {
    const validWork = {
      organizationName: 'City Hospital',
      organizationType: 'Hospital',
      position: 'Staff Psychiatrist',
      startDate: '2020-01-01',
    };

    it('accepts valid work history', () => {
      const result = createWorkHistorySchema.parse(validWork);
      expect(result.organizationName).toBe('City Hospital');
    });

    it('requires organizationName', () => {
      const { organizationName, ...rest } = validWork;
      expect(() => createWorkHistorySchema.parse(rest)).toThrow();
    });

    it('defaults isCurrent to false', () => {
      const result = createWorkHistorySchema.parse(validWork);
      expect(result.isCurrent).toBe(false);
    });

    it('accepts optional endDate', () => {
      const result = createWorkHistorySchema.parse({ ...validWork, endDate: '2023-12-31' });
      expect(result.endDate).toBe('2023-12-31');
    });
  });
});
