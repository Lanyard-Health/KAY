import { z } from 'zod';

export const verifyDirectorySchema = z.object({
  payerId: z.string().uuid('Invalid payer ID'),
});

export const resolveAlertSchema = z.object({
  resolvedBy: z.string().optional(),
});

export const directoryStatusQuerySchema = z.object({
  payerId: z.string().uuid().optional(),
});

export type VerifyDirectoryInput = z.infer<typeof verifyDirectorySchema>;
export type ResolveAlertInput = z.infer<typeof resolveAlertSchema>;
export type DirectoryStatusQuery = z.infer<typeof directoryStatusQuerySchema>;
