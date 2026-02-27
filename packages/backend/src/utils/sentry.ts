import * as Sentry from '@sentry/node';

/**
 * PII patterns to scrub from Sentry events.
 * Mirrors the patterns in bug-monitor/sanitizer.ts.
 */
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, replacement: '[REDACTED]' },
  { pattern: /\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2}\b/g, replacement: '[DATE_REDACTED]' },
  { pattern: /\bNPI[:\s]*\d{10}\b/gi, replacement: '[NPI_REDACTED]' },
];

/** Keys in request bodies that should never be sent to Sentry */
const SENSITIVE_BODY_KEYS = [
  'ssn', 'ssnEncrypted', 'dateOfBirth', 'dob', 'taxId', 'accountHolderTaxId',
  'routingNumber', 'accountNumber', 'password', 'newPassword', 'confirmPassword',
];

function scrubPii(input: string): string {
  let result = input;
  for (const { pattern, replacement } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

function scrubRequestData(data: Record<string, unknown>): Record<string, unknown> {
  const scrubbed = { ...data };
  for (const key of SENSITIVE_BODY_KEYS) {
    if (key in scrubbed) {
      scrubbed[key] = '[REDACTED]';
    }
  }
  return scrubbed;
}

export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] || 'development',
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      // Scrub sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-dev-role'];
      }

      // Scrub PII from request body
      if (event.request?.data && typeof event.request.data === 'object') {
        event.request.data = scrubRequestData(event.request.data as Record<string, unknown>);
      } else if (event.request?.data && typeof event.request.data === 'string') {
        event.request.data = scrubPii(event.request.data);
      }

      // Scrub PII from error messages
      if (event.message) {
        event.message = scrubPii(event.message);
      }

      // Scrub exception messages
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) {
            ex.value = scrubPii(ex.value);
          }
        }
      }

      // Scrub breadcrumb messages
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.message) {
            crumb.message = scrubPii(crumb.message);
          }
        }
      }

      return event;
    },
  });
}
