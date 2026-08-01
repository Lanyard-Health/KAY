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

  // Encryption (required in production — SSNs, tax IDs, banking data, and CAQH
  // credentials are AES-256-GCM encrypted with this key; see utils/crypto.ts)
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
    .optional(),

  // S3 / R2 storage (optional in dev with LocalStack)
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  USE_LOCALSTACK: z.string().optional(),

  // AI (optional — feature degrades gracefully)
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-4-6'),
  // Cheaper tier for classification/extraction tasks. Document classifier and
  // bug-monitor triage read this. Default Haiku 4.5 — ~3× cheaper than Sonnet
  // on input tokens, faster latency, sufficient quality for routine labels.
  AI_MODEL_CLASSIFIER: z.string().default('claude-haiku-4-5-20251001'),
  // Vision/OCR extraction tier. Defaults to Haiku 4.5 — cheapest vision model,
  // sufficient for reading credential PDFs/images. Bump a deploy to Sonnet via
  // this env var if scanned-PDF extraction quality ever proves insufficient.
  AI_MODEL_VISION: z.string().default('claude-haiku-4-5-20251001'),
  AI_DAILY_TOKEN_BUDGET: z.coerce.number().default(100000),
  MAX_REPLANS_PER_WORKFLOW: z.coerce.number().int().min(0).max(50).default(5),

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
  // 'individual' (default) = /ProviewAPI/API/RosterIndividual — synchronous response with per-provider success/failure visibility.
  // 'batch' = legacy /RosterAPI/API/Roster — fire-and-forget enqueue; failures invisible until status-poll polling ships (#206 residual gap).
  // Override to 'batch' on Render env vars to roll back if individual mode misbehaves in production.
  CAQH_ROSTER_MODE: z.enum(['batch', 'individual']).default('individual'),
  // Failure-rate threshold (0-1) above which the nightly sync job sends an
  // email alert to ADMIN_EMAIL. Default 0.25 — at the current 33% (#207)
  // failure rate this means a nightly email until root cause is fixed.
  CAQH_SYNC_ALERT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.25),

  // Defacto Health practitioner insurance API (optional — network participation
  // lookups return a clear 503 when the key is missing; see defacto.service.ts)
  DEFACTO_API_KEY: z.string().optional(),

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

  // Agent event signing (Ed25519) — Phase 0.A platform foundations.
  // Optional in dev (events recorded as 'unsigned' with a warning).
  // In production, missing keys do not crash agents — events are written with
  // signatureKeyId='unsigned' and a Sentry P1 alert is raised (fail-soft contract,
  // preserves logAgentEvent's "never throw" guarantee). PR 2 consumes these vars.
  AGENT_SIGNING_PRIVATE_KEY: z.string().optional(),
  AGENT_SIGNING_PUBLIC_KEY: z.string().optional(),
  AGENT_SIGNING_KEY_ID: z.string().optional(),
  // JSON array of retired keys: [{ keyId, publicKey (PEM), retiredAt (ISO8601) }, ...]
  // Exposed at /.well-known/lanyard-signing-keys.json so verifiers can verify
  // historical signatures after a key rotation.
  AGENT_SIGNING_RETIRED_KEYS: z.string().optional(),
  // Rollout mode for PR 2's chain-and-sign middleware.
  // shadow (default): signing failure → null signature columns; agent never blocked.
  // enforce: signing failure → signatureKeyId='unsigned' + Sentry alert.
  // Deploy as 'shadow', observe Sentry for 48h, flip to 'enforce' via env var change only.
  AGENT_SIGNING_MODE: z.enum(['shadow', 'enforce']).default('shadow'),

  // Sentry (optional)
  SENTRY_DSN: z.string().optional(),

  // Slack operational alerts (optional). Incoming-webhook URL; when unset the
  // alerter is a no-op. See utils/slack-alert.ts.
  SLACK_ALERT_WEBHOOK_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Fail-closed check for the dev auth bypass. Bypass activates ONLY when:
 *   - DEV_AUTH_BYPASS is exactly the literal string "true", AND
 *   - NODE_ENV is exactly the literal "development" or "test"
 *
 * Any other state — missing NODE_ENV, typo'd NODE_ENV, flag not set to the
 * literal "true" — returns false. This is an explicit allowlist, not a
 * "not production" denylist, so a deploy that forgets to set NODE_ENV cannot
 * silently behave like dev.
 */
export const devBypassEnabled = (): boolean =>
  process.env['DEV_AUTH_BYPASS'] === 'true' &&
  (process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === 'test');

/**
 * Validate environment variables on startup.
 * Throws with clear error messages if required vars are missing.
 */
export function validateEnv(): Env {
  // Hard fail-closed: refuse to boot if the dev bypass is enabled in production.
  // Runs BEFORE schema parsing so a misconfigured deploy dies immediately with
  // an obvious error rather than booting and silently letting bypass-allowed
  // routes through.
  if (process.env['DEV_AUTH_BYPASS'] === 'true' && process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'FATAL: DEV_AUTH_BYPASS=true is not allowed when NODE_ENV=production. Unset DEV_AUTH_BYPASS in the production environment.'
    );
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const messages = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${msgs?.join(', ')}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${messages}`);
  }

  // PII encryption — fail closed in production, warn in dev/test. Without the
  // key, SSNs/tax IDs/banking data would be written to the database in
  // plaintext (SOC 2 violation), so a misconfigured production deploy must die
  // at boot rather than run unencrypted.
  if (!result.data.ENCRYPTION_KEY) {
    if (result.data.NODE_ENV === 'production') {
      const msg =
        'FATAL: ENCRYPTION_KEY is required in production — PII fields (SSN, tax IDs, banking data, CAQH credentials) cannot be encrypted without it. Generate one with: openssl rand -hex 32';
      logger.error(msg);
      throw new Error(msg);
    }
    logger.warn(
      'WARNING: ENCRYPTION_KEY not set — PII field encryption is unavailable; encrypt() calls will throw'
    );
  } else {
    logger.info('PII encryption enabled (ENCRYPTION_KEY present, AES-256-GCM)');
  }

  // Production warnings for missing optional vars
  if (result.data.NODE_ENV === 'production') {
    if (!result.data.COGNITO_USER_POOL_ID || !result.data.COGNITO_CLIENT_ID) {
      logger.warn('WARNING: Cognito env vars not set — authentication will fail without DEV_AUTH_BYPASS');
    }
    if (!result.data.S3_BUCKET_NAME) {
      logger.warn('WARNING: S3_BUCKET_NAME not set — document uploads will fail');
    }
    if (!result.data.AGENT_SIGNING_PRIVATE_KEY || !result.data.AGENT_SIGNING_KEY_ID) {
      logger.warn(
        "WARNING: AGENT_SIGNING_PRIVATE_KEY / AGENT_SIGNING_KEY_ID not set — AgentEvent rows will be marked 'unsigned' (Phase 0.A fail-soft). Generate a keypair with: npx tsx packages/backend/scripts/generate-signing-key.ts"
      );
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

  // Defacto is deliberately non-fatal in production: the routes answer with an
  // explicit 503 ("integration not configured") until the key is set, so a
  // deploy that predates the Render env var cannot crash the whole API.
  if (!result.data.DEFACTO_API_KEY) {
    logger.warn(
      'DEFACTO_API_KEY not set — network participation lookups are disabled and will return 503 until it is configured.'
    );
  }

  return result.data;
}
