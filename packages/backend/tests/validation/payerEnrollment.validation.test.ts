import { describe, it, expect } from 'vitest';
import {
  supervisionTypeSchema,
  claimStatusSchema,
  disclosureCategorySchema,
  identifierTypeSchema,
  bankAccountTypeSchema,
  citizenshipStatusSchema,
  createSupervisingPhysicianSchema,
  createMalpracticeClaimSchema,
  createDisclosureSchema,
  createDeaRegistrationSchema,
  createBankingSchema,
  upsertDemographicsSchema,
  createProviderIdentifierSchema,
} from '@credential-management/shared';

describe('Payer Enrollment Validation Schemas', () => {
  // ==========================================
  // ENUM SCHEMAS
  // ==========================================

  describe('supervisionTypeSchema', () => {
    const validTypes = ['DIRECT', 'GENERAL', 'COLLABORATIVE', 'ADMINISTRATIVE'];

    it.each(validTypes)('accepts "%s"', (val) => {
      expect(supervisionTypeSchema.parse(val)).toBe(val);
    });

    it('rejects invalid supervision type', () => {
      expect(() => supervisionTypeSchema.parse('INDIRECT')).toThrow();
    });
  });

  describe('claimStatusSchema', () => {
    const validStatuses = [
      'OPEN', 'SETTLED', 'DISMISSED',
      'JUDGMENT_FOR_PROVIDER', 'JUDGMENT_AGAINST_PROVIDER', 'WITHDRAWN',
    ];

    it.each(validStatuses)('accepts "%s"', (val) => {
      expect(claimStatusSchema.parse(val)).toBe(val);
    });

    it('rejects invalid claim status', () => {
      expect(() => claimStatusSchema.parse('PENDING')).toThrow();
    });
  });

  describe('disclosureCategorySchema', () => {
    const validCategories = [
      'LICENSE_ACTION', 'HOSPITAL_PRIVILEGES', 'FELONY_CONVICTION',
      'MISDEMEANOR_CONVICTION', 'SUBSTANCE_ABUSE', 'MALPRACTICE',
      'MEDICARE_MEDICAID', 'BOARD_ACTION', 'INSURANCE_DENIAL',
      'ABILITY_TO_PERFORM', 'OTHER',
    ];

    it.each(validCategories)('accepts "%s"', (val) => {
      expect(disclosureCategorySchema.parse(val)).toBe(val);
    });

    it('rejects invalid disclosure category', () => {
      expect(() => disclosureCategorySchema.parse('TAX_FRAUD')).toThrow();
    });
  });

  describe('identifierTypeSchema', () => {
    const validTypes = [
      'MEDICARE_PTAN', 'MEDICARE_PECOS_ID', 'MEDICAID_ID', 'TRICARE_ID',
      'RAILROAD_MEDICARE_ID', 'STATE_LICENSE_ID', 'PAYER_SPECIFIC_ID', 'UPIN', 'OTHER',
    ];

    it.each(validTypes)('accepts "%s"', (val) => {
      expect(identifierTypeSchema.parse(val)).toBe(val);
    });

    it('rejects invalid identifier type', () => {
      expect(() => identifierTypeSchema.parse('SSN')).toThrow();
    });
  });

  describe('bankAccountTypeSchema', () => {
    it.each(['CHECKING', 'SAVINGS'])('accepts "%s"', (val) => {
      expect(bankAccountTypeSchema.parse(val)).toBe(val);
    });

    it('rejects invalid account type', () => {
      expect(() => bankAccountTypeSchema.parse('MONEY_MARKET')).toThrow();
    });
  });

  describe('citizenshipStatusSchema', () => {
    const validStatuses = ['US_CITIZEN', 'PERMANENT_RESIDENT', 'WORK_VISA', 'OTHER'];

    it.each(validStatuses)('accepts "%s"', (val) => {
      expect(citizenshipStatusSchema.parse(val)).toBe(val);
    });

    it('rejects invalid citizenship status', () => {
      expect(() => citizenshipStatusSchema.parse('TOURIST')).toThrow();
    });
  });

  // ==========================================
  // createSupervisingPhysicianSchema
  // ==========================================

  describe('createSupervisingPhysicianSchema', () => {
    const validComplete = {
      supervisorFirstName: 'Jane',
      supervisorLastName: 'Smith',
      supervisorMiddleName: 'Marie',
      supervisorNpi: '1234567890',
      supervisorLicenseNumber: 'MD-99887',
      supervisorLicenseState: 'CA',
      supervisorSpecialty: 'Psychiatry',
      supervisorPhone: '555-123-4567',
      supervisorEmail: 'jane.smith@example.com',
      supervisionType: 'DIRECT' as const,
      agreementStartDate: '2024-01-15',
      agreementEndDate: '2025-01-15',
      stateRequirement: 'Required by California Board of Medicine',
      isPrimary: true,
      notes: 'Primary supervising physician',
    };

    const validMinimal = {
      supervisorFirstName: 'Jane',
      supervisorLastName: 'Smith',
      supervisionType: 'DIRECT' as const,
      agreementStartDate: '2024-01-15',
    };

    it('accepts valid complete input', () => {
      const result = createSupervisingPhysicianSchema.parse(validComplete);
      expect(result.supervisorFirstName).toBe('Jane');
      expect(result.supervisorLastName).toBe('Smith');
      expect(result.supervisorNpi).toBe('1234567890');
      expect(result.supervisorEmail).toBe('jane.smith@example.com');
      expect(result.isPrimary).toBe(true);
    });

    it('accepts valid minimal input (only required fields)', () => {
      const result = createSupervisingPhysicianSchema.parse(validMinimal);
      expect(result.supervisorFirstName).toBe('Jane');
      expect(result.supervisorLastName).toBe('Smith');
      expect(result.supervisionType).toBe('DIRECT');
      expect(result.agreementStartDate).toBe('2024-01-15');
    });

    it('requires supervisorFirstName', () => {
      const { supervisorFirstName, ...rest } = validMinimal;
      expect(() => createSupervisingPhysicianSchema.parse(rest)).toThrow();
    });

    it('requires supervisorLastName', () => {
      const { supervisorLastName, ...rest } = validMinimal;
      expect(() => createSupervisingPhysicianSchema.parse(rest)).toThrow();
    });

    it('requires supervisionType', () => {
      const { supervisionType, ...rest } = validMinimal;
      expect(() => createSupervisingPhysicianSchema.parse(rest)).toThrow();
    });

    it('requires agreementStartDate', () => {
      const { agreementStartDate, ...rest } = validMinimal;
      expect(() => createSupervisingPhysicianSchema.parse(rest)).toThrow();
    });

    it('rejects invalid supervisionType enum value', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisionType: 'INDIRECT' })
      ).toThrow();
    });

    it('rejects empty supervisorFirstName', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorFirstName: '' })
      ).toThrow();
    });

    it('rejects supervisorFirstName exceeding max length', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorFirstName: 'A'.repeat(101) })
      ).toThrow();
    });

    it('rejects supervisorLastName exceeding max length', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorLastName: 'B'.repeat(101) })
      ).toThrow();
    });

    it('rejects supervisorNpi with wrong length', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorNpi: '12345' })
      ).toThrow();
    });

    it('rejects supervisorNpi with 11 characters', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorNpi: '12345678901' })
      ).toThrow();
    });

    it('accepts supervisorNpi with exactly 10 characters', () => {
      const result = createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorNpi: '1234567890' });
      expect(result.supervisorNpi).toBe('1234567890');
    });

    it('rejects supervisorLicenseState with wrong length', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorLicenseState: 'CAL' })
      ).toThrow();
    });

    it('accepts supervisorLicenseState with exactly 2 characters', () => {
      const result = createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorLicenseState: 'NY' });
      expect(result.supervisorLicenseState).toBe('NY');
    });

    it('rejects invalid supervisorEmail format', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisorEmail: 'not-an-email' })
      ).toThrow();
    });

    it('validates date format YYYY-MM-DD for agreementStartDate', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, agreementStartDate: '01/15/2024' })
      ).toThrow();
    });

    it('validates date format YYYY-MM-DD for agreementEndDate', () => {
      expect(() =>
        createSupervisingPhysicianSchema.parse({ ...validMinimal, agreementEndDate: '2025-1-15' })
      ).toThrow();
    });

    it('defaults isPrimary to false', () => {
      const result = createSupervisingPhysicianSchema.parse(validMinimal);
      expect(result.isPrimary).toBe(false);
    });

    it('accepts all supervisionType enum values', () => {
      for (const type of ['DIRECT', 'GENERAL', 'COLLABORATIVE', 'ADMINISTRATIVE']) {
        expect(() =>
          createSupervisingPhysicianSchema.parse({ ...validMinimal, supervisionType: type })
        ).not.toThrow();
      }
    });
  });

  // ==========================================
  // createMalpracticeClaimSchema
  // ==========================================

  describe('createMalpracticeClaimSchema', () => {
    const validComplete = {
      dateOfIncident: '2022-03-15',
      dateOfClaim: '2022-06-01',
      claimStatus: 'SETTLED' as const,
      description: 'Patient alleged inadequate follow-up care after discharge.',
      settlementAmount: 50000,
      judgmentAmount: 0,
      dateResolved: '2023-09-01',
      insuranceCarrier: 'MMIC Group',
      policyNumber: 'POL-2022-98765',
      courtName: 'Superior Court of California',
      caseNumber: 'CV-2022-12345',
      notes: 'Settled without admission of liability',
    };

    const validMinimal = {
      dateOfIncident: '2022-03-15',
      dateOfClaim: '2022-06-01',
      claimStatus: 'OPEN' as const,
      description: 'Patient complaint regarding treatment outcome.',
    };

    it('accepts valid complete input', () => {
      const result = createMalpracticeClaimSchema.parse(validComplete);
      expect(result.claimStatus).toBe('SETTLED');
      expect(result.settlementAmount).toBe(50000);
      expect(result.courtName).toBe('Superior Court of California');
    });

    it('accepts valid minimal input (only required fields)', () => {
      const result = createMalpracticeClaimSchema.parse(validMinimal);
      expect(result.dateOfIncident).toBe('2022-03-15');
      expect(result.dateOfClaim).toBe('2022-06-01');
      expect(result.claimStatus).toBe('OPEN');
      expect(result.description).toBe('Patient complaint regarding treatment outcome.');
    });

    it('requires dateOfIncident', () => {
      const { dateOfIncident, ...rest } = validMinimal;
      expect(() => createMalpracticeClaimSchema.parse(rest)).toThrow();
    });

    it('requires dateOfClaim', () => {
      const { dateOfClaim, ...rest } = validMinimal;
      expect(() => createMalpracticeClaimSchema.parse(rest)).toThrow();
    });

    it('requires claimStatus', () => {
      const { claimStatus, ...rest } = validMinimal;
      expect(() => createMalpracticeClaimSchema.parse(rest)).toThrow();
    });

    it('requires description', () => {
      const { description, ...rest } = validMinimal;
      expect(() => createMalpracticeClaimSchema.parse(rest)).toThrow();
    });

    it('rejects invalid claimStatus enum value', () => {
      expect(() =>
        createMalpracticeClaimSchema.parse({ ...validMinimal, claimStatus: 'PENDING_REVIEW' })
      ).toThrow();
    });

    it('rejects empty description', () => {
      expect(() =>
        createMalpracticeClaimSchema.parse({ ...validMinimal, description: '' })
      ).toThrow();
    });

    it('rejects description exceeding 5000 characters', () => {
      expect(() =>
        createMalpracticeClaimSchema.parse({ ...validMinimal, description: 'A'.repeat(5001) })
      ).toThrow();
    });

    it('accepts description at exactly 5000 characters', () => {
      const result = createMalpracticeClaimSchema.parse({
        ...validMinimal,
        description: 'A'.repeat(5000),
      });
      expect(result.description).toHaveLength(5000);
    });

    it('rejects negative settlementAmount', () => {
      expect(() =>
        createMalpracticeClaimSchema.parse({ ...validMinimal, settlementAmount: -100 })
      ).toThrow();
    });

    it('accepts zero settlementAmount', () => {
      const result = createMalpracticeClaimSchema.parse({ ...validMinimal, settlementAmount: 0 });
      expect(result.settlementAmount).toBe(0);
    });

    it('rejects negative judgmentAmount', () => {
      expect(() =>
        createMalpracticeClaimSchema.parse({ ...validMinimal, judgmentAmount: -1 })
      ).toThrow();
    });

    it('accepts zero judgmentAmount', () => {
      const result = createMalpracticeClaimSchema.parse({ ...validMinimal, judgmentAmount: 0 });
      expect(result.judgmentAmount).toBe(0);
    });

    it('validates date format YYYY-MM-DD for dateOfIncident', () => {
      expect(() =>
        createMalpracticeClaimSchema.parse({ ...validMinimal, dateOfIncident: '03-15-2022' })
      ).toThrow();
    });

    it('validates date format YYYY-MM-DD for dateOfClaim', () => {
      expect(() =>
        createMalpracticeClaimSchema.parse({ ...validMinimal, dateOfClaim: 'June 1, 2022' })
      ).toThrow();
    });

    it('validates date format YYYY-MM-DD for dateResolved', () => {
      expect(() =>
        createMalpracticeClaimSchema.parse({ ...validMinimal, dateResolved: '2023/09/01' })
      ).toThrow();
    });

    it('accepts all claimStatus enum values', () => {
      for (const status of ['OPEN', 'SETTLED', 'DISMISSED', 'JUDGMENT_FOR_PROVIDER', 'JUDGMENT_AGAINST_PROVIDER', 'WITHDRAWN']) {
        expect(() =>
          createMalpracticeClaimSchema.parse({ ...validMinimal, claimStatus: status })
        ).not.toThrow();
      }
    });
  });

  // ==========================================
  // createDisclosureSchema
  // ==========================================

  describe('createDisclosureSchema', () => {
    const validComplete = {
      category: 'FELONY_CONVICTION' as const,
      questionText: 'Have you ever been convicted of a felony?',
      answer: true,
      explanation: 'Convicted of a misdemeanor DUI in 2015, later expunged.',
      dateOfOccurrence: '2015-08-20',
      state: 'TX',
      resolutionDetails: 'Record expunged per court order dated 2020-03-01.',
    };

    const validMinimal = {
      category: 'LICENSE_ACTION' as const,
      questionText: 'Has your license ever been revoked or suspended?',
    };

    it('accepts valid complete input', () => {
      const result = createDisclosureSchema.parse(validComplete);
      expect(result.category).toBe('FELONY_CONVICTION');
      expect(result.answer).toBe(true);
      expect(result.state).toBe('TX');
    });

    it('accepts valid minimal input (only required fields)', () => {
      const result = createDisclosureSchema.parse(validMinimal);
      expect(result.category).toBe('LICENSE_ACTION');
      expect(result.questionText).toBe('Has your license ever been revoked or suspended?');
    });

    it('requires category', () => {
      const { category, ...rest } = validMinimal;
      expect(() => createDisclosureSchema.parse(rest)).toThrow();
    });

    it('requires questionText', () => {
      const { questionText, ...rest } = validMinimal;
      expect(() => createDisclosureSchema.parse(rest)).toThrow();
    });

    it('rejects invalid category enum value', () => {
      expect(() =>
        createDisclosureSchema.parse({ ...validMinimal, category: 'TAX_EVASION' })
      ).toThrow();
    });

    it('rejects empty questionText', () => {
      expect(() =>
        createDisclosureSchema.parse({ ...validMinimal, questionText: '' })
      ).toThrow();
    });

    it('rejects questionText exceeding 5000 characters', () => {
      expect(() =>
        createDisclosureSchema.parse({ ...validMinimal, questionText: 'Q'.repeat(5001) })
      ).toThrow();
    });

    it('accepts questionText at exactly 5000 characters', () => {
      const result = createDisclosureSchema.parse({
        ...validMinimal,
        questionText: 'Q'.repeat(5000),
      });
      expect(result.questionText).toHaveLength(5000);
    });

    it('defaults answer to false', () => {
      const result = createDisclosureSchema.parse(validMinimal);
      expect(result.answer).toBe(false);
    });

    it('rejects state with wrong length', () => {
      expect(() =>
        createDisclosureSchema.parse({ ...validMinimal, state: 'TEX' })
      ).toThrow();
    });

    it('accepts state with exactly 2 characters', () => {
      const result = createDisclosureSchema.parse({ ...validMinimal, state: 'TX' });
      expect(result.state).toBe('TX');
    });

    it('validates date format YYYY-MM-DD for dateOfOccurrence', () => {
      expect(() =>
        createDisclosureSchema.parse({ ...validMinimal, dateOfOccurrence: '08/20/2015' })
      ).toThrow();
    });

    it('rejects explanation exceeding 5000 characters', () => {
      expect(() =>
        createDisclosureSchema.parse({ ...validMinimal, explanation: 'E'.repeat(5001) })
      ).toThrow();
    });

    it('rejects resolutionDetails exceeding 5000 characters', () => {
      expect(() =>
        createDisclosureSchema.parse({ ...validMinimal, resolutionDetails: 'R'.repeat(5001) })
      ).toThrow();
    });

    it('accepts all disclosure category enum values', () => {
      const categories = [
        'LICENSE_ACTION', 'HOSPITAL_PRIVILEGES', 'FELONY_CONVICTION',
        'MISDEMEANOR_CONVICTION', 'SUBSTANCE_ABUSE', 'MALPRACTICE',
        'MEDICARE_MEDICAID', 'BOARD_ACTION', 'INSURANCE_DENIAL',
        'ABILITY_TO_PERFORM', 'OTHER',
      ];
      for (const cat of categories) {
        expect(() =>
          createDisclosureSchema.parse({ ...validMinimal, category: cat })
        ).not.toThrow();
      }
    });
  });

  // ==========================================
  // createDeaRegistrationSchema
  // ==========================================

  describe('createDeaRegistrationSchema', () => {
    const validComplete = {
      deaNumber: 'AB1234567',
      deaState: 'NY',
      deaSchedules: ['II', 'III', 'IV', 'V'],
      issueDate: '2023-01-01',
      expirationDate: '2026-01-01',
      status: 'active' as const,
      notes: 'Federal DEA registration',
    };

    const validMinimal = {
      deaNumber: 'AB1234567',
      issueDate: '2023-01-01',
      expirationDate: '2026-01-01',
    };

    it('accepts valid complete input', () => {
      const result = createDeaRegistrationSchema.parse(validComplete);
      expect(result.deaNumber).toBe('AB1234567');
      expect(result.deaState).toBe('NY');
      expect(result.deaSchedules).toEqual(['II', 'III', 'IV', 'V']);
      expect(result.status).toBe('active');
    });

    it('accepts valid minimal input (only required fields)', () => {
      const result = createDeaRegistrationSchema.parse(validMinimal);
      expect(result.deaNumber).toBe('AB1234567');
      expect(result.issueDate).toBe('2023-01-01');
      expect(result.expirationDate).toBe('2026-01-01');
    });

    it('requires deaNumber', () => {
      const { deaNumber, ...rest } = validMinimal;
      expect(() => createDeaRegistrationSchema.parse(rest)).toThrow();
    });

    it('requires issueDate', () => {
      const { issueDate, ...rest } = validMinimal;
      expect(() => createDeaRegistrationSchema.parse(rest)).toThrow();
    });

    it('requires expirationDate', () => {
      const { expirationDate, ...rest } = validMinimal;
      expect(() => createDeaRegistrationSchema.parse(rest)).toThrow();
    });

    it('rejects empty deaNumber', () => {
      expect(() =>
        createDeaRegistrationSchema.parse({ ...validMinimal, deaNumber: '' })
      ).toThrow();
    });

    it('rejects deaNumber exceeding 20 characters', () => {
      expect(() =>
        createDeaRegistrationSchema.parse({ ...validMinimal, deaNumber: 'D'.repeat(21) })
      ).toThrow();
    });

    it('accepts deaNumber at exactly 20 characters', () => {
      const result = createDeaRegistrationSchema.parse({
        ...validMinimal,
        deaNumber: 'D'.repeat(20),
      });
      expect(result.deaNumber).toHaveLength(20);
    });

    it('rejects deaState with wrong length', () => {
      expect(() =>
        createDeaRegistrationSchema.parse({ ...validMinimal, deaState: 'NYC' })
      ).toThrow();
    });

    it('accepts deaState with exactly 2 characters', () => {
      const result = createDeaRegistrationSchema.parse({ ...validMinimal, deaState: 'CA' });
      expect(result.deaState).toBe('CA');
    });

    it('validates date format YYYY-MM-DD for issueDate', () => {
      expect(() =>
        createDeaRegistrationSchema.parse({ ...validMinimal, issueDate: '01-01-2023' })
      ).toThrow();
    });

    it('validates date format YYYY-MM-DD for expirationDate', () => {
      expect(() =>
        createDeaRegistrationSchema.parse({ ...validMinimal, expirationDate: '2026/01/01' })
      ).toThrow();
    });

    it('defaults status to active', () => {
      const result = createDeaRegistrationSchema.parse(validMinimal);
      expect(result.status).toBe('active');
    });

    it('defaults deaSchedules to empty array', () => {
      const result = createDeaRegistrationSchema.parse(validMinimal);
      expect(result.deaSchedules).toEqual([]);
    });

    it('rejects invalid status enum value', () => {
      expect(() =>
        createDeaRegistrationSchema.parse({ ...validMinimal, status: 'suspended' })
      ).toThrow();
    });

    it('accepts all valid status enum values', () => {
      for (const status of ['active', 'expired', 'pending', 'revoked']) {
        expect(() =>
          createDeaRegistrationSchema.parse({ ...validMinimal, status })
        ).not.toThrow();
      }
    });

    it('accepts deaSchedules as an array of strings', () => {
      const result = createDeaRegistrationSchema.parse({
        ...validMinimal,
        deaSchedules: ['II', 'IV'],
      });
      expect(result.deaSchedules).toEqual(['II', 'IV']);
    });

    it('rejects deaSchedule entries exceeding 5 characters', () => {
      expect(() =>
        createDeaRegistrationSchema.parse({ ...validMinimal, deaSchedules: ['TOOLONG'] })
      ).toThrow();
    });
  });

  // ==========================================
  // createBankingSchema
  // ==========================================

  describe('createBankingSchema', () => {
    const validComplete = {
      bankName: 'Chase Bank',
      bankAccountType: 'CHECKING' as const,
      routingNumber: '021000021',
      accountNumber: '123456789012',
      accountHolderName: 'Dr. Jane Smith MD',
      accountHolderTaxId: '12-3456789',
      eftAuthorizationDate: '2024-01-10',
      w9OnFile: true,
      voidedCheckOnFile: true,
      isPrimary: true,
      notes: 'Primary operating account',
    };

    const validMinimal = {
      bankName: 'Chase Bank',
      bankAccountType: 'CHECKING' as const,
      routingNumber: '021000021',
      accountNumber: '123456789012',
      accountHolderName: 'Dr. Jane Smith MD',
    };

    it('accepts valid complete input', () => {
      const result = createBankingSchema.parse(validComplete);
      expect(result.bankName).toBe('Chase Bank');
      expect(result.routingNumber).toBe('021000021');
      expect(result.w9OnFile).toBe(true);
      expect(result.isPrimary).toBe(true);
    });

    it('accepts valid minimal input (only required fields)', () => {
      const result = createBankingSchema.parse(validMinimal);
      expect(result.bankName).toBe('Chase Bank');
      expect(result.bankAccountType).toBe('CHECKING');
      expect(result.accountNumber).toBe('123456789012');
    });

    it('requires bankName', () => {
      const { bankName, ...rest } = validMinimal;
      expect(() => createBankingSchema.parse(rest)).toThrow();
    });

    it('requires bankAccountType', () => {
      const { bankAccountType, ...rest } = validMinimal;
      expect(() => createBankingSchema.parse(rest)).toThrow();
    });

    it('requires routingNumber', () => {
      const { routingNumber, ...rest } = validMinimal;
      expect(() => createBankingSchema.parse(rest)).toThrow();
    });

    it('requires accountNumber', () => {
      const { accountNumber, ...rest } = validMinimal;
      expect(() => createBankingSchema.parse(rest)).toThrow();
    });

    it('requires accountHolderName', () => {
      const { accountHolderName, ...rest } = validMinimal;
      expect(() => createBankingSchema.parse(rest)).toThrow();
    });

    it('rejects empty bankName', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, bankName: '' })
      ).toThrow();
    });

    it('rejects bankName exceeding 200 characters', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, bankName: 'B'.repeat(201) })
      ).toThrow();
    });

    it('rejects invalid bankAccountType enum value', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, bankAccountType: 'MONEY_MARKET' })
      ).toThrow();
    });

    it('rejects routingNumber shorter than 9 characters', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, routingNumber: '02100002' })
      ).toThrow();
    });

    it('rejects routingNumber longer than 9 characters', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, routingNumber: '0210000210' })
      ).toThrow();
    });

    it('accepts routingNumber with exactly 9 characters', () => {
      const result = createBankingSchema.parse(validMinimal);
      expect(result.routingNumber).toBe('021000021');
      expect(result.routingNumber).toHaveLength(9);
    });

    it('rejects accountNumber shorter than 4 characters', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, accountNumber: '123' })
      ).toThrow();
    });

    it('rejects accountNumber longer than 17 characters', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, accountNumber: '123456789012345678' })
      ).toThrow();
    });

    it('accepts accountNumber at minimum length (4 characters)', () => {
      const result = createBankingSchema.parse({ ...validMinimal, accountNumber: '1234' });
      expect(result.accountNumber).toBe('1234');
    });

    it('accepts accountNumber at maximum length (17 characters)', () => {
      const result = createBankingSchema.parse({ ...validMinimal, accountNumber: '12345678901234567' });
      expect(result.accountNumber).toBe('12345678901234567');
    });

    it('rejects empty accountHolderName', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, accountHolderName: '' })
      ).toThrow();
    });

    it('rejects accountHolderName exceeding 200 characters', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, accountHolderName: 'N'.repeat(201) })
      ).toThrow();
    });

    it('validates date format YYYY-MM-DD for eftAuthorizationDate', () => {
      expect(() =>
        createBankingSchema.parse({ ...validMinimal, eftAuthorizationDate: '01/10/2024' })
      ).toThrow();
    });

    it('defaults w9OnFile to false', () => {
      const result = createBankingSchema.parse(validMinimal);
      expect(result.w9OnFile).toBe(false);
    });

    it('defaults voidedCheckOnFile to false', () => {
      const result = createBankingSchema.parse(validMinimal);
      expect(result.voidedCheckOnFile).toBe(false);
    });

    it('defaults isPrimary to false', () => {
      const result = createBankingSchema.parse(validMinimal);
      expect(result.isPrimary).toBe(false);
    });

    it('accepts both bankAccountType enum values', () => {
      for (const type of ['CHECKING', 'SAVINGS']) {
        expect(() =>
          createBankingSchema.parse({ ...validMinimal, bankAccountType: type })
        ).not.toThrow();
      }
    });
  });

  // ==========================================
  // upsertDemographicsSchema
  // ==========================================

  describe('upsertDemographicsSchema', () => {
    const validComplete = {
      birthCity: 'Chicago',
      birthState: 'IL',
      birthCountry: 'United States',
      citizenshipStatus: 'US_CITIZEN' as const,
      visaType: 'H-1B',
      visaExpirationDate: '2027-06-15',
      previousNames: ['Jane Doe', 'Jane Johnson'],
      ethnicity: 'Hispanic',
      race: 'White',
      emergencyContactName: 'John Smith',
      emergencyContactPhone: '555-987-6543',
      emergencyContactRelation: 'Spouse',
    };

    it('accepts valid complete input', () => {
      const result = upsertDemographicsSchema.parse(validComplete);
      expect(result.birthCity).toBe('Chicago');
      expect(result.birthState).toBe('IL');
      expect(result.citizenshipStatus).toBe('US_CITIZEN');
      expect(result.previousNames).toEqual(['Jane Doe', 'Jane Johnson']);
    });

    it('accepts empty object (all fields optional)', () => {
      const result = upsertDemographicsSchema.parse({});
      expect(result).toBeDefined();
    });

    it('rejects birthState with wrong length', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ birthState: 'ILL' })
      ).toThrow();
    });

    it('rejects birthState with 1 character', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ birthState: 'I' })
      ).toThrow();
    });

    it('accepts birthState with exactly 2 characters', () => {
      const result = upsertDemographicsSchema.parse({ birthState: 'IL' });
      expect(result.birthState).toBe('IL');
    });

    it('rejects invalid citizenshipStatus enum value', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ citizenshipStatus: 'TOURIST_VISA' })
      ).toThrow();
    });

    it('accepts all citizenshipStatus enum values', () => {
      for (const status of ['US_CITIZEN', 'PERMANENT_RESIDENT', 'WORK_VISA', 'OTHER']) {
        expect(() =>
          upsertDemographicsSchema.parse({ citizenshipStatus: status })
        ).not.toThrow();
      }
    });

    it('validates date format YYYY-MM-DD for visaExpirationDate', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ visaExpirationDate: '06/15/2027' })
      ).toThrow();
    });

    it('defaults previousNames to empty array', () => {
      const result = upsertDemographicsSchema.parse({});
      expect(result.previousNames).toEqual([]);
    });

    it('accepts previousNames as an array of strings', () => {
      const result = upsertDemographicsSchema.parse({ previousNames: ['Smith', 'Jones'] });
      expect(result.previousNames).toEqual(['Smith', 'Jones']);
    });

    it('rejects previousNames entries exceeding 200 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ previousNames: ['N'.repeat(201)] })
      ).toThrow();
    });

    it('rejects birthCity exceeding 100 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ birthCity: 'C'.repeat(101) })
      ).toThrow();
    });

    it('rejects birthCountry exceeding 100 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ birthCountry: 'C'.repeat(101) })
      ).toThrow();
    });

    it('rejects visaType exceeding 100 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ visaType: 'V'.repeat(101) })
      ).toThrow();
    });

    it('rejects ethnicity exceeding 100 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ ethnicity: 'E'.repeat(101) })
      ).toThrow();
    });

    it('rejects race exceeding 100 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ race: 'R'.repeat(101) })
      ).toThrow();
    });

    it('rejects emergencyContactName exceeding 200 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ emergencyContactName: 'N'.repeat(201) })
      ).toThrow();
    });

    it('rejects emergencyContactPhone exceeding 20 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ emergencyContactPhone: 'P'.repeat(21) })
      ).toThrow();
    });

    it('rejects emergencyContactRelation exceeding 100 characters', () => {
      expect(() =>
        upsertDemographicsSchema.parse({ emergencyContactRelation: 'R'.repeat(101) })
      ).toThrow();
    });
  });

  // ==========================================
  // createProviderIdentifierSchema
  // ==========================================

  describe('createProviderIdentifierSchema', () => {
    const validComplete = {
      identifierType: 'MEDICARE_PTAN' as const,
      identifierValue: 'PTAN-123456',
      issuingEntity: 'Centers for Medicare & Medicaid Services',
      state: 'FL',
      effectiveDate: '2023-07-01',
      expirationDate: '2026-07-01',
      status: 'active' as const,
      notes: 'Medicare Part B PTAN',
    };

    const validMinimal = {
      identifierType: 'MEDICAID_ID' as const,
      identifierValue: 'MCD-987654',
    };

    it('accepts valid complete input', () => {
      const result = createProviderIdentifierSchema.parse(validComplete);
      expect(result.identifierType).toBe('MEDICARE_PTAN');
      expect(result.identifierValue).toBe('PTAN-123456');
      expect(result.issuingEntity).toBe('Centers for Medicare & Medicaid Services');
      expect(result.status).toBe('active');
    });

    it('accepts valid minimal input (only required fields)', () => {
      const result = createProviderIdentifierSchema.parse(validMinimal);
      expect(result.identifierType).toBe('MEDICAID_ID');
      expect(result.identifierValue).toBe('MCD-987654');
    });

    it('requires identifierType', () => {
      const { identifierType, ...rest } = validMinimal;
      expect(() => createProviderIdentifierSchema.parse(rest)).toThrow();
    });

    it('requires identifierValue', () => {
      const { identifierValue, ...rest } = validMinimal;
      expect(() => createProviderIdentifierSchema.parse(rest)).toThrow();
    });

    it('rejects invalid identifierType enum value', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, identifierType: 'SOCIAL_SECURITY' })
      ).toThrow();
    });

    it('rejects empty identifierValue', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, identifierValue: '' })
      ).toThrow();
    });

    it('rejects identifierValue exceeding 100 characters', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, identifierValue: 'X'.repeat(101) })
      ).toThrow();
    });

    it('accepts identifierValue at exactly 100 characters', () => {
      const result = createProviderIdentifierSchema.parse({
        ...validMinimal,
        identifierValue: 'X'.repeat(100),
      });
      expect(result.identifierValue).toHaveLength(100);
    });

    it('rejects state with wrong length', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, state: 'FLA' })
      ).toThrow();
    });

    it('accepts state with exactly 2 characters', () => {
      const result = createProviderIdentifierSchema.parse({ ...validMinimal, state: 'FL' });
      expect(result.state).toBe('FL');
    });

    it('validates date format YYYY-MM-DD for effectiveDate', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, effectiveDate: '07/01/2023' })
      ).toThrow();
    });

    it('validates date format YYYY-MM-DD for expirationDate', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, expirationDate: '2026-7-1' })
      ).toThrow();
    });

    it('defaults status to active', () => {
      const result = createProviderIdentifierSchema.parse(validMinimal);
      expect(result.status).toBe('active');
    });

    it('rejects invalid status enum value', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, status: 'cancelled' })
      ).toThrow();
    });

    it('accepts all valid status enum values', () => {
      for (const status of ['active', 'expired', 'pending', 'revoked']) {
        expect(() =>
          createProviderIdentifierSchema.parse({ ...validMinimal, status })
        ).not.toThrow();
      }
    });

    it('accepts all identifierType enum values', () => {
      const types = [
        'MEDICARE_PTAN', 'MEDICARE_PECOS_ID', 'MEDICAID_ID', 'TRICARE_ID',
        'RAILROAD_MEDICARE_ID', 'STATE_LICENSE_ID', 'PAYER_SPECIFIC_ID', 'UPIN', 'OTHER',
      ];
      for (const type of types) {
        expect(() =>
          createProviderIdentifierSchema.parse({ ...validMinimal, identifierType: type })
        ).not.toThrow();
      }
    });

    it('rejects issuingEntity exceeding 200 characters', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, issuingEntity: 'I'.repeat(201) })
      ).toThrow();
    });

    it('rejects notes exceeding 1000 characters', () => {
      expect(() =>
        createProviderIdentifierSchema.parse({ ...validMinimal, notes: 'N'.repeat(1001) })
      ).toThrow();
    });
  });
});
