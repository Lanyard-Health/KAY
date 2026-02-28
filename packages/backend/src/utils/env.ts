import { z } from 'zod';
import { logger } from './logger.js';

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3002),

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  DEV_AUTH_BYPASS: z.string().optional(),

  // Encryption (required in production for CAQH credential storage)
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be a 64-character hex string').optional(),

  // AI (optional — feature degrades gracefully)
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-4-20250514'),
  AI_DAILY_TOKEN_BUDGET: z.coerce.number().default(100000),

  // Gmail API (optional — email features degrade gracefully)
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_SENDER_EMAIL: z.string().optional(),

  // Frontend URL (for CORS)
  FRONTEND_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate environment variables on startup.
 * Throws with clear error messages if required vars are missing.
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const messages = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${msgs?.join(', ')}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${messages}`);
  }

  // ENCRYPTION_KEY is required in production — plaintext fallback is unacceptable for HIPAA
  if (result.data.NODE_ENV === 'production' && !result.data.ENCRYPTION_KEY) {
    throw new Error('FATAL: ENCRYPTION_KEY is required in production for CAQH credential storage');
  }

  // DATABASE_URL must use SSL in production to prevent plaintext data in transit
  if (result.data.NODE_ENV === 'production') {
    const dbUrl = result.data.DATABASE_URL;
    if (!dbUrl.includes('sslmode=require') && !dbUrl.includes('sslmode=verify')) {
      throw new Error('FATAL: DATABASE_URL must include sslmode=require in production');
    }
  }

  return result.data;
}
