import * as Sentry from '@sentry/node';

// ─── PII Scrubbing ─────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
  'ssn', 'ssnencrypted', 'taxid', 'taxidencrypted',
  'taxidpersonal', 'taxidgroup', 'dob', 'dateofbirth',
  'accountnumber', 'accountnumberencrypted',
  'routingnumber', 'routingnumberencrypted',
  'authorization', 'cookie', 'x-dev-role',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

// Replace 9-digit runs (SSN, tax ID, NPI, etc.) with [REDACTED-9DIGIT]; do
// not try to be clever about context — false negatives leak PII, false
// positives only make an error message slightly less readable.
const NINE_DIGIT_RE = /\b\d{9,10}\b/g;
const SSN_DASHED_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w+\b/g;

function scrubString(value: string): string {
  return value
    .replace(SSN_DASHED_RE, '[REDACTED-SSN]')
    .replace(NINE_DIGIT_RE, '[REDACTED-ID]')
    .replace(EMAIL_RE, '[REDACTED-EMAIL]');
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[REDACTED]' : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubEvent<E extends Sentry.Event>(event: E): E {
  // Headers: drop auth + cookies
  if (event.request?.headers) {
    const h = event.request.headers;
    for (const key of Object.keys(h)) {
      if (isSensitiveKey(key)) delete (h as Record<string, unknown>)[key];
    }
  }

  // Request body / query — scrub deeply
  const req = event.request;
  if (req) {
    if (req.data !== undefined) {
      req.data = scrubValue(req.data) as typeof req.data;
    }
    if (typeof req.query_string === 'string') {
      req.query_string = scrubString(req.query_string);
    }
  }

  // Sentry.setExtra payloads
  if (event.extra) {
    event.extra = scrubValue(event.extra) as typeof event.extra;
  }

  // Sentry.setContext payloads
  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  }

  // Breadcrumbs may carry request payloads or PII-bearing messages
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      message: b.message ? scrubString(b.message) : b.message,
      data: b.data ? (scrubValue(b.data) as typeof b.data) : b.data,
    }));
  }

  // Exception messages can contain raw record values
  const exValues = event.exception?.values;
  if (exValues) {
    for (const ex of exValues) {
      if (ex?.value) ex.value = scrubString(ex.value);
    }
  }

  if (event.message) {
    event.message = scrubString(event.message);
  }

  return event;
}

// Exported for direct unit testing (Sentry doesn't give us a clean hook).
export const __test_scrubEvent = scrubEvent;

// ─── Init ──────────────────────────────────────────────────────────────

export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] || 'development',
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
}
