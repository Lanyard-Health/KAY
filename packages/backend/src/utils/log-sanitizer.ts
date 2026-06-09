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
  'dea_number',
  'accountnumber',
  'accountnumberencrypted',
  'account_number',
  'routingnumber',
  'routingnumberencrypted',
  'routing_number',
  // Provider identifiers — single 10-digit NPI is enough to look up a provider
  // by name in the public NPPES registry, so treat as PII.
  'npi',
  'npinumber',
  'npi_number',
  'licensenumber',
  'license_number',
  'medicareid',
  'medicare_id',
  'medicaidid',
  'medicaid_id',
  'password',
  'passwd',
  'secret',
  'token',
  'jwt',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  // Submission engine — explicit by exact variable name. Per plan: do not
  // rely on pattern matching alone for credential scrubbing.
  // Source: portal-agent.ts:77 `submissionInput.credentials = JSON.parse(decryptSafe(...))`.
  'credentials',          // decrypted credential blob in portal-agent
  'username',             // adapter login username — never log
  'usernameencrypted',
  'mfaseed',              // TOTP seed for portal MFA
  'mfaseedencrypted',
  'extraconfig',          // payer-portal security questions, PIN, etc.
  'extraconfigencrypted',
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
  if (typeof value === 'string') {
    return scrubMessage(value);
  }
  return value;
}

/**
 * Scrub PII-shaped substrings from a free-form message body. This catches
 * `logger.info('Looking up NPI: ' + npiNumber)` style call sites where the
 * sensitive value is concatenated into the message string and so bypasses the
 * key-based redactor entirely.
 *
 * Patterns: 10-digit runs (NPI), SSN with dashes, EIN. 9-digit runs are
 * deliberately skipped — too many false positives (random IDs, transaction
 * numbers). Real SSNs without dashes should be carried in structured metadata
 * with a `ssn` key, which the key-based redactor already catches.
 */
export function scrubMessage(msg: string): string {
  return msg
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED SSN]')
    .replace(/\b\d{2}-\d{7}\b/g, '[REDACTED EIN]')
    // NPIs are 10-digit, but so are Unix timestamps and some transaction IDs.
    // The false-positive cost (redacted timestamp in a log message) is much
    // lower than the leak cost of a real NPI in a public log aggregator.
    .replace(/\b\d{10}\b/g, '[REDACTED 10-DIGIT]');
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
  // Scrub PII-shaped substrings from the message body itself. Catches
  // `logger.info('Looking up NPI: ' + npiNumber)` style call sites that
  // bypass the key-based redactor.
  if (typeof info.message === 'string') {
    info.message = scrubMessage(info.message);
  }
  // Same for an error stack — they're free-form strings that can carry
  // request/response context concatenated into the trace. `stack` is not
  // a declared TransformableInfo property, so bracket-access through the
  // index signature.
  const record = info as Record<string, unknown>;
  if (typeof record['stack'] === 'string') {
    record['stack'] = scrubMessage(record['stack'] as string);
  }
  return info;
});
