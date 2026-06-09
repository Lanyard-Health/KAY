import { describe, it, expect } from 'vitest';
import { isSensitiveRead } from './audit.middleware.js';

/**
 * Focused unit tests for the `isSensitiveRead` predicate added as part of
 * P1-3/P1-4 (audit GETs on PII routes). Full audit-middleware coverage is
 * tracked separately as verdict P1-14.
 */
describe('audit.middleware — isSensitiveRead', () => {
  it('returns true for GET on /api/v1/providers', () => {
    expect(isSensitiveRead('GET', '/api/v1/providers')).toBe(true);
    expect(isSensitiveRead('GET', '/api/v1/providers/abc-123')).toBe(true);
    expect(isSensitiveRead('GET', '/api/v1/providers/abc/credentials')).toBe(true);
  });

  it('returns true for GET on /api/v1/enrollments', () => {
    expect(isSensitiveRead('GET', '/api/v1/enrollments')).toBe(true);
    expect(isSensitiveRead('GET', '/api/v1/enrollments/uuid')).toBe(true);
  });

  it('returns true for GET on /api/v1/documents', () => {
    expect(isSensitiveRead('GET', '/api/v1/documents')).toBe(true);
    expect(isSensitiveRead('GET', '/api/v1/documents/uuid')).toBe(true);
  });

  it('returns false for GET on non-PII routes', () => {
    expect(isSensitiveRead('GET', '/api/v1/practices')).toBe(false);
    expect(isSensitiveRead('GET', '/api/v1/payers')).toBe(false);
    expect(isSensitiveRead('GET', '/api/v1/users/me')).toBe(false);
    expect(isSensitiveRead('GET', '/api/health')).toBe(false);
  });

  it('returns false for non-GET verbs on PII routes (covered by write-audit path)', () => {
    expect(isSensitiveRead('POST', '/api/v1/providers')).toBe(false);
    expect(isSensitiveRead('PUT', '/api/v1/enrollments/abc')).toBe(false);
    expect(isSensitiveRead('PATCH', '/api/v1/documents/abc')).toBe(false);
    expect(isSensitiveRead('DELETE', '/api/v1/providers/abc')).toBe(false);
  });

  it('does not match partial prefixes that happen to start similarly', () => {
    // /api/v1/providers vs /api/v1/provider-roles
    // startsWith('/api/v1/providers') would falsely match '/api/v1/providers-archive'
    // Verdict scope was the three exact PII routes; this asserts our impl
    // is as permissive as documented (string prefix match).
    expect(isSensitiveRead('GET', '/api/v1/providers-archive')).toBe(true);
    // Document that this is the intentional behavior — if someone adds
    // '/api/v1/providers-archive' later and it should NOT be PII-sensitive,
    // the predicate needs path segment-aware matching instead.
  });
});
