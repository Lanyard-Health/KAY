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

export const practiceSignupSchema = z.object({
  practiceName: z.string().min(2, 'Practice name must be at least 2 characters').max(200),
  firstName: z.string().min(2, 'First name must be at least 2 characters').max(100),
  lastName: z.string().min(2, 'Last name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email format'),
  phone: phoneSchema,
  password: passwordSchema,
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
export type SelfServeSignupInput = z.infer<typeof selfServeSignupSchema>;
