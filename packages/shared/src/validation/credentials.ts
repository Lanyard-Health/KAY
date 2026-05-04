import { z } from 'zod';

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const licenseTypeSchema = z.enum([
  'state_medical',
  'state_psychology',
  'state_social_work',
  'state_counseling',
  'state_marriage_family',
  'dea',
  'controlled_substance',
  'npi',
]);

export const boardTypeSchema = z.enum([
  'abpn_psychiatry',
  'abpn_child_adolescent',
  'abpn_addiction',
  'abpp_clinical',
  'abpp_counseling',
  'abecsw',
  'nbcc',
  'aamft',
  'ancc_pmhnp',
  'other',
]);

export const degreeTypeSchema = z.enum([
  'md', 'do', 'phd', 'psyd', 'msw', 'ma', 'ms',
  'med', 'dnp', 'msn', 'bs', 'ba', 'other',
]);

export const credentialStatusSchema = z.enum(['active', 'expired', 'pending', 'revoked']);

// License validation
export const createLicenseSchema = z.object({
  licenseType: licenseTypeSchema,
  licenseNumber: z.string().min(1).max(50),
  state: z.string().length(2).optional(),
  issueDate: dateStringSchema,
  expirationDate: dateStringSchema,
  notes: z.string().max(1000).optional(),
});

// Board certification validation
export const createBoardCertificationSchema = z.object({
  boardType: boardTypeSchema,
  boardName: z.string().min(1).max(200),
  certificationNumber: z.string().max(50).optional(),
  specialty: z.string().min(1).max(200),
  initialCertificationDate: dateStringSchema,
  expirationDate: dateStringSchema.optional(),
  isBoardEligible: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
});

// Malpractice insurance validation
export const createMalpracticeInsuranceSchema = z.object({
  carrierName: z.string().min(1).max(200),
  policyNumber: z.string().min(1).max(100),
  coverageType: z.enum(['occurrence', 'claims_made']),
  perClaimAmount: z.number().positive(),
  aggregateAmount: z.number().positive(),
  effectiveDate: dateStringSchema,
  expirationDate: dateStringSchema,
  hasTailCoverage: z.boolean().default(false),
  retroactiveDate: dateStringSchema.optional(),
  hasGapInCoverage: z.boolean().default(false),
  gapExplanation: z.string().max(2000).optional(),
  isSelfInsured: z.boolean().optional(),
  hasUnlimitedCoverage: z.boolean().optional(),
  isIndividualCoverage: z.boolean().optional(),
  coveredLocationIds: z.array(z.string().uuid()).optional(),
  notes: z.string().max(1000).optional(),
});

// Education type enum
export const educationTypeSchema = z.enum([
  'UNDERGRADUATE', 'MEDICAL_SCHOOL', 'GRADUATE_SCHOOL', 'INTERNSHIP',
  'RESIDENCY', 'FELLOWSHIP', 'POST_DOCTORAL', 'CONTINUING_EDUCATION', 'OTHER',
]);

