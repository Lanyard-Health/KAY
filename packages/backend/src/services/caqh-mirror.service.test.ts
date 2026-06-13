import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptMirrorPayload, decryptMirrorPayload, mirrorRawJson } from './caqh-mirror.service.js';

describe('caqh-mirror.service', () => {
  const VALID_KEY = 'a'.repeat(64);
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env['ENCRYPTION_KEY'];
    process.env['ENCRYPTION_KEY'] = VALID_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env['ENCRYPTION_KEY'] = originalKey;
    } else {
      delete process.env['ENCRYPTION_KEY'];
    }
  });

  // Realistic shape: the payload that previously sat in raw_json as plaintext.
  const payload = {
    Provider: {
      FirstName: 'Jane',
      LastName: 'Doe',
      SSN: '123-45-6789',
      BirthDate: '1985-06-15',
      ProviderLicense: [{ State: 'AZ', Number: 'L-1' }],
      Malpractice: [{ Carrier: 'Acme Insurance', PolicyNumber: 'MP-77' }],
    },
  };

  it('round-trips a nested CAQH payload exactly', () => {
    const ciphertext = encryptMirrorPayload(payload);
    expect(decryptMirrorPayload(ciphertext)).toEqual(payload);
  });

  it('ciphertext is iv:authTag:ciphertext and contains no plaintext PII', () => {
    const ciphertext = encryptMirrorPayload(payload);
    expect(ciphertext.split(':')).toHaveLength(3);
    expect(ciphertext).not.toContain('123-45-6789');
    expect(ciphertext).not.toContain('Jane');
    expect(ciphertext).not.toContain('1985-06-15');
    // Hex-only content (no raw JSON leaking through)
    expect(ciphertext).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('encrypts null payloads without throwing (defensive)', () => {
    expect(decryptMirrorPayload(encryptMirrorPayload(null))).toBeNull();
  });

  describe('mirrorRawJson', () => {
    it('prefers the encrypted column', () => {
      const row = {
        rawJsonEncrypted: encryptMirrorPayload(payload),
        rawJson: { stale: 'plaintext' },
      };
      expect(mirrorRawJson(row)).toEqual(payload);
    });

    it('falls back to legacy plaintext for un-backfilled rows', () => {
      const row = { rawJsonEncrypted: null, rawJson: payload };
      expect(mirrorRawJson(row)).toEqual(payload);
    });

    it('returns null when the row holds neither', () => {
      expect(mirrorRawJson({ rawJsonEncrypted: null, rawJson: null })).toBeNull();
    });
  });
});
