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
 * Deterministic JSON canonicalization. FROZEN FORMAT — changing the output
 * shape forks the chain and breaks verification of all prior events.
 *
 * Rules: object keys sorted lexicographically; array order preserved; uses
 * JSON.stringify for primitives (strings/numbers/booleans/null).
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
