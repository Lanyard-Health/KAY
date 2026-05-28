import * as Sentry from '@sentry/react';

/**
 * Initializes Sentry for the frontend. Safe to call when `VITE_SENTRY_DSN` is
 * unset (e.g. local dev) — `Sentry.init({ dsn: undefined })` becomes a no-op.
 *
 * Backend (`packages/backend/src/utils/sentry.ts`) handles PII scrubbing on its
 * own events. Frontend events generally don't carry PHI directly, but we keep
 * a defensive `beforeSend` here that strips obvious sensitive fields from the
 * request/extra payloads if they're attached via Sentry.setContext.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // No DSN configured (local dev) — skip.

  const environment = import.meta.env.MODE === 'production' ? 'production' : 'development';

  Sentry.init({
    dsn,
    environment,
    // Conservative sampling. Errors are always captured; transactions sampled.
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
}

const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
  'ssn', 'ssnencrypted', 'taxid', 'taxidencrypted',
  'dob', 'dateofbirth',
  'accountnumber', 'accountnumberencrypted',
  'routingnumber', 'routingnumberencrypted',
  'authorization', 'cookie',
]);

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  if (event.request && event.request.data !== undefined) {
    event.request.data = scrubValue(event.request.data) as typeof event.request.data;
  }
  return event;
}

export { Sentry };
