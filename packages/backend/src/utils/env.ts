import { z } from 'zod';
import { logger } from './logger.js';

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3002),

  // Auth — JWT_SECRET is legacy (auth is Cognito JWT); kept optional for backwards compat
  JWT_SECRET: z.string().optional(),
  DEV_AUTH_BYPASS: z.string().optional(),

  // Cognito (optional in dev with DEV_AUTH_BYPASS, required in production)
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),

  // Encryption (required in production for CAQH credential storage)
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be a 64-character hex string').optional(),

  // S3 / R2 storage (optional in dev with LocalStack)
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  USE_LOCALSTACK: z.string().optional(),

  // AI (optional — feature degrades gracefully)
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-4-20250514'),
  AI_DAILY_TOKEN_BUDGET: z.coerce.number().default(100000),

  // Gmail API (optional — email features degrade gracefully)
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_SENDER_EMAIL: z.string().optional(),

  // SES email
  SES_FROM_EMAIL: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),

  // Frontend URL (for CORS)
  FRONTEND_URL: z.string().optional(),

  // CAQH (optional — feature disabled if missing)
  CAQH_API_URL: z.string().optional(),
  CAQH_ORG_ID: z.string().optional(),
  CAQH_API_KEY: z.string().optional(),

  // Embeddings (optional — knowledge base RAG degrades gracefully)
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  // Bug Monitor (optional)
  LINEAR_API_KEY: z.string().optional(),
  LINEAR_TEAM_ID: z.string().optional(),
  LINEAR_BUG_MONITOR_ENABLED: z.string().optional(),
  BUG_MONITOR_SECRET: z.string().optional(),

  // Retell AI (optional — phone call follow-up feature disabled if missing)
  RETELL_API_KEY: z.string().optional(),
  RETELL_WEBHOOK_SECRET: z.string().optional(),

  // Sentry (optional)
  SENTRY_DSN: z.string().optional(),
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

  // Production warnings for missing optional vars
  if (result.data.NODE_ENV === 'production') {
    if (!result.data.ENCRYPTION_KEY) {
      logger.warn('WARNING: ENCRYPTION_KEY not set — CAQH credential encryption will be unavailable');
    }
    if (!result.data.COGNITO_USER_POOL_ID || !result.data.COGNITO_CLIENT_ID) {
      logger.warn('WARNING: Cognito env vars not set — authentication will fail without DEV_AUTH_BYPASS');
    }
    if (!result.data.S3_BUCKET_NAME) {
      logger.warn('WARNING: S3_BUCKET_NAME not set — document uploads will fail');
    }
  }

  return result.data;
}
