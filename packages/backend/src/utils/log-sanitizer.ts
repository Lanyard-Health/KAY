import { format } from 'winston';
import type { TransformableInfo } from 'logform';

/**
 * Defense-in-depth Winston format that walks log entry metadata and replaces
 * any field whose key matches a known PHI/PII list with `'[REDACTED]'`. Also
 * scrubs `*Encrypted` keys defensively (they always carry encrypted ciphertext
 * but the field names alone leak intent).
 *
 * The codebase does not currently log raw request bodies, so this is not
 * patching an active leak. It's a guardrail so that if a future PR accidentally
 * writes `logger.info(req.body)`, the SSN/tax ID/DOB won't make it to Winston
 * sinks (console, file, downstream log aggregators).
 *
 * Backend Sentry has its own deeper scrubber in `utils/sentry.ts`. This format
 * sits on the Winston side instead.
 */

const PHI_KEYS = new Set([
  'ssn',
  'ssnencrypted',
  'taxid',
  'taxidencrypted',
  'taxidpersonal',
  'taxidgroup',
  'dob',
  'dateofbirth',
  'dea',
  'deanumber',
  'deanumberencrypted',
  'accountnumber',
  'accountnumberencrypted',
  'routingnumber',
  'routingnumberencrypted',
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
]);

const REDACT = '[REDACTED]';
const MAX_DEPTH = 6;

function isPhiKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (PHI_KEYS.has(lower)) return true;
  // Catch any `*Encrypted` field defensively.
  if (lower.endsWith('encrypted')) return true;
  return false;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isPhiKey(k) ? REDACT : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Winston format factory. Use in `combine(...)` before any serializer (e.g.
 * `printf` or `json`) so downstream formats see the scrubbed payload.
 */
export const phiSanitizer = format((info: TransformableInfo) => {
  // Walk the info object's own enumerable keys (other than the reserved
  // `level`, `message`, `stack`, `timestamp`). Winston puts metadata as
  // top-level keys, so we need to scrub at the top of the info object.
  const RESERVED = new Set(['level', 'message', 'stack', 'timestamp']);
  for (const key of Object.keys(info)) {
    if (RESERVED.has(key)) continue;
    if (isPhiKey(key)) {
      // eslint-disable-next-line security/detect-object-injection -- key comes from Object.keys of a logged object; redacting is the intended behavior
      (info as Record<string, unknown>)[key] = REDACT;
    } else {
      // eslint-disable-next-line security/detect-object-injection
      (info as Record<string, unknown>)[key] = redactValue((info as Record<string, unknown>)[key]);
    }
  }
  return info;
});
