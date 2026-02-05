import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from './crypto.js';

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
});
