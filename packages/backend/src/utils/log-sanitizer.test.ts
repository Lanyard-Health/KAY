import { describe, it, expect } from 'vitest';
import winston from 'winston';
import { phiSanitizer, redactValue } from './log-sanitizer.js';

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
  });
});
