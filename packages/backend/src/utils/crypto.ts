import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'crypto';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const TENANT_KEY_LENGTH = 32;

function getEncryptionKey(): Buffer {
  const key = process.env['ENCRYPTION_KEY'];
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return keyBuffer;
}

/**
 * Derive a tenant-specific 32-byte AES key from the platform master key via
 * HKDF-SHA256. Same practiceId always produces the same key; different
 * practiceIds produce independent keys. A master-key compromise still requires
 * the attacker to know each practiceId to derive its tenant key.
 *
 * Used by encryptForTenant / decryptForTenant for PortalCredential storage.
 */
export function deriveTenantKey(practiceId: string): Buffer {
  if (!practiceId || practiceId.length === 0) {
    throw new Error('practiceId is required to derive a tenant key');
  }
  const masterKey = getEncryptionKey();
  const info = Buffer.from(`tenant:${practiceId}`, 'utf8');
  const salt = Buffer.alloc(0); // no salt — info encodes the tenant identity
  const derived = hkdfSync('sha256', masterKey, salt, info, TENANT_KEY_LENGTH);
  return Buffer.from(derived);
}

/**
 * Encrypt with a tenant-derived key. Same plaintext + same practiceId still
 * produces different ciphertexts each call (random IV). Different practiceIds
 * always produce ciphertexts that cannot decrypt with each other's keys.
 */
export function encryptForTenant(practiceId: string, plaintext: string): string {
  const key = deriveTenantKey(practiceId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt with a tenant-derived key. Throws if the ciphertext was encrypted
 * under a different practiceId (GCM auth tag check fails) or if the format
 * is invalid.
 */
export function decryptForTenant(practiceId: string, encryptedText: string): string {
  const key = deriveTenantKey(practiceId);
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }
  const [ivHex, authTagHex, ciphertext] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  let decrypted: string = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a string in the format: iv:authTag:ciphertext (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encrypt().
 * Expects format: iv:authTag:ciphertext (all hex-encoded)
 */
/**
 * Returns true if ENCRYPTION_KEY is configured.
 */
export function isEncryptionAvailable(): boolean {
  return !!process.env['ENCRYPTION_KEY'];
}

/**
 * Encrypt if ENCRYPTION_KEY is available.
 * In production, throws if ENCRYPTION_KEY is missing — ZERO plaintext tolerance.
 * In dev/test, returns plaintext with a warning.
 */
export function encryptSafe(plaintext: string): string {
  if (!isEncryptionAvailable()) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('ENCRYPTION_KEY is required in production — refusing to store plaintext PII');
    }
    return plaintext;
  }
  return encrypt(plaintext);
}

/**
 * Decrypt if value looks encrypted (iv:tag:cipher format), otherwise return as-is.
 *
 * Production: throws on malformed or undecryptable input. Refuses to silently
 * return plaintext that may be corrupt, tampered, or legacy data.
 * Dev/test: tolerates plaintext for backward compatibility with un-encrypted
 * seed data and legacy fixtures.
 */
export function decryptSafe(value: string): string {
  // Encrypted format: 32-char hex : 32-char hex : hex ciphertext
  const parts = value.split(':');
  if (parts.length !== 3) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('decryptSafe received unencrypted value — refusing to return plaintext PII in production');
    }
    logger.warn('SECURITY: decryptSafe returning plaintext (non-production) — possible legacy data');
    return value;
  }
  try {
    return decrypt(value);
  } catch (err) {
    if (process.env['NODE_ENV'] === 'production') {
      const message = err instanceof Error ? err.message : 'unknown error';
      throw new Error(`decryptSafe failed to decrypt value: ${message}`);
    }
    logger.warn('SECURITY: decryptSafe returning plaintext after decrypt failure (non-production)');
    return value;
  }
}

export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const [ivHex, authTagHex, ciphertext] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted: string = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
