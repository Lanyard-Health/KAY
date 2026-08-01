/**
 * Defacto Health Practitioner Insurance API client (Phase 1 — internal admin only).
 * Docs: https://insurances.defacto.health/docs/
 *
 * Looks up a practitioner's payer network participation by NPI. Results are
 * stored as append-only snapshots (see DefactoSnapshot in schema.prisma).
 *
 * Data handling rules (Kay-approved brief, 2026-07-31):
 * - Response bodies are stored ONLY in Postgres (rawResponse). Never log them.
 * - 404 from Defacto is a normal outcome ("not found in payer directories"),
 *   not an error — no retry, no Sentry.
 * - Exposed only through admin/staff routes (defacto.routes.ts).
 */
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const DEFACTO_API_BASE = 'https://insurances.defacto.health/api/v2';
const MAX_ATTEMPTS = 3;
const NOT_FOUND = Symbol('defacto-not-found');

/** Thrown when DEFACTO_API_KEY is missing — routes map this to a clear 503. */
export class DefactoNotConfiguredError extends Error {
  constructor() {
    super('Defacto integration is not configured — set DEFACTO_API_KEY to enable network participation lookups.');
    this.name = 'DefactoNotConfiguredError';
  }
}

/** Upstream failure (bad key, rate limit exhausted, Defacto down, bad body). */
export class DefactoApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'DefactoApiError';
  }
}

export interface DefactoPlanRow {
  carrierName: string | null;
  carrierOrPlanName: string;
  lob: string | null;
  organizationName: string | null;
  organizationNpi: string | null;
  locationCity: string | null;
  locationState: string | null;
}

export interface DefactoLookupResult {
  status: 'found' | 'not_found';
  /** Full API body for the snapshot's rawResponse column; null when not found. */
  rawResponse: unknown;
  planRows: DefactoPlanRow[];
}

// Field names verified against a CAPTURED live response (2026-07-31, NPI
// 1003016718) — which outranks the docs summary: relationships carry
// organization_canon_id / location_canon_id / plan_canon_ids with NUMERIC ids;
// referenced.* arrive as ARRAYS of entities each carrying canon_id; orgs have
// npi (number) + name, locations city/state, plans carrier_name + name + lob
// (lob is a short code like "qhp"/"commppo" and is often null).
const canonId = z.union([z.string(), z.number()]);

const relationshipSchema = z
  .object({
    organization_canon_id: canonId.nullish(),
    location_canon_id: canonId.nullish(),
    plan_canon_ids: z.array(canonId).nullish(),
  })
  .passthrough();

const practitionerSchema = z
  .object({
    relationships: z.array(relationshipSchema).nullish(),
  })
  .passthrough();

const referencedEntity = z.object({ canon_id: canonId.optional() }).passthrough();
// Live responses deliver referenced.* as arrays; the docs describe canon_id-keyed
// objects. Accept both and normalize below.
const referencedGroup = z.union([z.record(referencedEntity), z.array(referencedEntity)]).nullish();

