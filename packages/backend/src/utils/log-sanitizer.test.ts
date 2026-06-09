import { describe, it, expect } from 'vitest';
import winston from 'winston';
import { phiSanitizer, redactValue, scrubMessage } from './log-sanitizer.js';

describe('log-sanitizer', () => {
  describe('redactValue (deep walker)', () => {
    it('redacts top-level PHI keys', () => {
      const input = { ssn: '123-45-6789', firstName: 'Alice' };
      const out = redactValue(input) as Record<string, unknown>;
      expect(out.ssn).toBe('[REDACTED]');
      expect(out.firstName).toBe('Alice');
    });

    it('redacts nested PHI keys', () => {
      const input = { user: { taxId: '987654321', email: 'x@y.com' } };
      const out = redactValue(input) as Record<string, Record<string, unknown>>;
      expect(out.user.taxId).toBe('[REDACTED]');
      expect(out.user.email).toBe('x@y.com');
    });

    it('redacts *Encrypted fields defensively', () => {
      const input = { ssnEncrypted: 'cipher:1:abc', accountNumberEncrypted: 'cipher:2:def' };
      const out = redactValue(input) as Record<string, unknown>;
      expect(out.ssnEncrypted).toBe('[REDACTED]');
      expect(out.accountNumberEncrypted).toBe('[REDACTED]');
    });

    it('redacts inside arrays', () => {
      const input = { providers: [{ ssn: 'a', name: 'A' }, { ssn: 'b', name: 'B' }] };
      const out = redactValue(input) as { providers: Array<Record<string, unknown>> };
      expect(out.providers[0].ssn).toBe('[REDACTED]');
      expect(out.providers[1].ssn).toBe('[REDACTED]');
      expect(out.providers[0].name).toBe('A');
    });

    it('matches keys case-insensitively', () => {
      const input = { SSN: 'a', DateOfBirth: 'b', Authorization: 'c' };
      const out = redactValue(input) as Record<string, unknown>;
      expect(out.SSN).toBe('[REDACTED]');
      expect(out.DateOfBirth).toBe('[REDACTED]');
      expect(out.Authorization).toBe('[REDACTED]');
    });

    it('leaves non-PHI primitives untouched', () => {
      expect(redactValue('hello')).toBe('hello');
      expect(redactValue(42)).toBe(42);
      expect(redactValue(null)).toBe(null);
      expect(redactValue(undefined)).toBe(undefined);
    });

    it('redacts submission-credential keys (username, mfaSeed, extraConfig)', () => {
      const input = {
        // portal-agent.ts:77 — `submissionInput.credentials = JSON.parse(decryptSafe(...))`
        credentials: { username: 'caqh-user', password: 'secret', mfaSeed: 'JBSWY' },
        username: 'top-level-user',
        mfaSeed: 'top-mfa',
        extraConfig: '{"q":"a"}',
        usernameEncrypted: 'cipher:1:abc',
        mfaSeedEncrypted: 'cipher:2:def',
        extraConfigEncrypted: 'cipher:3:ghi',
        // Non-secret peers preserved
        payerId: 'payer-1',
      };
      const out = redactValue(input) as Record<string, unknown>;
      expect(out.credentials).toBe('[REDACTED]');
      expect(out.username).toBe('[REDACTED]');
      expect(out.mfaSeed).toBe('[REDACTED]');
      expect(out.extraConfig).toBe('[REDACTED]');
      expect(out.usernameEncrypted).toBe('[REDACTED]');
      expect(out.mfaSeedEncrypted).toBe('[REDACTED]');
      expect(out.extraConfigEncrypted).toBe('[REDACTED]');
      expect(out.payerId).toBe('payer-1');
    });

    it('credentials blob is redacted as a whole even if nested', () => {
      // Defense-in-depth: even if the credentials object somehow had unexpected
      // child keys that aren't in PHI_KEYS, the parent `credentials` key alone
      // is enough to block the whole subtree.
      const input = { submission: { credentials: { username: 'u', token: 't' } } };
      const out = redactValue(input) as { submission: { credentials: unknown } };
      expect(out.submission.credentials).toBe('[REDACTED]');
    });
  });

  describe('PHI_KEYS expansion (P1-3)', () => {
    it('redacts NPI keys (npi, npiNumber, npi_number)', () => {
      const input = { npi: '1234567890', npiNumber: '9999999999', npi_number: '1111111111' };
      const out = redactValue(input) as Record<string, unknown>;
      expect(out.npi).toBe('[REDACTED]');
      expect(out.npiNumber).toBe('[REDACTED]');
      expect(out.npi_number).toBe('[REDACTED]');
    });

    it('redacts license number keys', () => {
      const input = { licenseNumber: 'MD-12345', license_number: 'TX-67890' };
      const out = redactValue(input) as Record<string, unknown>;
      expect(out.licenseNumber).toBe('[REDACTED]');
      expect(out.license_number).toBe('[REDACTED]');
    });

    it('redacts auth token keys (jwt, accessToken, refreshToken, idToken)', () => {
      const input = {
        jwt: 'eyJ...',
        accessToken: 'at-abc',
        access_token: 'at-def',
        refreshToken: 'rt-abc',
        refresh_token: 'rt-def',
        idToken: 'it-abc',
        id_token: 'it-def',
      };
      const out = redactValue(input) as Record<string, unknown>;
      expect(out.jwt).toBe('[REDACTED]');
      expect(out.accessToken).toBe('[REDACTED]');
      expect(out.access_token).toBe('[REDACTED]');
      expect(out.refreshToken).toBe('[REDACTED]');
      expect(out.refresh_token).toBe('[REDACTED]');
      expect(out.idToken).toBe('[REDACTED]');
      expect(out.id_token).toBe('[REDACTED]');
    });

    it('redacts Medicare/Medicaid IDs', () => {
      const input = { medicareId: 'MC-1', medicare_id: 'MC-2', medicaidId: 'MD-1', medicaid_id: 'MD-2' };
      const out = redactValue(input) as Record<string, unknown>;
      expect(out.medicareId).toBe('[REDACTED]');
      expect(out.medicare_id).toBe('[REDACTED]');
      expect(out.medicaidId).toBe('[REDACTED]');
      expect(out.medicaid_id).toBe('[REDACTED]');
    });
  });

  describe('scrubMessage (string-pattern scrubber)', () => {
    it('redacts SSN with dashes anywhere in the string', () => {
      expect(scrubMessage('User SSN is 123-45-6789, please verify')).toBe(
        'User SSN is [REDACTED SSN], please verify'
      );
    });

    it('redacts EIN format', () => {
      expect(scrubMessage('Tax ID 12-3456789 invalid')).toBe('Tax ID [REDACTED EIN] invalid');
    });

    it('redacts 10-digit NPI runs', () => {
      expect(scrubMessage('Looking up NPI: 1234567890')).toBe('Looking up NPI: [REDACTED 10-DIGIT]');
    });

    it('redacts multiple NPI occurrences in one message', () => {
      expect(scrubMessage('Comparing 1111111111 and 2222222222')).toBe(
        'Comparing [REDACTED 10-DIGIT] and [REDACTED 10-DIGIT]'
      );
    });

    it('preserves messages with no PII patterns', () => {
      expect(scrubMessage('Provider record updated successfully')).toBe('Provider record updated successfully');
    });

    it('does not redact 9-digit numbers (too many false positives)', () => {
      // We deliberately do not scrub bare 9-digit runs — they false-match
      // transaction IDs, db sequence numbers, etc. Real SSNs without dashes
      // should travel as `ssn` keys in metadata.
      expect(scrubMessage('Order id 123456789 processed')).toBe('Order id 123456789 processed');
    });

    it('redacts 10-digit timestamps as a known false-positive trade-off', () => {
      // 1735000000-style Unix timestamps look like NPIs. We accept this
      // false-positive to keep real NPIs out of free-form log strings.
      expect(scrubMessage('Event at 1735000000 fired')).toBe('Event at [REDACTED 10-DIGIT] fired');
    });
  });

  describe('phiSanitizer Winston format', () => {
    it('strips PHI from logger metadata before output', async () => {
      const captured: string[] = [];

      // Build a minimal in-memory transport. Extending winston.Transport directly
      // is the supported pattern for capturing log output in tests.
      const Transport = (await import('winston-transport')).default;
      class MemoryTransport extends Transport {
        log(info: { level: string; message: string } & Record<string, unknown>, next: () => void) {
          captured.push(JSON.stringify(info));
          next();
        }
      }

      const logger = winston.createLogger({
        format: winston.format.combine(phiSanitizer()),
        transports: [new MemoryTransport()],
      });

      logger.info('test event', {
        ssnEncrypted: 'cipher:1:badbad',
        userId: 'user_123',
        nested: { taxId: '999999999', city: 'Atlanta' },
      });

      expect(captured.length).toBe(1);
      expect(captured[0]).toContain('[REDACTED]');
      expect(captured[0]).not.toContain('cipher:1:badbad');
      expect(captured[0]).not.toContain('999999999');
      // Non-PHI fields preserved
      expect(captured[0]).toContain('user_123');
      expect(captured[0]).toContain('Atlanta');
    });

    it('scrubs PII patterns from the message body itself', async () => {
      const captured: string[] = [];

      const Transport = (await import('winston-transport')).default;
      class MemoryTransport extends Transport {
        log(info: { level: string; message: string } & Record<string, unknown>, next: () => void) {
          captured.push(JSON.stringify(info));
          next();
        }
      }

      const logger = winston.createLogger({
        format: winston.format.combine(phiSanitizer()),
        transports: [new MemoryTransport()],
      });

      logger.info('Looking up NPI: 1234567890 for user with SSN 123-45-6789');

      expect(captured.length).toBe(1);
      expect(captured[0]).not.toContain('1234567890');
      expect(captured[0]).not.toContain('123-45-6789');
      expect(captured[0]).toContain('[REDACTED 10-DIGIT]');
      expect(captured[0]).toContain('[REDACTED SSN]');
    });
  });
});
