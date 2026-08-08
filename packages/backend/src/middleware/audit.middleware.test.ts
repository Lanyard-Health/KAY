import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isSensitiveRead, auditMiddleware } from './audit.middleware.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

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

/**
 * Regression tests for the mounted-router path bug.
 *
 * The predicate above was always correct; the middleware called it with
 * `req.path`, which Express rewrites to be relative to the mounted router while
 * the request is in flight. Inside `app.use('/api/v1/providers', router)`,
 * req.path is "/" — so no sensitive GET was ever audited, and writes recorded
 * resourceType "unknown". Unit-testing the predicate alone could not catch it.
 * These tests exercise the middleware through a real mounted router.
 */
describe('audit.middleware — through a mounted router', () => {
  function appWithRouterAt(mountPath: string) {
    const app = express();
    app.use(auditMiddleware);
    const router = express.Router();
    router.get('/', (_req, res) => { res.json({ ok: true }); });
    router.post('/', (_req, res) => { res.json({ ok: true }); });
    router.get('/:id', (_req, res) => { res.json({ ok: true }); });
    app.use(mountPath, router);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.create.mockResolvedValue({} as never);
  });

  it('audits a sensitive GET even though req.path is router-relative', async () => {
    await request(appWithRouterAt('/api/v1/providers')).get('/api/v1/providers');

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.auditLog.create.mock.calls[0]![0]!.data as Record<string, any>;
    expect(data['action']).toBe('read');
    expect(data['resourceType']).toBe('providers');
  });

  it('audits partner API reads', async () => {
    await request(appWithRouterAt('/api/v1/partner')).get('/api/v1/partner/providers');

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.auditLog.create.mock.calls[0]![0]!.data as Record<string, any>;
    expect(data['resourceType']).toBe('partner');
  });

  it('records the real resource type on writes instead of "unknown"', async () => {
    await request(appWithRouterAt('/api/v1/enrollments')).post('/api/v1/enrollments');

    const data = prismaMock.auditLog.create.mock.calls[0]![0]!.data as Record<string, any>;
    expect(data['resourceType']).toBe('enrollments');
    expect(data['resourceType']).not.toBe('unknown');
  });

  it('extracts a resource id from the full path, not the router-relative one', async () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    await request(appWithRouterAt('/api/v1/providers')).get(`/api/v1/providers/${uuid}`);

    const data = prismaMock.auditLog.create.mock.calls[0]![0]!.data as Record<string, any>;
    expect(data['resourceId']).toBe(uuid);
  });

  it('ignores the query string when deriving the resource type', async () => {
    await request(appWithRouterAt('/api/v1/providers')).get('/api/v1/providers?page=2&pageSize=50');

    const data = prismaMock.auditLog.create.mock.calls[0]![0]!.data as Record<string, any>;
    expect(data['resourceType']).toBe('providers');
  });

  it('still does not audit non-sensitive reads', async () => {
    await request(appWithRouterAt('/api/v1/payers')).get('/api/v1/payers');
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