// Education validation
export const createEducationSchema = z.object({
  institutionName: z.string().min(1).max(200),
  degree: degreeTypeSchema,
  fieldOfStudy: z.string().min(1).max(200),
  city: z.string().max(100).optional(),
  state: z.string().length(2).optional(),
  country: z.string().min(2).max(100),
  startDate: dateStringSchema,
  endDate: dateStringSchema.optional(),
  graduationDate: dateStringSchema.optional(),
  isCompleted: z.boolean().default(true),
  educationType: educationTypeSchema.optional(),
  programDirector: z.string().max(200).optional(),
  programDirectorPhone: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

// Work history validation
export const createWorkHistorySchema = z.object({
  organizationName: z.string().min(1).max(200),
  organizationType: z.string().min(1).max(100),
  position: z.string().min(1).max(200),
  department: z.string().max(200).optional(),
  addressLine1: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2).optional(),
  zipCode: z.string().max(10).optional(),
  country: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  startDate: dateStringSchema,
  endDate: dateStringSchema.optional(),
  isCurrent: z.boolean().default(false),
  reasonForLeaving: z.string().max(500).optional(),
  supervisorName: z.string().max(100).optional(),
  supervisorPhone: z.string().max(20).optional(),
  statusDescription: z.string().max(500).optional(),
  workHistoryType: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

// Work history gap validation (CAQH `TimeGap` element)
export const createWorkHistoryGapSchema = z.object({
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  gapExplanation: z.string().max(2000).optional(),
  gapDescription: z.string().max(200).optional(),
});

// Hospital affiliation validation
export const createHospitalAffiliationSchema = z.object({
  facilityName: z.string().min(1).max(200),
  facilityType: z.string().min(1).max(100),
  // Expanded to match the full PrivilegeType enum on the Prisma model.
  privilegeType: z.enum([
    'admitting',
    'courtesy',
    'consulting',
    'temporary',
    'locum_tenens',
    'active',
    'provisional',
    'affiliate',
    'teaching',
  ]),
  status: z.enum(['active', 'pending', 'inactive', 'denied', 'resigned']),
  appointmentDate: dateStringSchema.optional(),
  reappointmentDate: dateStringSchema.optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2).optional(),
  notes: z.string().max(1000).optional(),
  // Facility details (for Aetna enrollment)
  facilityNpi: z.string().max(10).optional(),
  facilityPhone: z.string().max(20).optional(),
  facilityAddressLine1: z.string().max(200).optional(),
  facilityCity: z.string().max(100).optional(),
  facilityState: z.string().length(2).optional(),
  facilityZipCode: z.string().max(10).optional(),

  // CAQH v9 extended fields (Phase 1+2 schema additions). Manual entry
  // is allowed so credentialing staff can complete records that CAQH
  // didn't fully populate.
  caqhAhaId: z.string().max(20).optional(),
  department: z.string().max(200).optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  admissionPercent: z.number().int().min(0).max(100).optional(),
  reasonForDiscontinuance: z.string().max(500).optional(),
  exitExplanation: z.string().max(2000).optional(),
  staffCategory: z.string().max(100).optional(),
  phoneNumber: z.string().max(20).optional(),
  faxNumber: z.string().max(20).optional(),
  privilegeDescription: z.string().max(500).optional(),
  hasUnrestrictedPrivileges: z.boolean().optional(),
  hasTemporaryPrivileges: z.boolean().optional(),
  description: z.string().max(2000).optional(),
  hospitalAffiliationType: z.string().max(100).optional(),
  hospitalRecordType: z.string().max(100).optional(),
  nonAhaHospitalName: z.string().max(200).optional(),
  addressLine1: z.string().max(200).optional(),
  zipCode: z.string().max(10).optional(),
  country: z.string().max(100).optional(),

  // Admitter sub-fields (populated when WhoAdmitsForYou is set in CAQH)
  whoAdmitsForYou: z.string().max(200).optional(),
  admittingProviderFirstName: z.string().max(100).optional(),
  admittingProviderLastName: z.string().max(100).optional(),
  admittingContactPhone: z.string().max(20).optional(),
  admittingContactEmail: z.string().email().optional().or(z.literal('')),
  isAdmitterSameSpecialty: z.boolean().optional(),
});

// Professional reference validation
export const createProfessionalReferenceSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().min(1).max(100),
  organization: z.string().min(1).max(200),
  relationship: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(1).max(20),
  yearsKnown: z.number().int().positive().max(99),
  canContact: z.boolean().default(true),
  notes: z.string().max(1000).optional(),
});

// Disciplinary action validation
export const createDisciplinaryActionSchema = z.object({
  actionType: z.enum(['license_action', 'hospital_action', 'malpractice_claim', 'legal_action', 'other']),
  description: z.string().min(1).max(2000),
  dateOfAction: dateStringSchema,
  state: z.string().length(2).optional(),
  agency: z.string().max(200).optional(),
  outcome: z.string().max(1000).optional(),
  isResolved: z.boolean().default(false),
  resolutionDate: dateStringSchema.optional(),
  notes: z.string().max(1000).optional(),
});

// Continuing education validation
export const createContinuingEducationSchema = z.object({
  courseName: z.string().min(1).max(200),
  provider: z.string().min(1).max(200),
  credits: z.number().positive(),
  creditType: z.string().min(1).max(50),
  completionDate: dateStringSchema,
  certificateNumber: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
});

// ==========================================
// PAYER ENROLLMENT SCHEMAS
// ==========================================

