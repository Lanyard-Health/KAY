import { z } from 'zod';

/**
 * Common pagination query schema.
 * Coerces string query params to numbers with sensible defaults and limits.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Provider list query schema.
 */
export const providerListQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  status: z.string().optional(),
});

/**
 * Audit log query schema.
 */
export const auditQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  userId: z.string().optional(),
  resourceType: z.string().optional(),
  action: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

/**
 * Expiration query schema.
 */
export const expirationQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  type: z.string().optional(),
  includeExpired: z.coerce.boolean().default(false),
});

/**
 * Parse query parameters with a Zod schema.
 * Returns parsed values with defaults applied.
 */
export function parseQuery<T extends z.ZodTypeAny>(
  query: Record<string, unknown>,
  schema: T
): z.infer<T> {
  return schema.parse(query);
}
