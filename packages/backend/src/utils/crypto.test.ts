import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encrypt, decrypt, deriveTenantKey, encryptForTenant, decryptForTenant, decryptSafe } from './crypto.js';

describe('crypto', () => {
  const VALID_KEY = 'a'.repeat(64);
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env['ENCRYPTION_KEY'];
    process.env['ENCRYPTION_KEY'] = VALID_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env['ENCRYPTION_KEY'] = originalKey;
    }
  });

  describe('encrypt()', () => {
    it('returns iv:authTag:ciphertext format', () => {
      const result = encrypt('hello');
      const parts = result.split(':');
      expect(parts).toHaveLength(3);
      // IV is 16 bytes = 32 hex chars
      expect(parts[0]).toHaveLength(32);
      // Auth tag is 16 bytes = 32 hex chars
      expect(parts[1]).toHaveLength(32);
      // Ciphertext length varies
      expect(parts[2]!.length).toBeGreaterThan(0);
    });

    it('produces randomized IV each call', () => {
      const a = encrypt('same text');
      const b = encrypt('same text');
      const ivA = a.split(':')[0];
      const ivB = b.split(':')[0];
      expect(ivA).not.toEqual(ivB);
    });

    it('produces different ciphertext each call due to random IV', () => {
      const a = encrypt('same text');
      const b = encrypt('same text');
      expect(a).not.toEqual(b);
    });
  });

  describe('decrypt()', () => {
    it('roundtrips SSN format', () => {
      const ssn = '123-45-6789';
      expect(decrypt(encrypt(ssn))).toBe(ssn);
    });

    it('roundtrips passwords with special characters', () => {
      const password = 'P@$$w0rd!#%^&*()_+{}|:<>?';
      expect(decrypt(encrypt(password))).toBe(password);
    });

    it('roundtrips unicode text', () => {
      const text = 'Héllo Wörld 日本語';
      expect(decrypt(encrypt(text))).toBe(text);
    });

    it('roundtrips empty string', () => {
      expect(decrypt(encrypt(''))).toBe('');
    });

    it('throws on malformed input (wrong number of parts)', () => {
      expect(() => decrypt('onlytwoparts:here')).toThrow('Invalid encrypted text format');
    });

    it('throws on tampered authTag', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      // Flip a character in the auth tag
      const tamperedTag = parts[1]!.replace(parts[1]![0]!, parts[1]![0] === 'a' ? 'b' : 'a');
      const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws on tampered ciphertext (GCM authentication)', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      const tamperedCipher = parts[2]!.replace(parts[2]![0]!, parts[2]![0] === 'a' ? 'b' : 'a');
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCipher}`;
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('ENCRYPTION_KEY validation', () => {
    it('throws on missing ENCRYPTION_KEY', () => {
      delete process.env['ENCRYPTION_KEY'];
      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is required');
    });

    it('throws on invalid ENCRYPTION_KEY length', () => {
      process.env['ENCRYPTION_KEY'] = 'tooshort';
      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
    });
  });

  // ==========================================
  // Phase 1 — Tenant key derivation (HKDF-SHA256)
  // ==========================================

  describe('deriveTenantKey()', () => {
    it('is deterministic for the same practiceId', () => {
      const a = deriveTenantKey('practice-abc');
      const b = deriveTenantKey('practice-abc');
      expect(a.equals(b)).toBe(true);
    });

    it('produces 32-byte keys', () => {
      expect(deriveTenantKey('practice-abc').length).toBe(32);
    });

    it('produces different keys for different practiceIds', () => {
      const a = deriveTenantKey('practice-abc');
      const b = deriveTenantKey('practice-xyz');
      expect(a.equals(b)).toBe(false);
    });

    it('throws on empty practiceId', () => {
      expect(() => deriveTenantKey('')).toThrow('practiceId is required');
    });
  });

  describe('encryptForTenant() / decryptForTenant()', () => {
    it('roundtrips a value', () => {
      const ct = encryptForTenant('practice-abc', 'super-secret');
      expect(decryptForTenant('practice-abc', ct)).toBe('super-secret');
    });

    it('produces different ciphertexts each call (random IV)', () => {
      const a = encryptForTenant('practice-abc', 'same text');
      const b = encryptForTenant('practice-abc', 'same text');
      expect(a).not.toEqual(b);
    });

    it('produces different ciphertexts for different practiceIds with same plaintext', () => {
      // We can't directly compare ciphertexts (random IV) but we can confirm
      // that practice B cannot decrypt practice A's value — that proves the
      // keys are distinct.
      const ctA = encryptForTenant('practice-abc', 'shared-plaintext');
      expect(() => decryptForTenant('practice-xyz', ctA)).toThrow();
    });

    it('cross-tenant decrypt fails (GCM auth tag mismatch)', () => {
      const ct = encryptForTenant('practice-A', 'tenant-A-secret');
      expect(() => decryptForTenant('practice-B', ct)).toThrow();
    });

    it('throws on malformed ciphertext', () => {
      expect(() => decryptForTenant('practice-abc', 'not:enough')).toThrow('Invalid encrypted text format');
    });
  });

  // ==========================================
  // Phase 1 — decryptSafe fail-closed in production
  // ==========================================

  describe('decryptSafe() production strictness', () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env['NODE_ENV'];
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env['NODE_ENV'] = originalEnv;
      } else {
        delete process.env['NODE_ENV'];
      }
    });

    it('roundtrips encrypted values in production', () => {
      process.env['NODE_ENV'] = 'production';
      const ct = encrypt('payload');
      expect(decryptSafe(ct)).toBe('payload');
    });

    it('throws in production on plaintext (wrong format)', () => {
      process.env['NODE_ENV'] = 'production';
      expect(() => decryptSafe('plaintext-no-colons')).toThrow('refusing to return plaintext');
    });

    it('throws in production on tampered ciphertext', () => {
      process.env['NODE_ENV'] = 'production';
      const ct = encrypt('payload');
      const parts = ct.split(':');
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]!.replace(/^./, parts[2]![0] === 'a' ? 'b' : 'a')}`;
      expect(() => decryptSafe(tampered)).toThrow('decryptSafe failed to decrypt');
    });

    it('tolerates plaintext in non-production (dev backward compat)', () => {
      process.env['NODE_ENV'] = 'development';
      // Spy on logger to avoid noisy test output
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(decryptSafe('legacy-plaintext-value')).toBe('legacy-plaintext-value');
      warnSpy.mockRestore();
    });
  });
});
