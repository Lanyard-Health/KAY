import { describe, it, expect } from 'vitest';
import { bugFingerprintService } from '../fingerprint.js';
import type { SanitizedBugReport } from '../types.js';

function makeReport(overrides: Partial<SanitizedBugReport> = {}): SanitizedBugReport {
  return {
    source: 'backend-runtime',
    title: 'Test Error',
    errorMessage: overrides.errorMessage ?? 'Something failed',
    errorClass: overrides.errorClass ?? 'Error',
    stackTrace: overrides.stackTrace,
    metadata: overrides.metadata ?? {},
    occurredAt: new Date(),
    environment: 'development',
    _sanitized: true,
  };
}

describe('BugFingerprintService', () => {
  it('produces deterministic hashes for the same error', () => {
    const report = makeReport({ errorMessage: 'Connection refused' });
    const hash1 = bugFingerprintService.generate(report);
    const hash2 = bugFingerprintService.generate(report);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different error messages', () => {
    const hash1 = bugFingerprintService.generate(makeReport({ errorMessage: 'Connection refused' }));
    const hash2 = bugFingerprintService.generate(makeReport({ errorMessage: 'Timeout exceeded' }));
    expect(hash1).not.toBe(hash2);
  });

  it('normalizes UUIDs so the same error with different IDs produces the same hash', () => {
    const hash1 = bugFingerprintService.generate(makeReport({
      errorMessage: 'Provider a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found',
    }));
    const hash2 = bugFingerprintService.generate(makeReport({
      errorMessage: 'Provider 99999999-aaaa-bbbb-cccc-dddddddddddd not found',
    }));
    expect(hash1).toBe(hash2);
  });

  it('normalizes URL path numbers', () => {
    const hash1 = bugFingerprintService.generate(makeReport({
      errorMessage: 'GET /api/v1/providers/123/enrollments failed',
    }));
    const hash2 = bugFingerprintService.generate(makeReport({
      errorMessage: 'GET /api/v1/providers/456/enrollments failed',
    }));
    expect(hash1).toBe(hash2);
  });

  it('same error at different line numbers but same function name produces same hash', () => {
    const stack1 = [
      'Error: fail',
      '    at ProviderService.getEnrollments (provider.service.ts:100)',
      '    at Router.handle (router.ts:50)',
    ].join('\n');
    const stack2 = [
      'Error: fail',
      '    at ProviderService.getEnrollments (provider.service.ts:200)',
      '    at Router.handle (router.ts:99)',
    ].join('\n');
    const hash1 = bugFingerprintService.generate(makeReport({ stackTrace: stack1 }));
    const hash2 = bugFingerprintService.generate(makeReport({ stackTrace: stack2 }));
    expect(hash1).toBe(hash2);
  });

  it('falls back to filename:line for anonymous functions', () => {
    const stack = [
      'Error: fail',
      '    at Object.<anonymous> (/app/src/index.ts:42:5)',
    ].join('\n');
    const hash = bugFingerprintService.generate(makeReport({ stackTrace: stack }));
    // Just verify it produces a valid hash (the fallback logic is exercised)
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('extracts function names from realistic V8 stack traces', () => {
    const stack = [
      'PrismaClientKnownRequestError: Invalid `prisma.provider.findUnique()` invocation',
      '    at ProviderService.getById (/app/src/services/provider.service.ts:42:5)',
      '    at EnrollmentService.validateProvider (/app/src/services/enrollment.service.ts:88:12)',
      '    at Router.handle (/app/node_modules/express/lib/router/index.js:300:14)',
      '    at Object.<anonymous> (/app/src/index.ts:10:3)',
    ].join('\n');

    // Two different reports with same functions but different line numbers should match
    const stack2 = stack.replace(':42:5', ':99:5').replace(':88:12', ':100:12');
    const hash1 = bugFingerprintService.generate(makeReport({ stackTrace: stack }));
    const hash2 = bugFingerprintService.generate(makeReport({ stackTrace: stack2 }));
    expect(hash1).toBe(hash2);
  });
});