const defactoResponseSchema = z
  .object({
    practitioners: z.array(practitionerSchema),
    referenced: z
      .object({
        organizations: referencedGroup,
        locations: referencedGroup,
        insurance_plans: referencedGroup,
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

type DefactoResponse = z.infer<typeof defactoResponseSchema>;

type EntityMap = Map<string, Record<string, unknown>>;

function toEntityMap(group: z.infer<typeof referencedGroup>): EntityMap {
  const map: EntityMap = new Map();
  if (!group) return map;
  if (Array.isArray(group)) {
    for (const entity of group) {
      if (entity.canon_id !== undefined) map.set(String(entity.canon_id), entity);
    }
  } else {
    for (const [key, entity] of Object.entries(group)) map.set(key, entity);
  }
  return map;
}

// NPIs and ids arrive as numbers; names as strings. Normalize both to string.
const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number') return String(v);
  return null;
};

/**
 * Flatten a validated Defacto response into one row per
 * (insurance plan × relationship), resolving relationship IDs against the
 * referenced objects. Pure function, unit-tested in defacto.service.test.ts.
 */
export function parseDefactoResponse(body: DefactoResponse): DefactoPlanRow[] {
  const orgs = toEntityMap(body.referenced?.organizations);
  const locations = toEntityMap(body.referenced?.locations);
  const plans = toEntityMap(body.referenced?.insurance_plans);

  const rows: DefactoPlanRow[] = [];
  for (const practitioner of body.practitioners) {
    for (const rel of practitioner.relationships ?? []) {
      const org = rel.organization_canon_id != null ? orgs.get(String(rel.organization_canon_id)) : undefined;
      const loc = rel.location_canon_id != null ? locations.get(String(rel.location_canon_id)) : undefined;
      for (const planId of rel.plan_canon_ids ?? []) {
        const plan = plans.get(String(planId));
        rows.push({
          carrierName: str(plan?.['carrier_name']),
          carrierOrPlanName: str(plan?.['name']) ?? 'Unknown plan',
          lob: str(plan?.['lob']),
          organizationName: str(org?.['name']),
          organizationNpi: str(org?.['npi']),
          locationCity: str(loc?.['city']),
          locationState: str(loc?.['state']),
        });
      }
    }
  }
  return rows;
}

export class DefactoService {
  private getApiKey(): string {
    return process.env['DEFACTO_API_KEY'] || '';
  }

  isConfigured(): boolean {
    return this.getApiKey().length > 0;
  }

  /**
   * Fetch a practitioner's network participation with all relations.
   * Returns not_found for NPIs absent from Defacto's dataset (normal outcome).
   * Throws DefactoNotConfiguredError / DefactoApiError for real failures.
   */
  async lookupByNpi(npi: string): Promise<DefactoLookupResult> {
    if (!this.isConfigured()) throw new DefactoNotConfiguredError();

    const body = await this.request(
      `/practitioners/relations/${encodeURIComponent(npi)}?include=organizations,locations,insurance_plans`
    );
    if (body === NOT_FOUND) return { status: 'not_found', rawResponse: null, planRows: [] };

    // A 200 is not success until the body matches the documented structure.
    const parsed = defactoResponseSchema.safeParse(body);
    if (!parsed.success) {
      logger.error({ event: 'defacto_unexpected_body', issues: parsed.error.issues.slice(0, 5) });
      throw new DefactoApiError('Defacto returned a response in an unexpected format.');
    }
    if (parsed.data.practitioners.length === 0) {
      return { status: 'not_found', rawResponse: null, planRows: [] };
    }
    return { status: 'found', rawResponse: body, planRows: parseDefactoResponse(parsed.data) };
  }

  /**
   * GET with explicit status handling. Never logs response bodies.
   * 404 → NOT_FOUND sentinel. 401/other-4xx → no retry. 429/5xx/network →
   * exponential backoff up to MAX_ATTEMPTS, then a graceful error.
   */
  private async request(endpoint: string): Promise<unknown | typeof NOT_FOUND> {
    const url = `${DEFACTO_API_BASE}${endpoint}`;
    let lastError: DefactoApiError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'x-api-key': this.getApiKey(), Accept: 'application/json' },
        });

        if (response.status === 404) return NOT_FOUND;
        // Observed live 2026-07-31: an invalid key comes back as 403, not 401.
        if (response.status === 401 || response.status === 403) {
          throw new DefactoApiError('Defacto rejected our API key — check DEFACTO_API_KEY.', response.status);
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new DefactoApiError(
            response.status === 429
              ? 'Defacto is rate-limiting our requests.'
              : 'Defacto is currently unavailable.',
            response.status
          );
          if (attempt < MAX_ATTEMPTS) {
            const retryAfter = Number(response.headers.get('retry-after'));
            const delayMs =
              response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
                ? Math.min(retryAfter, 30) * 1000
                : 1000 * Math.pow(2, attempt - 1);
            logger.warn({ event: 'defacto_api_retry', attempt, status: response.status, endpoint });
            await sleep(delayMs);
            continue;
          }
          throw lastError;
        }
        if (!response.ok) {
          throw new DefactoApiError(`Defacto API error (${response.status}).`, response.status);
        }

        try {
          return (await response.json()) as unknown;
        } catch {
          throw new DefactoApiError('Defacto returned invalid JSON.', response.status);
        }
      } catch (error) {
        if (error instanceof DefactoApiError) {
          if (error.status && error.status < 500 && error.status !== 429) {
            throw error; // client errors never retry
          }
          lastError = error;
        } else if (error instanceof DOMException && error.name === 'AbortError') {
          lastError = new DefactoApiError('Defacto request timed out.');
        } else {
          lastError = new DefactoApiError('Could not reach Defacto.');
        }
        if (attempt < MAX_ATTEMPTS) {
          logger.warn({ event: 'defacto_api_retry', attempt, error: lastError.message, endpoint });
          await sleep(1000 * Math.pow(2, attempt - 1));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new DefactoApiError('Defacto request failed.');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
