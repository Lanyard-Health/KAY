/**
 * Encrypted access to provider date of birth (SOC 2 exception E-1).
 *
 * `ProviderProfile.dateOfBirth` and `ProviderApplication.dateOfBirth` are
 * plaintext TIMESTAMP columns. Information Security Policy §3.1 classifies a
 * date of birth as Restricted, and §3.2 requires field-level encryption for
 * Restricted data. This module is the single read/write path for both, so the
 * migration to `dateOfBirthEncrypted` happens in one place rather than at ~40
 * call sites.
 *
 * Stored value is the ciphertext of a `YYYY-MM-DD` string, not an ISO datetime:
 * a date of birth is a calendar date, and every consumer already strips the
 * time. The date is taken in **UTC**, which is what `caqh.service.ts` has been
 * sending CAQH all along.
 *
 * Structural typing means one module serves both tables — anything with the two
 * columns satisfies `ProviderDobColumns`.
 *
 * Transition state: plaintext `dateOfBirth` stays authoritative-as-fallback
 * until the backfill has run on staging and prod (Phase 3), is cleared in
 * Phase 4, and the column is dropped in Phase 5 along with the fallback here.
 */
import { encrypt, decrypt, isEncryptionAvailable } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/** iv:authTag:ciphertext, all hex — the wire format `encrypt()` produces. */
const CIPHERTEXT_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ProviderDobColumns {
  dateOfBirthEncrypted?: string | null;
}

export type DobInput = Date | string | null | undefined;

/**
 * Normalize any accepted input to `YYYY-MM-DD` in UTC. Returns null when the
 * value is absent or unparseable — callers treat that as "no DOB", which is a
 * state the codebase already handles.
 */
function toDateOnly(value: Date | string): string | null {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Prisma data fragment for writing a date of birth.
 *
 * `undefined` yields `{}` so the column is left alone — this preserves the
 * conditional-spread semantics at the provider update routes. An explicit
 * `null` clears it.
 *
 * Diverges from `encryptSafe` deliberately: this **throws** when
 * `ENCRYPTION_KEY` is absent, in every environment. Under `encryptSafe`'s dev
 * leniency a key-less staging container would write literal dates into the
 * "encrypted" column, and every production read of those rows would then throw.
 * The test harness sets a real key (`tests/helpers/setup.ts`).
 */
export function dobWrite(input: DobInput): {
  dateOfBirthEncrypted?: string | null;
} {
  if (input === undefined) return {};
  if (input === null) return { dateOfBirthEncrypted: null };

  const dateOnly = toDateOnly(input);
  if (!dateOnly) return { dateOfBirthEncrypted: null };

  if (!isEncryptionAvailable()) {
    throw new Error('ENCRYPTION_KEY is required to store a date of birth — refusing to write plaintext');
  }

  // Phase 4: the plaintext half is gone. Because every call site writes through
  // here, stopping the dual-write was this one edit rather than seven.
  //
  // Note what this does NOT do: it never sets `dateOfBirth` back to null. An
  // existing plaintext value is left exactly as it is, and is cleared only by
  // the deliberate `--clear-plaintext` run — so deploying this is still
  // reversible on its own.
  return { dateOfBirthEncrypted: encrypt(dateOnly) };
}

/**
 * The row's date of birth as `YYYY-MM-DD`. Null when absent or undecryptable.
 *
 * Ciphertext is now the only source — the plaintext fallback was removed in
 * Phase 5 once both environments held zero plaintext rows.
 *
 * Never throws. A corrupt or wrong-key ciphertext degrades to null, which
 * `caqh.service.ts` turns into a named readiness blocker rather than sending
 * garbage to CAQH.
 */
export function providerDob(row: ProviderDobColumns): string | null {
  const cipher = row.dateOfBirthEncrypted;
  if (!cipher) return null;
  if (!CIPHERTEXT_SHAPE.test(cipher)) {
    logger.warn('SECURITY: date_of_birth_encrypted is not ciphertext — treating as absent');
    return null;
  }
  try {
    return decrypt(cipher);
  } catch {
    logger.warn('SECURITY: date_of_birth_encrypted failed to decrypt — treating as absent');
    return null;
  }
}

/** The date of birth as a UTC-midnight `Date`, for date formatters. */
export function providerDobDate(row: ProviderDobColumns): Date | null {
  const d = providerDob(row);
  return d ? new Date(`${d}T00:00:00.000Z`) : null;
}

/** The date of birth as the ISO datetime string API responses already return. */
export function providerDobIso(row: ProviderDobColumns): string | null {
  const d = providerDob(row);
  return d ? `${d}T00:00:00.000Z` : null;
}

/**
 * Presence check that **never decrypts**. For the completeness and readiness
 * booleans, which only need to know whether a date of birth exists — those
 * paths never hold a plaintext date of birth in memory.
 */
export function hasDob(row: ProviderDobColumns): boolean {
  return !!row.dateOfBirthEncrypted;
}

/**
 * Response shaping: always strips the ciphertext column, and re-adds
 * `dateOfBirth` as an ISO string only for callers entitled to it.
 *
 * The returned `dateOfBirth` is a derived value, not a column — the API shape
 * is unchanged from before any of this work, which is why no frontend change
 * was ever needed.
 */
export function withDob<T extends ProviderDobColumns>(
  row: T,
  opts: { include: boolean }
): Omit<T, 'dateOfBirthEncrypted'> & { dateOfBirth?: string | null } {
  const { dateOfBirthEncrypted: _cipher, ...rest } = row;
  if (!opts.include) return rest;
  return { ...rest, dateOfBirth: providerDobIso(row) };
}
