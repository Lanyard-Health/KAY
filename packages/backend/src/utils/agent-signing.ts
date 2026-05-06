import { sign, verify } from 'node:crypto';
import { logger } from './logger.js';

// Ed25519 signing for AgentEvent rows (Phase 0.A platform foundation).
//
// Contract: never throws. Signing or verification errors are returned as null
// so logAgentEvent can preserve its existing fail-soft guarantee — agents must
// not crash if the signing key is missing or malformed. Production missing-key
// is logged at error level so Sentry / on-call sees it; PR 2 will pair this
// with an explicit AgentEvent.signatureKeyId='unsigned' marker.

const UNSIGNED_KEY_ID = 'unsigned';

export interface KeysetEntry {
  keyId: string;
  publicKey: string;
  status: 'current' | 'retired';
  retiredAt?: string;
}

export interface SignResult {
  signature: string | null;
  keyId: string;
}

function getPrivateKeyPem(): string | null {
  return process.env['AGENT_SIGNING_PRIVATE_KEY'] ?? null;
}

function getCurrentKeyId(): string | null {
  return process.env['AGENT_SIGNING_KEY_ID'] ?? null;
}

function getCurrentPublicKeyPem(): string | null {
  return process.env['AGENT_SIGNING_PUBLIC_KEY'] ?? null;
}

function getRetiredKeys(): KeysetEntry[] {
  const raw = process.env['AGENT_SIGNING_RETIRED_KEYS'];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((k): k is { keyId: string; publicKey: string; retiredAt?: string } => {
        if (k === null || typeof k !== 'object') return false;
        const obj = k as Record<string, unknown>;
        return typeof obj['keyId'] === 'string' && typeof obj['publicKey'] === 'string';
      })
      .map((k) => ({
        keyId: k.keyId,
        publicKey: k.publicKey,
        status: 'retired' as const,
        ...(k.retiredAt ? { retiredAt: k.retiredAt } : {}),
      }));
  } catch (err) {
    logger.warn('Failed to parse AGENT_SIGNING_RETIRED_KEYS — must be JSON array of {keyId, publicKey, retiredAt?}', { error: err });
    return [];
  }
}

export function isSigningAvailable(): boolean {
  return !!(getPrivateKeyPem() && getCurrentKeyId());
}

export function getKeyset(): { current: KeysetEntry | null; retired: KeysetEntry[] } {
  const currentPem = getCurrentPublicKeyPem();
  const currentKeyId = getCurrentKeyId();
  const current: KeysetEntry | null =
    currentPem && currentKeyId
      ? { keyId: currentKeyId, publicKey: currentPem, status: 'current' }
      : null;
  return { current, retired: getRetiredKeys() };
}

/**
 * ============================================================================
 *                            VERIFIER CONTRACT
 * ============================================================================
 *
 * This is the single source of truth for verifying AgentEvent signatures.
 * External auditors and any future verifier code (ours or third-party) MUST
 * reproduce the exact byte sequence described here before passing it to
 * `verify(null, canonicalBytes, publicKey, signatureBytes)` (Ed25519).
 *
 *  1. Fetch the public key (and any retired keys) from
 *       GET /.well-known/lanyard-signing-keys.json
 *     keyed by `signature_key_id` on the row.
 *
 *  2. Reconstruct the canonical payload as a JSON object containing exactly
 *     these nine fields, in this order conceptually (key order in the wire
 *     format is enforced lexicographically by `canonicalize`, see below):
 *
 *       id          — string (uuid; matches the row's `id`)
 *       workflowId  — string  (row's `workflow_id`)
 *       taskId      — string | null  (row's `task_id`, null if absent)
 *       agent       — string  (row's `agent`)
 *       action      — string  (row's `action`)
 *       data        — JSON value (row's `data` jsonb, as-is)
 *       level       — string  (row's `level`)
 *       timestamp   — string — ISO 8601 in UTC with millisecond precision,
 *                     matching JavaScript `new Date(...).toISOString()`,
 *                     e.g. "2026-05-06T15:02:38.123Z".
 *                     IMPORTANT: external readers receive `timestamp(3)
 *                     without time zone` from Postgres (e.g. "2026-05-06
 *                     15:02:38.123") and MUST reformat it to the
 *                     ISO-8601-UTC-with-Z form before canonicalization,
 *                     because the byte sequence — not the wall-clock value —
 *                     is what was signed.
 *       prevHash    — string | null — SHA-256 hex of the previous event in
 *                     the same `workflow_id` (chain head and the first
 *                     event written to a pre-existing workflow are null).
 *
 *  3. Pass that object through `canonicalize()` (below). The canonical form is:
 *       - object keys sorted lexicographically (recursively at every depth),
 *       - array order preserved,
 *       - primitives serialized via JSON.stringify (no whitespace, standard
 *         JSON escaping, no trailing commas),
 *       - UTF-8 encoded for hashing/signing.
 *
 *  4. Verify two things against the row:
 *       eventHash  === sha256_hex(canonicalBytes)            — chain integrity
 *       Ed25519.verify(publicKey, canonicalBytes, signature) — authenticity
 *
 *  5. Walk the chain by re-verifying each row in `(workflow_id, timestamp asc)`
 *     and asserting `row.prevHash === previousRow.eventHash` (with `null` at
 *     the head). A break anywhere indicates tampering or insertion.
 *
 * **THIS FORMAT IS FROZEN.** Adding, removing, renaming, or reordering fields,
 * changing the timestamp format, or altering canonicalization rules forks the
 * chain and invalidates every signature ever produced under the old format.
 * Any change here is a breaking-change rotation, not a refactor.
 * ============================================================================
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]));
  return '{' + entries.join(',') + '}';
}

export function signAgentEvent(canonicalPayload: string): SignResult {
  const privateKeyPem = getPrivateKeyPem();
  const keyId = getCurrentKeyId();

  if (!privateKeyPem || !keyId) {
    if (process.env['NODE_ENV'] === 'production') {
      logger.error(
        'SECURITY: AGENT_SIGNING_PRIVATE_KEY / AGENT_SIGNING_KEY_ID not configured — agent events recorded as unsigned'
      );
    } else {
      logger.warn('Agent signing key not configured — events marked unsigned (dev/test mode)');
    }
    return { signature: null, keyId: UNSIGNED_KEY_ID };
  }

  try {
    // Ed25519 requires the algorithm argument to be null per Node crypto docs.
    const signatureBuf = sign(null, Buffer.from(canonicalPayload, 'utf8'), { key: privateKeyPem });
    return { signature: signatureBuf.toString('base64'), keyId };
  } catch (err) {
    logger.error('Failed to sign agent event — recording as unsigned', { error: err });
    return { signature: null, keyId: UNSIGNED_KEY_ID };
  }
}

export function verifyAgentEvent(canonicalPayload: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalPayload, 'utf8'),
      { key: publicKeyPem },
      Buffer.from(signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
}
