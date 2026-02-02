import { z } from 'zod';

// NPI validation: 10-digit number with Luhn check
const npiRegex = /^\d{10}$/;

export const npiSchema = z.string().regex(npiRegex, 'NPI must be exactly 10 digits');

export const phoneSchema = z.string().regex(
  /^\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/,
  'Invalid phone number format'
);

// Optional phone that allows empty string or null
export const optionalPhoneSchema = z.union([
  z.literal(''),
  z.null(),
  phoneSchema,
]).optional().transform(val => val === null ? undefined : val);

export const genderSchema = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);

export const providerTypeSchema = z.enum([
  'psychiatrist',
  'psychologist',
  'lcsw',
  'lpc',
  'lmft',
  'pmhnp',
  'other',
]);

export const providerStatusSchema = z.enum(['active', 'inactive', 'pending']);

export const createProviderSchema = z.object({
  npi: npiSchema,
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  middleName: z.string().max(100).optional(),
  suffix: z.string().max(20).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  gender: genderSchema,
  email: z.string().email('Invalid email address'),
  phone: phoneSchema,
  mobilePhone: optionalPhoneSchema,
  fax: optionalPhoneSchema,
  providerType: providerTypeSchema,
  taxonomy: z.string().max(50).optional(),
  specialties: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
});

export const updateProviderSchema = createProviderSchema.partial().extend({
  status: providerStatusSchema.optional(),
  caqhProviderId: z.union([z.string().max(50), z.null()]).optional().transform(val => val === null ? undefined : val),
});

export const addressSchema = z.object({
  type: z.enum(['home', 'practice', 'mailing', 'billing']),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().length(2, 'State must be 2-letter code'),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
  country: z.string().default('US'),
  isPrimary: z.boolean().default(false),
});

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