export const supervisionTypeSchema = z.enum(['DIRECT', 'GENERAL', 'COLLABORATIVE', 'ADMINISTRATIVE']);
export const claimStatusSchema = z.enum(['OPEN', 'SETTLED', 'DISMISSED', 'JUDGMENT_FOR_PROVIDER', 'JUDGMENT_AGAINST_PROVIDER', 'WITHDRAWN']);
export const disclosureCategorySchema = z.enum([
  'LICENSE_ACTION', 'HOSPITAL_PRIVILEGES', 'FELONY_CONVICTION', 'MISDEMEANOR_CONVICTION',
  'SUBSTANCE_ABUSE', 'MALPRACTICE', 'MEDICARE_MEDICAID', 'BOARD_ACTION',
  'INSURANCE_DENIAL', 'ABILITY_TO_PERFORM', 'OTHER',
]);
export const identifierTypeSchema = z.enum([
  'MEDICARE_PTAN', 'MEDICARE_PECOS_ID', 'MEDICAID_ID', 'TRICARE_ID',
  'RAILROAD_MEDICARE_ID', 'STATE_LICENSE_ID', 'PAYER_SPECIFIC_ID', 'UPIN', 'OTHER',
]);
export const bankAccountTypeSchema = z.enum(['CHECKING', 'SAVINGS']);
export const citizenshipStatusSchema = z.enum(['US_CITIZEN', 'PERMANENT_RESIDENT', 'WORK_VISA', 'OTHER']);

// Supervising physician validation
export const createSupervisingPhysicianSchema = z.object({
  supervisorFirstName: z.string().min(1).max(100),
  supervisorLastName: z.string().min(1).max(100),
  supervisorMiddleName: z.string().max(100).optional(),
  supervisorNpi: z.string().length(10).optional(),
  supervisorLicenseNumber: z.string().max(50).optional(),
  supervisorLicenseState: z.string().length(2).optional(),
  supervisorSpecialty: z.string().max(200).optional(),
  supervisorPhone: z.string().max(20).optional(),
  supervisorEmail: z.string().email().optional(),
  supervisionType: supervisionTypeSchema,
  agreementStartDate: dateStringSchema,
  agreementEndDate: dateStringSchema.optional(),
  stateRequirement: z.string().max(500).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
});

// Malpractice claim validation
export const createMalpracticeClaimSchema = z.object({
  dateOfIncident: dateStringSchema,
  dateOfClaim: dateStringSchema,
  claimStatus: claimStatusSchema,
  description: z.string().min(1).max(5000),
  settlementAmount: z.number().nonnegative().optional(),
  judgmentAmount: z.number().nonnegative().optional(),
  dateResolved: dateStringSchema.optional(),
  insuranceCarrier: z.string().max(200).optional(),
  policyNumber: z.string().max(100).optional(),
  courtName: z.string().max(200).optional(),
  caseNumber: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),

  // CAQH v9 extended fields. Manual entry is allowed so credentialing
  // staff can complete records that CAQH didn't fully populate.
  caqhClaimId: z.string().max(100).optional(),
  allegationDescription: z.string().max(5000).optional(),
  patientInjuryDescription: z.string().max(5000).optional(),
  defendantRole: z.string().max(200).optional(),
  isLeadDefendant: z.boolean().optional(),
  numberOtherCodefendants: z.number().int().nonnegative().optional(),
  caseInvolvement: z.string().max(2000).optional(),
  npdbReported: z.boolean().optional(),
  patientDied: z.boolean().optional(),
  resolutionMethod: z.string().max(200).optional(),
  settlementAmountPaid: z.number().nonnegative().optional(),
  patientGenderAge: z.string().max(100).optional(),
  narrative: z.string().max(5000).optional(),
  // Court / litigation address (separate from `courtName`)
  courtAddressLine1: z.string().max(200).optional(),
  courtCity: z.string().max(100).optional(),
  courtState: z.string().length(2).optional(),
  courtZipCode: z.string().max(10).optional(),
  courtPhone: z.string().max(20).optional(),
  courtCountry: z.string().max(100).optional(),
});

// Disclosure validation
export const createDisclosureSchema = z.object({
  category: disclosureCategorySchema,
  questionText: z.string().min(1).max(5000),
  answer: z.boolean().default(false),
  explanation: z.string().max(5000).optional(),
  dateOfOccurrence: dateStringSchema.optional(),
  state: z.string().length(2).optional(),
  resolutionDetails: z.string().max(5000).optional(),
});

// DEA registration validation
export const createDeaRegistrationSchema = z.object({
  deaNumber: z.string().min(1).max(20),
  deaState: z.string().length(2).optional(),
  deaSchedules: z.array(z.string().max(5)).default([]),
  issueDate: dateStringSchema,
  expirationDate: dateStringSchema,
  buprenorphineWaiver: z.boolean().optional(),
  status: credentialStatusSchema.default('active'),
  notes: z.string().max(1000).optional(),
});

