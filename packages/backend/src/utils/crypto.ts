import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

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
 * Handles both encrypted and legacy plaintext values.
 * Logs a security warning in production when returning unencrypted data.
 */
export function decryptSafe(value: string): string {
  // Encrypted format: 32-char hex : 32-char hex : hex ciphertext
  const parts = value.split(':');
  if (parts.length !== 3) {
    if (process.env['NODE_ENV'] === 'production') {
      logger.warn('SECURITY: decryptSafe received unencrypted value — possible legacy plaintext PII in database');
    }
    return value; // plaintext
  }
  try {
    return decrypt(value);
  } catch {
    if (process.env['NODE_ENV'] === 'production') {
      logger.warn('SECURITY: decryptSafe failed to decrypt value — possible legacy plaintext with colons');
    }
    return value; // legacy plaintext that happens to contain colons
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
