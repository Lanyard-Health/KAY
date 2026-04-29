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

  // Email (Resend)
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  /** @deprecated Use RESEND_FROM_EMAIL instead */
  SES_FROM_EMAIL: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),

  // Frontend URL (for CORS)
  FRONTEND_URL: z.string().optional(),

  // CAQH (optional — feature disabled if missing)
  CAQH_API_URL: z.string().optional(),
  CAQH_ORG_ID: z.string().optional(),
  CAQH_USERNAME: z.string().optional(),
  CAQH_PASSWORD: z.string().optional(),
  CAQH_PRODUCT: z.string().optional(),
  // 'batch' = legacy /RosterAPI/API/Roster path (default); 'individual' = new /ProviewAPI/API/rosterIndividual path.
  // Flip to 'individual' after E3 verifies it against demo with a real provider.
  CAQH_ROSTER_MODE: z.enum(['batch', 'individual']).default('batch'),
  // Failure-rate threshold (0-1) above which the nightly sync job sends an
  // email alert to ADMIN_EMAIL. Default 0.25 — at the current 33% (#207)
  // failure rate this means a nightly email until root cause is fixed.
  CAQH_SYNC_ALERT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.25),

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

  // CAQH integration env vars — fail fast in production, loud warning in dev/test.
  // Mirrors CaqhService.isConfigured() so a booted server is guaranteed CAQH-capable.
  // CAQH_PRODUCT and CAQH_SYNC_SCHEDULE have defaults at point of use and are NOT required.
  const caqhRequired = ['CAQH_API_URL', 'CAQH_ORG_ID', 'CAQH_USERNAME', 'CAQH_PASSWORD'] as const;
  const caqhMissing = caqhRequired.filter((k) => !result.data[k]);

  if (caqhMissing.length > 0) {
    if (result.data.NODE_ENV === 'production') {
      const msg = `CAQH integration env vars are required in production but missing: ${caqhMissing.join(', ')}. Set these in Render env vars before deploying.`;
      logger.error(msg);
      throw new Error(msg);
    } else {
      logger.warn(
        `CAQH integration env vars missing (${caqhMissing.join(', ')}) — CAQH sync features will be disabled. This is expected for local dev without a CAQH demo account.`
      );
    }
  }

  return result.data;
}