// CDS registration validation (state-issued controlled-substance registration,
// independent of federal DEA). cdsNumber is encrypted via encryptSafe() before persistence.
export const createCdsRegistrationSchema = z.object({
  cdsNumber: z.string().min(1).max(50),
  state: z.string().length(2),
  issueDate: dateStringSchema.optional(),
  expirationDate: dateStringSchema.optional(),
  status: credentialStatusSchema.default('active'),
  notes: z.string().max(1000).optional(),
});

// Provider certification validation (life-support / vocational certs: BLS, ACLS, CPR, PALS, other).
export const providerCertificationTypeSchema = z.enum(['acls', 'bls', 'cpr', 'pals', 'other']);
export const createProviderCertificationSchema = z.object({
  certType: providerCertificationTypeSchema,
  certDescription: z.string().min(1).max(200),
  certNumber: z.string().max(100).optional(),
  issuingAuthority: z.string().max(200).optional(),
  issueDate: dateStringSchema.optional(),
  expirationDate: dateStringSchema.optional(),
  status: credentialStatusSchema.default('active'),
  notes: z.string().max(1000).optional(),
});

// Provider identifier validation
export const createProviderIdentifierSchema = z.object({
  identifierType: identifierTypeSchema,
  identifierValue: z.string().min(1).max(100),
  issuingEntity: z.string().max(200).optional(),
  state: z.string().length(2).optional(),
  effectiveDate: dateStringSchema.optional(),
  expirationDate: dateStringSchema.optional(),
  status: credentialStatusSchema.default('active'),
  notes: z.string().max(1000).optional(),
});

// Banking validation
export const createBankingSchema = z.object({
  bankName: z.string().min(1).max(200),
  bankAccountType: bankAccountTypeSchema,
  routingNumber: z.string().length(9, 'Routing number must be 9 digits'),
  accountNumber: z.string().min(4).max(17),
  accountHolderName: z.string().min(1).max(200),
  accountHolderTaxId: z.string().max(20).optional(),
  eftAuthorizationDate: dateStringSchema.optional(),
  w9OnFile: z.boolean().default(false),
  voidedCheckOnFile: z.boolean().default(false),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
});

// Demographics validation (upsert — all fields optional)
// Uses null→undefined transform because this serves both create and update paths.
const n = <T extends z.ZodTypeAny>(s: T) => z.union([s, z.null()]).optional().transform((v: z.input<T> | null | undefined) => v === null ? undefined : v);
export const upsertDemographicsSchema = z.object({
  birthCity: n(z.string().max(100)),
  birthState: n(z.string().length(2)),
  birthCountry: n(z.string().max(100)),
  citizenshipStatus: n(citizenshipStatusSchema),
  visaType: n(z.string().max(100)),
  visaExpirationDate: n(dateStringSchema),
  previousNames: z.array(z.string().max(200)).default([]),
  ethnicity: n(z.string().max(100)),
  race: n(z.string().max(100)),
  emergencyContactName: n(z.string().max(200)),
  emergencyContactPhone: n(z.string().max(20)),
  emergencyContactRelation: n(z.string().max(100)),
});

// Export types
export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;
export type CreateBoardCertificationInput = z.infer<typeof createBoardCertificationSchema>;
export type CreateMalpracticeInsuranceInput = z.infer<typeof createMalpracticeInsuranceSchema>;
export type CreateEducationInput = z.infer<typeof createEducationSchema>;
export type CreateWorkHistoryInput = z.infer<typeof createWorkHistorySchema>;
export type CreateHospitalAffiliationInput = z.infer<typeof createHospitalAffiliationSchema>;
export type CreateProfessionalReferenceInput = z.infer<typeof createProfessionalReferenceSchema>;
export type CreateDisciplinaryActionInput = z.infer<typeof createDisciplinaryActionSchema>;
export type CreateContinuingEducationInput = z.infer<typeof createContinuingEducationSchema>;
export type CreateSupervisingPhysicianInput = z.infer<typeof createSupervisingPhysicianSchema>;
export type CreateMalpracticeClaimInput = z.infer<typeof createMalpracticeClaimSchema>;
export type CreateDisclosureInput = z.infer<typeof createDisclosureSchema>;
export type CreateDeaRegistrationInput = z.infer<typeof createDeaRegistrationSchema>;
export type CreateCdsRegistrationInput = z.infer<typeof createCdsRegistrationSchema>;
export type CreateProviderCertificationInput = z.infer<typeof createProviderCertificationSchema>;
export type CreateProviderIdentifierInput = z.infer<typeof createProviderIdentifierSchema>;
export type CreateBankingInput = z.infer<typeof createBankingSchema>;
export type UpsertDemographicsInput = z.infer<typeof upsertDemographicsSchema>;
