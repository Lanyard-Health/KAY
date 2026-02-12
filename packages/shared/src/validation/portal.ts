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

export type PortalRegistrationInput = z.infer<typeof portalRegistrationSchema>;
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
