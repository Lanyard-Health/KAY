import { z } from 'zod';
import { npiSchema, genderSchema, providerTypeSchema, phoneSchema } from './provider.js';

export const portalRegistrationSchema = z.object({
  npi: npiSchema,
  firstName: z.string().min(2, 'First name must be at least 2 characters').max(100),
  lastName: z.string().min(2, 'Last name must be at least 2 characters').max(100),
  middleName: z.string().max(100).optional(),
  suffix: z.string().max(20).optional(),
  email: z.string().email('Invalid email format'),
  phone: phoneSchema,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  gender: genderSchema,
  providerType: providerTypeSchema.optional(),
  taxonomy: z.string().max(50).optional(),
  specialties: z.array(z.string()).optional(),
  // Optional at registration — providers without one get the "we'll help you set it up" path.
  // Empty string (untouched form field) is treated as not provided.
  caqhProviderId: z
    .union([
      z.string().trim().regex(/^\d{6,12}$/, 'CAQH Provider ID should be a number (usually 8 digits)'),
      z.literal(''),
    ])
    .optional()
    .transform((val) => (val === '' ? undefined : val)),
  practiceId: z.string().uuid('Invalid practice ID format').optional(),
});

export const markNotificationsReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()).max(100).optional(),
});

const passwordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// Practice ownership disclosure. SSN + DOB are sensitive and encrypted at rest
// (see practiceSignup.service). Empty optional fields are omitted by the client.
export const practiceOwnerSchema = z.object({
  name: z.string().min(1, 'Owner name is required').max(200),
  // Accept "123-45-6789" or "123456789"; deeper validation happens server-side.
  ssn: z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/, 'SSN must be 9 digits').optional(),
  ownershipPercentage: z.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%').optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  homeAddressLine1: z.string().max(200).optional(),
  homeAddressLine2: z.string().max(200).optional(),
  homeCity: z.string().max(100).optional(),
  homeState: z.string().max(2).optional(),
  homeZipCode: z.string().max(10).optional(),
});

export const practiceSignupSchema = z.object({
  practiceName: z.string().min(2, 'Practice name must be at least 2 characters').max(200),
  firstName: z.string().min(2, 'First name must be at least 2 characters').max(100),
  lastName: z.string().min(2, 'Last name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email format'),
  phone: phoneSchema,
  password: passwordSchema,
  addressLine1: z.string().min(2, 'Address is required').max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(2, 'City is required').max(100),
  state: z.string().length(2, 'Must be a 2-letter state abbreviation'),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code format'),
  operatingStates: z.array(z.string().length(2)).min(1, 'At least one operating state is required'),
  targetPayerIds: z.array(z.string().uuid('Invalid payer ID')).min(1, 'At least one target payer is required'),
  isEnterprise: z.boolean().default(false),
  groupNpi: z.string().regex(/^\d{10}$/, 'Must be a 10-digit NPI number').optional(),
  // Group profile intake (all optional at signup; empty string = not provided)
  legalName: z.string().max(200).optional(),
  dba: z.string().max(200).optional(),
  entityType: z.string().max(100).optional(),
  groupTin: z.string().max(20).optional(),
  groupSpecialty: z.string().max(120).optional(),
  emrVendor: z.string().max(120).optional(),
  billingVendor: z.string().max(120).optional(),
  billingClearinghouse: z.string().max(120).optional(),
  // Billing address
  billingAddressLine1: z.string().max(200).optional(),
  billingAddressLine2: z.string().max(200).optional(),
  billingCity: z.string().max(100).optional(),
  billingState: z.string().max(2).optional(),
  billingZipCode: z.string().max(10).optional(),
  // Mailing address
  mailingAddressLine1: z.string().max(200).optional(),
  mailingAddressLine2: z.string().max(200).optional(),
  mailingCity: z.string().max(100).optional(),
  mailingState: z.string().max(2).optional(),
  mailingZipCode: z.string().max(10).optional(),
  // Ownership disclosure — up to 3 owners; beyond that the UI directs them to
  // email credentialing@lanyardhealth.com.
  owners: z.array(practiceOwnerSchema).max(3, 'Up to 3 owners can be added here').optional(),
});

export const selfServeSignupSchema = portalRegistrationSchema.extend({
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export type PortalRegistrationInput = z.infer<typeof portalRegistrationSchema>;
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
export type PracticeSignupInput = z.infer<typeof practiceSignupSchema>;
export type PracticeOwnerInput = z.infer<typeof practiceOwnerSchema>;
export type SelfServeSignupInput = z.infer<typeof selfServeSignupSchema>;
