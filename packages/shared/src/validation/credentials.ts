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
  notes: z.string().max(1000).optional(),
});

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
  phone: z.string().max(20).optional(),
  startDate: dateStringSchema,
  endDate: dateStringSchema.optional(),
  isCurrent: z.boolean().default(false),
  reasonForLeaving: z.string().max(500).optional(),
  supervisorName: z.string().max(100).optional(),
  supervisorPhone: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

// Hospital affiliation validation
export const createHospitalAffiliationSchema = z.object({
  facilityName: z.string().min(1).max(200),
  facilityType: z.string().min(1).max(100),
  privilegeType: z.enum(['admitting', 'courtesy', 'consulting', 'temporary', 'locum_tenens']),
  status: z.enum(['active', 'pending', 'inactive', 'denied', 'resigned']),
  appointmentDate: dateStringSchema.optional(),
  reappointmentDate: dateStringSchema.optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2).optional(),
  notes: z.string().max(1000).optional(),
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
