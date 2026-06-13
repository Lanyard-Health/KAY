/**
 * Encrypted access to the CAQH mirror payload (launch-blocker P1-8).
 *
 * The mirror keeps the full raw CAQH pull per provider — including SSN, DOB,
 * license and malpractice data — so failed syncs can be debugged against the
 * actual payload and admins can export it. That payload must never sit in the
 * database as plaintext: writes go through encryptMirrorPayload (AES-256-GCM
 * via encryptSafe, same key as every other encrypted PII column) and reads
 * come back through mirrorRawJson.
 *
 * `rawJson` (plaintext) is legacy: still readable as a fallback until the
 * backfill script has encrypted existing rows on staging + prod, then the
 * column is dropped in a follow-up migration along with this fallback.
 */
import { encryptSafe, decryptSafe } from '../utils/crypto.js';

/** Serialize + encrypt a raw CAQH payload for storage in rawJsonEncrypted. */
export function encryptMirrorPayload(raw: unknown): string {
  return encryptSafe(JSON.stringify(raw ?? null));
}

/** Decrypt + parse a rawJsonEncrypted value back into the original payload. */
export function decryptMirrorPayload(value: string): unknown {
  return JSON.parse(decryptSafe(value));
}

export interface MirrorPayloadColumns {
  rawJsonEncrypted: string | null;
  rawJson: unknown;
}

/**
 * The mirror's payload, whichever column currently holds it. Prefers the
 * encrypted column; falls back to legacy plaintext for rows the backfill
 * hasn't converted yet. Null when the row has neither (cleared row).
 */
export function mirrorRawJson(mirror: MirrorPayloadColumns): unknown {
  if (mirror.rawJsonEncrypted) {
    return decryptMirrorPayload(mirror.rawJsonEncrypted);
  }
  return mirror.rawJson ?? null;
}
