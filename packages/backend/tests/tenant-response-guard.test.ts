import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { tenantResponseGuard } from '../src/middleware/tenantResponseGuard.middleware.js';

/**
 * The point of this guard is that it does not care what the handler intended.
 * So these tests deliberately use handlers that leak — the same way the access
 * review report and user.routes.ts leaked — and assert the response never
 * carries a foreign practice regardless.
 */
function appWith(
  handler: (req: express.Request, res: express.Response) => void,
  scope: { isSuperAdmin: boolean; practiceIds: string[] },
  role = 'practice_admin',
  method: 'get' | 'post' = 'get',
  path = '/api/v1/users'
) {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request, _res, next) => {
    (req as express.Request & { user: unknown }).user = { id: 'u1', role };
    (req as express.Request & { practiceScope: unknown }).practiceScope = scope;
    next();
  });
  app.use(tenantResponseGuard);
  app[method](path, handler);
  return app;
}

const SCOPED = { isSuperAdmin: false, practiceIds: ['practice-a'] };

describe('tenant response guard', () => {
  it('blocks a practice the caller is not scoped to', async () => {
    const app = appWith(
      (_req, res) => {
        res.json({ data: [{ id: 'james', practices: [{ practiceId: 'practice-b' }] }] });
      },
      SCOPED
    );

    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('practice-b');
  });

  it('finds a foreign practice nested under a practice object, not just an id', async () => {
    const app = appWith(
      (_req, res) => {
        res.json({ data: { practice: { id: 'practice-b', name: 'Somebody Else Health' } } });
      },
      SCOPED
    );

    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('Somebody Else Health');
  });

  it('lets a correctly scoped response through untouched', async () => {
    const payload = { data: [{ id: 'drew', practices: [{ practiceId: 'practice-a' }] }] };
    const app = appWith((_req, res) => res.json(payload), SCOPED);

    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });

  it('does not restrict the founder', async () => {
    const app = appWith(
      (_req, res) => res.json({ data: { practiceId: 'practice-z' } }),
      { isSuperAdmin: true, practiceIds: [] },
      'admin'
    );

    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(200);
  });

  it('does not restrict lanyard_staff, who work across every practice', async () => {
    const app = appWith(
      (_req, res) => res.json({ data: { practiceId: 'practice-z' } }),
      { isSuperAdmin: false, practiceIds: [] },
      'lanyard_staff'
    );

    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(200);
  });

  it('warns instead of blocking when TENANT_GUARD_MODE=log', async () => {
    process.env['TENANT_GUARD_MODE'] = 'log';
    try {
      const app = appWith(
        (_req, res) => res.json({ data: { practiceId: 'practice-b' } }),
        SCOPED
      );
      const res = await request(app).get('/api/v1/users');
      expect(res.status).toBe(200);
    } finally {
      delete process.env['TENANT_GUARD_MODE'];
    }
  });
});
