/**
 * Generate the OpenAPI 3.1 spec for Lanyard Health.
 *
 * Phase 0.A scope per Flag #1 (Option A): tooling stand-up + drift gate
 * enforced only on routes added in Phase 0.A. Existing 46 routes are
 * Phase 0.B and intentionally absent from this spec until then.
 *
 * Routes covered:
 *   - POST   /api/v1/webhook-subscriptions      (PR 4)
 *   - GET    /api/v1/webhook-subscriptions      (PR 4)
 *   - DELETE /api/v1/webhook-subscriptions/{id} (PR 4)
 *   - GET    /.well-known/lanyard-signing-key.pem  (PR 1)
 *   - GET    /.well-known/lanyard-signing-keys.json (PR 1)
 *   - POST   /api/v1/portal/register             (CAQH-first onboarding PR 1)
 *   - POST   /api/v1/portal/self-serve-signup    (CAQH-first onboarding PR 1)
 *
 * Usage:
 *   npm run openapi:generate --workspace=packages/backend
 *
 * The generator is deterministic — keys are sorted recursively, so two
 * consecutive runs in the same environment produce byte-identical output.
 * The CI workflow .github/workflows/openapi-drift.yml regenerates the spec
 * on every PR and fails if the result diverges from the committed file.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

extendZodWithOpenApi(z);

import {
  createWebhookSubscriptionSchema,
  REGISTERED_EVENT_TYPES,
} from '../src/routes/webhook-subscription.routes.js';
import {
  portalRegistrationSchema,
  selfServeSignupSchema,
} from '@credential-management/shared';

// ──────────────────────────────────────────────
// Reusable component schemas
// ──────────────────────────────────────────────

const ErrorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    error: z.object({
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('ErrorEnvelope');

const WebhookSubscriptionPublicSchema = z
  .object({
    id: z.string().uuid(),
    practiceId: z.string().uuid(),
    url: z.string().url(),
    eventTypes: z.array(z.enum(REGISTERED_EVENT_TYPES)),
    description: z.string().nullable(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().nullable(),
    lastDeliveryAt: z.string().datetime().nullable(),
    lastFailureAt: z.string().datetime().nullable(),
    consecutiveFailures: z.number().int(),
  })
  .openapi('WebhookSubscriptionPublic');

const WebhookSubscriptionWithSecretSchema = WebhookSubscriptionPublicSchema.extend({
  secret: z
    .string()
    .describe(
      'Plain-text HMAC-SHA256 signing secret. Returned exactly once at create time. Lost-secret recovery requires re-creating the subscription.'
    ),
}).openapi('WebhookSubscriptionWithSecret');

const SigningKeysetSchema = z
  .object({
    keys: z.array(
      z.object({
        keyId: z.string(),
        publicKey: z.string().describe('PEM-encoded Ed25519 public key'),
        status: z.enum(['current', 'retired']),
        retiredAt: z.string().datetime().optional(),
      })
    ),
  })
  .openapi('SigningKeyset');

const DefactoPlanRecordSchema = z
  .object({
    id: z.string().uuid(),
    carrierName: z.string().nullable(),
    carrierOrPlanName: z.string(),
    lob: z.string().nullable(),
    organizationName: z.string().nullable(),
    organizationNpi: z.string().nullable(),
    locationCity: z.string().nullable(),
    locationState: z.string().nullable(),
  })
  .openapi('DefactoPlanRecord');

const DefactoSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    npi: z.string(),
    fetchedAt: z.string().datetime(),
    status: z.enum(['found', 'not_found', 'error']),
    errorMessage: z.string().nullable(),
    planRecords: z.array(DefactoPlanRecordSchema),
  })
  .openapi('DefactoSnapshot');

// Annotate the imported runtime schema so it gets a stable component name in
// the spec instead of being inlined.
const CreateWebhookSubscriptionRequestSchema = createWebhookSubscriptionSchema.openapi(
  'CreateWebhookSubscriptionRequest'
);

// The shared package's compiled schemas are bound to a different zod module
// instance than this script's, so `.openapi()` (a prototype extension) is not
// available on them. Passing them un-annotated inlines the schema in the spec
// instead of emitting a named component — acceptable; the structure is identical.
const PortalRegistrationRequestSchema = portalRegistrationSchema;
const SelfServeSignupRequestSchema = selfServeSignupSchema;

// ──────────────────────────────────────────────
// Build the registry
// ──────────────────────────────────────────────

function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'AWS Cognito-issued JWT bearer token',
  });

  // Pre-register so they appear in components.schemas even if referenced
  // indirectly. Order is preserved by the generator's internal map; the
  // stableStringify pass below sorts anyway, so order here is cosmetic.
  registry.register('ErrorEnvelope', ErrorEnvelopeSchema);
  registry.register('WebhookSubscriptionPublic', WebhookSubscriptionPublicSchema);
  registry.register('WebhookSubscriptionWithSecret', WebhookSubscriptionWithSecretSchema);
  registry.register('SigningKeyset', SigningKeysetSchema);
  registry.register('CreateWebhookSubscriptionRequest', CreateWebhookSubscriptionRequestSchema);

  registry.registerPath({
    method: 'post',
    path: '/api/v1/webhook-subscriptions',
    summary: 'Create a webhook subscription',
    description:
      'Register a destination URL to receive outbound webhook deliveries. ' +
      'Returns the HMAC-SHA256 signing secret exactly once in the response body — ' +
      'it is never returned by GET. Subscription is rejected if the URL resolves ' +
      'to a private/loopback/link-local IP address (SSRF guard). HTTPS is required ' +
      'in production.',
    tags: ['Webhooks'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: CreateWebhookSubscriptionRequestSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'Subscription created. Includes the plain-text HMAC secret (one-time).',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: WebhookSubscriptionWithSecretSchema,
            }),
          },
        },
      },
      400: {
        description:
          'Invalid request body, non-HTTPS URL in production, or SSRF guard rejection.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      401: { description: 'Unauthenticated.' },
      403: {
        description: 'Caller is not a member of the requested practice.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/webhook-subscriptions',
    summary: 'List webhook subscriptions',
    description:
      "Returns active and paused subscriptions in the caller's practice scope. " +
      'Soft-deleted rows are excluded. The HMAC secret is never returned.',
    tags: ['Webhooks'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Subscriptions list (HMAC secret excluded).',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.array(WebhookSubscriptionPublicSchema),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated.' },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/webhook-subscriptions/{id}',
    summary: 'Soft-delete a webhook subscription',
    description:
      "Marks the subscription deleted and disables future deliveries. Returns 404 " +
      "if the subscription does not exist, is already deleted, or belongs to a " +
      "practice the caller cannot access (no existence leak across practices).",
    tags: ['Webhooks'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Subscription id' }),
      }),
    },
    responses: {
      200: {
        description: 'Subscription soft-deleted.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: WebhookSubscriptionPublicSchema,
            }),
          },
        },
      },
      401: { description: 'Unauthenticated.' },
      404: {
        description: 'Subscription not found, already deleted, or out of practice scope.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/portal/register',
    summary: 'Submit a provider application',
    description:
      'Public, rate-limited. Creates a pending ProviderApplication for admin review. ' +
      'caqhProviderId is optional; when provided it is validated for uniqueness against ' +
      'existing providers and pending applications, and is copied to the provider profile ' +
      'on approval (enables automatic CAQH profile/document import).',
    tags: ['Portal'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: PortalRegistrationRequestSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'Application submitted and queued for review.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              message: z.string(),
              data: z.object({
                id: z.string().uuid(),
                status: z.string(),
                submittedAt: z.string().datetime(),
              }),
            }),
          },
        },
      },
      400: {
        description: 'Validation failure or unknown/inactive practice link.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      409: {
        description:
          'Duplicate NPI, email, or CAQH Provider ID (existing provider or pending application).',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      429: { description: 'Rate limit exceeded.' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/portal/self-serve-signup',
    summary: 'Self-serve provider signup (instant access)',
    description:
      'Public, rate-limited. Creates a Cognito user, ProviderProfile (pending_verification), ' +
      'User, and a pending ProviderApplication in one step. Same caqhProviderId semantics ' +
      'as /portal/register, except the ID lands on the provider profile immediately.',
    tags: ['Portal'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: SelfServeSignupRequestSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'Account created; provider has instant portal access pending verification.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              message: z.string(),
              data: z.object({
                userId: z.string().uuid(),
                providerId: z.string().uuid(),
                email: z.string().email(),
              }),
            }),
          },
        },
      },
      400: {
        description: 'Validation failure.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      409: {
        description: 'Duplicate NPI, email, or CAQH Provider ID.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      429: { description: 'Rate limit exceeded.' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/.well-known/lanyard-signing-key.pem',
    summary: 'Current signing public key (PEM)',
    description:
      'Current Ed25519 public key used to sign AgentEvent rows. Consumed by ' +
      'simple verifiers that prefer raw PEM over JSON. No authentication.',
    tags: ['Well-Known'],
    responses: {
      200: {
        description: 'PEM-encoded public key.',
        content: {
          'application/x-pem-file': {
            schema: z.string().openapi({
              example:
                '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----\n',
            }),
          },
        },
      },
      503: {
        description: 'Signing key not configured on this environment.',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/.well-known/lanyard-signing-keys.json',
    summary: 'Full signing keyset (current + retired)',
    description:
      'JWKS-style keyset listing the current signing key and all retired keys. ' +
      'External verifiers reference the signatureKeyId on each AgentEvent against ' +
      'the keyId fields here to verify historical signatures after rotation. ' +
      'No authentication.',
    tags: ['Well-Known'],
    responses: {
      200: {
        description: 'Keyset with at minimum the current key. Empty when unconfigured.',
        content: { 'application/json': { schema: SigningKeysetSchema } },
      },
    },
  });

  registry.register('DefactoPlanRecord', DefactoPlanRecordSchema);
  registry.register('DefactoSnapshot', DefactoSnapshotSchema);

  const defactoProviderParams = z.object({
    id: z.string().uuid().openapi({ description: 'Provider id' }),
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/providers/{id}/defacto',
    summary: 'Latest Defacto network participation snapshot',
    description:
      "Latest stored Defacto Health payer-directory snapshot for the provider, " +
      'with its normalized plan records. Internal roles only (admin, ' +
      'credentialing/lanyard staff). Raw API responses are never returned. ' +
      'data is null when the provider has never been checked.',
    tags: ['Defacto'],
    security: [{ bearerAuth: [] }],
    request: { params: defactoProviderParams },
    responses: {
      200: {
        description: 'Latest snapshot, or null when never checked.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: DefactoSnapshotSchema.nullable(),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated.' },
      403: { description: 'Caller is not an internal admin/staff role.' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/admin/providers/{id}/defacto-check',
    summary: 'Run a fresh Defacto network participation check',
    description:
      "Looks up the provider's NPI against the Defacto Health practitioner " +
      'insurance API and stores a new append-only snapshot (history is kept). ' +
      "A 404 from Defacto is a normal not_found outcome, not an error. " +
      'Internal roles only (admin, credentialing/lanyard staff).',
    tags: ['Defacto'],
    security: [{ bearerAuth: [] }],
    request: { params: defactoProviderParams },
    responses: {
      200: {
        description: 'The newly stored snapshot (found or not_found).',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: DefactoSnapshotSchema,
            }),
          },
        },
      },
      400: {
        description: 'Provider has no NPI on file, or invalid provider id.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      401: { description: 'Unauthenticated.' },
      403: { description: 'Caller is not an internal admin/staff role.' },
      404: {
        description: 'Provider not found.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      502: {
        description: 'Defacto upstream failure (bad key, rate limited, or outage). An error snapshot is recorded.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      503: {
        description: 'DEFACTO_API_KEY is not configured on this environment.',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
    },
  });

  return registry;
}

// ──────────────────────────────────────────────
// Deterministic JSON serialization
// ──────────────────────────────────────────────

// JSON.stringify with recursive alphabetical key sorting. Arrays preserve
// order — array order is semantically meaningful in OpenAPI (parameters,
// security requirements). This guarantees byte-identical output across runs
// regardless of object insertion order from the generator library.
function stableStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(val).sort()) {
          sorted[k] = (val as Record<string, unknown>)[k];
        }
        return sorted;
      }
      return val;
    },
    2
  );
}

// ──────────────────────────────────────────────
// Public API used by both CLI and tests
// ──────────────────────────────────────────────

export function buildOpenApiSpec(): string {
  const registry = buildRegistry();
  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Lanyard Health API',
      version: '0.1.0-phase-0a',
      description:
        'OpenAPI 3.1 spec for the Lanyard Health backend. Phase 0.A scope: ' +
        'webhook subscription API and the .well-known signing-key endpoints ' +
        'shipped in PRs 1 and 4, plus the public portal registration endpoints ' +
        '(CAQH-first onboarding). The remaining existing routes will be ' +
        'annotated in Phase 0.B per the platform foundations plan.',
    },
    servers: [
      { url: 'https://kay-os62.onrender.com', description: 'Production' },
      { url: 'http://localhost:3002', description: 'Local development' },
    ],
  });
  // Trailing newline matches POSIX text-file convention so editors and
  // git diff don't show a "no newline at end of file" marker.
  return stableStringify(document) + '\n';
}

// ──────────────────────────────────────────────
// CLI entry — only runs when invoked directly
// ──────────────────────────────────────────────

const isCliEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliEntry) {
  const json = buildOpenApiSpec();
  const outPath = fileURLToPath(new URL('../openapi.json', import.meta.url));
  writeFileSync(outPath, json);
  const parsed = JSON.parse(json) as { paths?: Record<string, Record<string, unknown>> };
  const pathCount = Object.keys(parsed.paths ?? {}).length;
  let opCount = 0;
  for (const ops of Object.values(parsed.paths ?? {})) {
    opCount += Object.keys(ops).length;
  }
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath} (${pathCount} paths, ${opCount} operations)`);
}
