import { describe, it, expect } from 'vitest';
import { bugSanitizer } from '../sanitizer.js';
import type { BugReport } from '../types.js';

function makeReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    source: 'backend-runtime',
    title: 'Test Error',
    errorMessage: overrides.errorMessage ?? 'An error occurred',
    errorClass: 'Error',
    stackTrace: overrides.stackTrace,
    metadata: overrides.metadata ?? {},
    occurredAt: new Date(),
    environment: 'development',
  };
}

describe('BugSanitizer', () => {
  describe('SSN scrubbing', () => {
    it('redacts SSN with dashes', () => {
      const result = bugSanitizer.scrub(makeReport({ errorMessage: 'User 123-45-6789 had an error' }));
      expect(result.errorMessage).toContain('[SSN_REDACTED]');
      expect(result.errorMessage).not.toContain('123-45-6789');
    });

    it('redacts SSN without dashes', () => {
      const result = bugSanitizer.scrub(makeReport({ errorMessage: 'SSN 123456789' }));
      expect(result.errorMessage).toContain('[SSN_REDACTED]');
      expect(result.errorMessage).not.toContain('123456789');
    });
  });

  describe('Email scrubbing', () => {
    it('redacts email addresses', () => {
      const result = bugSanitizer.scrub(makeReport({ errorMessage: 'Error for patient@example.com' }));
      expect(result.errorMessage).toContain('[EMAIL_REDACTED]');
      expect(result.errorMessage).not.toContain('patient@example.com');
    });
  });

  describe('Phone scrubbing', () => {
    it('redacts phone with parentheses', () => {
      const result = bugSanitizer.scrub(makeReport({ errorMessage: 'Contact (555) 123-4567' }));
      expect(result.errorMessage).toContain('[PHONE_REDACTED]');
      expect(result.errorMessage).not.toContain('(555) 123-4567');
    });

    it('redacts phone with country code', () => {
      const result = bugSanitizer.scrub(makeReport({ errorMessage: 'Call +1-555-123-4567' }));
      expect(result.errorMessage).toContain('[PHONE_REDACTED]');
      expect(result.errorMessage).not.toContain('+1-555-123-4567');
    });
  });

  describe('DOB scrubbing', () => {
    it('redacts DOB-like dates', () => {
      const result = bugSanitizer.scrub(makeReport({ errorMessage: 'DOB: 01/15/1990' }));
      expect(result.errorMessage).toContain('[DATE_REDACTED]');
      expect(result.errorMessage).not.toContain('01/15/1990');
    });
  });

  describe('NPI scrubbing', () => {
    it('redacts NPI with colon and space', () => {
      const result = bugSanitizer.scrub(makeReport({ errorMessage: 'NPI: 1234567890' }));
      expect(result.errorMessage).toContain('[NPI_REDACTED]');
      expect(result.errorMessage).not.toContain('1234567890');
    });

    it('redacts NPI case insensitively', () => {
      const result = bugSanitizer.scrub(makeReport({ errorMessage: 'npi:1234567890' }));
      expect(result.errorMessage).toContain('[NPI_REDACTED]');
      expect(result.errorMessage).not.toContain('1234567890');
    });
  });

  describe('Prisma WHERE clause scrubbing', () => {
    it('redacts WHERE clause contents', () => {
      const result = bugSanitizer.scrub(makeReport({
        errorMessage: "PrismaClientKnownRequestError: WHERE name = 'John Smith' AND dob = '1990-01-15')",
      }));
      expect(result.errorMessage).toContain('[PARAMS_REDACTED]');
      expect(result.errorMessage).not.toContain('John Smith');
    });
  });

  describe('JSON body scrubbing', () => {
    it('redacts JSON bodies with PII keys', () => {
      const result = bugSanitizer.scrub(makeReport({
        errorMessage: 'Error processing {"ssn":"123-45-6789","firstName":"John"}',
      }));
      expect(result.errorMessage).toContain('[REQUEST_BODY_OMITTED]');
      expect(result.errorMessage).not.toContain('123-45-6789');
      expect(result.errorMessage).not.toContain('John');
    });
  });

  describe('Stack trace truncation', () => {
    it('strips inline variable values from stack frames', () => {
      const stack = [
        'Error: something failed',
        '    at ProviderService.getEnrollments (/app/src/services/provider.service.ts:142:5)',
        '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
      ].join('\n');
      const result = bugSanitizer.scrub(makeReport({ stackTrace: stack }));
      expect(result.stackTrace).toContain('at ProviderService.getEnrollments (provider.service.ts:142)');
      expect(result.stackTrace).not.toContain('/app/src/services/');
    });
  });

  describe('Multiple PII types', () => {
    it('redacts all PII types in a single message', () => {
      const result = bugSanitizer.scrub(makeReport({
        errorMessage: 'Error for patient@example.com SSN 123-45-6789 NPI: 1234567890',
      }));
      expect(result.errorMessage).toContain('[EMAIL_REDACTED]');
      expect(result.errorMessage).toContain('[SSN_REDACTED]');
      expect(result.errorMessage).toContain('[NPI_REDACTED]');
      expect(result.errorMessage).not.toContain('patient@example.com');
      expect(result.errorMessage).not.toContain('123-45-6789');
      expect(result.errorMessage).not.toContain('1234567890');
    });
  });

  describe('Clean message passthrough', () => {
    it('does not modify messages without PII', () => {
      const msg = "TypeError: Cannot read property 'id' of undefined";
      const result = bugSanitizer.scrub(makeReport({ errorMessage: msg }));
      expect(result.errorMessage).toBe(msg);
    });
  });

  describe('Metadata scrubbing', () => {
    it('scrubs PII from metadata values', () => {
      const result = bugSanitizer.scrub(makeReport({
        metadata: {
          userId: 'abc-123',
          requestBody: '{"email":"test@example.com"}',
          note: 'Called from NPI: 1234567890',
        },
      }));
      expect(result.metadata['requestBody']).toContain('[REQUEST_BODY_OMITTED]');
      expect(result.metadata['note']).toContain('[NPI_REDACTED]');
      // Clean values pass through
      expect(result.metadata['userId']).toBe('abc-123');
    });
  });

  describe('Brand type', () => {
    it('sets _sanitized flag to true', () => {
      const result = bugSanitizer.scrub(makeReport());
      expect(result._sanitized).toBe(true);
    });
  });
});
