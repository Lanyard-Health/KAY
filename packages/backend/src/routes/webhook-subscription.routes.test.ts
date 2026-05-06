import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

// SSRF guard is mocked per-test so we can independently assert "rejected
// because of SSRF" vs. "rejected because of HTTPS gate" without standing
// up real DNS in tests.
vi.mock('../utils/ssrf-guard.js', () => ({
  checkSsrfSafety: vi.fn(),
}));

vi.mock('../utils/crypto.js', () => ({
  encryptSafe: vi.fn((s: string) => `enc:${s}`),
  decryptSafe: vi.fn((s: string) => s.replace(/^enc:/, '')),
}));

import router from './webhook-subscription.routes.js';
import { errorHandler } from '../middleware/error.middleware.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { checkSsrfSafety } from '../utils/ssrf-guard.js';
import { encryptSafe } from '../utils/crypto.js';
import { adminUser, practiceAdminUser } from '../../tests/helpers/fixtures.js';
import { createTestApp } from '../../tests/helpers/test-app.js';

const ssrfMock = checkSsrfSafety as unknown as ReturnType<typeof vi.fn>;
const encryptSafeMock = encryptSafe as unknown as ReturnType<typeof vi.fn>;

const PRACTICE_A = '11111111-1111-1111-1111-111111111111';
const PRACTICE_B = '22222222-2222-2222-2222-222222222222';

// Custom test app builder — createTestApp puts non-admin users in an
// empty-practiceIds scope, but we need them assigned to a specific practice
// for the practice-scope tests, so we set req.practiceScope ourselves.
function rebuildAppWithScope(user: Record<string, unknown>, practiceIds: string[]) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = user;
    req.practiceScope =
      user['role'] === 'admin'
        ? { isSuperAdmin: true, practiceIds: [] }
        : { isSuperAdmin: false, practiceIds };
    next();
  });
  app.use(router);
  app.use(errorHandler);
  return app;
}

const baseSubRow = {
  id: 'sub-1',
  practiceId: PRACTICE_A,
  url: 'https://example.com/webhook',
  eventTypes: ['agent_event.created'],
  secretEncrypted: 'enc:abc',
  description: null,
  active: true,
  createdById: practiceAdminUser.id,
  lastDeliveryAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
  createdAt: new Date('2026-05-06T12:00:00Z'),
  updatedAt: new Date('2026-05-06T12:00:00Z'),
  deletedAt: null,
};

describe('POST /api/v1/webhook-subscriptions', () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    envSnap = { NODE_ENV: process.env['NODE_ENV'] };
    ssrfMock.mockResolvedValue({ ok: true, ip: '93.184.216.34' });
    prismaMock.webhookSubscription.create.mockResolvedValue(baseSubRow as never);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnap)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('creates a subscription and returns the secret exactly once', async () => {
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app)
      .post('/')
      .send({
        practiceId: PRACTICE_A,
        url: 'https://example.com/webhook',
        eventTypes: ['agent_event.created', 'enrollment.status_changed'],
        description: 'My webhook',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('sub-1');
    expect(res.body.data.secret).toMatch(/^[a-f0-9]{64}$/);
    // secretEncrypted should never be returned to the client
    expect(res.body.data.secretEncrypted).toBeUndefined();

    expect(encryptSafeMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.webhookSubscription.create).toHaveBeenCalledTimes(1);
    const createCall = prismaMock.webhookSubscription.create.mock.calls[0]?.[0] as {
      data: { practiceId: string; url: string; secretEncrypted: string };
    };
    expect(createCall.data.practiceId).toBe(PRACTICE_A);
    expect(createCall.data.url).toBe('https://example.com/webhook');
    expect(createCall.data.secretEncrypted).toMatch(/^enc:[a-f0-9]{64}$/);
  });

  it('rejects when SSRF guard rejects the URL', async () => {
    ssrfMock.mockResolvedValueOnce({ ok: false, reason: 'IPv4 in 10.0.0.0/8' });
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app)
      .post('/')
      .send({
        practiceId: PRACTICE_A,
        url: 'https://internal.evil.example/x',
        eventTypes: ['agent_event.created'],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/URL rejected/);
    expect(prismaMock.webhookSubscription.create).not.toHaveBeenCalled();
  });

  it('rejects HTTP URL in production', async () => {
    process.env['NODE_ENV'] = 'production';
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app)
      .post('/')
      .send({
        practiceId: PRACTICE_A,
        url: 'http://example.com/webhook',
        eventTypes: ['agent_event.created'],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/HTTPS in production/);
    expect(prismaMock.webhookSubscription.create).not.toHaveBeenCalled();
  });

  it('rejects when staff creates for a practice they are not assigned to', async () => {
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app)
      .post('/')
      .send({
        practiceId: PRACTICE_B,
        url: 'https://example.com/webhook',
        eventTypes: ['agent_event.created'],
      });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/Insufficient permissions/);
    expect(prismaMock.webhookSubscription.create).not.toHaveBeenCalled();
  });

  it('admin can create for any practice (super-admin scope)', async () => {
    const app = createTestApp(router, adminUser as Record<string, unknown>);

    const res = await request(app)
      .post('/')
      .send({
        practiceId: PRACTICE_B,
        url: 'https://example.com/webhook',
        eventTypes: ['agent_event.created'],
      });

    expect(res.status).toBe(201);
    expect(prismaMock.webhookSubscription.create).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown event types', async () => {
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app)
      .post('/')
      .send({
        practiceId: PRACTICE_A,
        url: 'https://example.com/webhook',
        eventTypes: ['enrollment.something_else'],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Invalid request body/);
    expect(prismaMock.webhookSubscription.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/webhook-subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns subscriptions filtered to practice scope (non-admin)', async () => {
    prismaMock.webhookSubscription.findMany.mockResolvedValueOnce([baseSubRow] as never);
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('sub-1');
    // secretEncrypted must never appear in GET responses
    expect(res.body.data[0].secretEncrypted).toBeUndefined();
    expect(res.body.data[0].secret).toBeUndefined();

    const findArgs = prismaMock.webhookSubscription.findMany.mock.calls[0]?.[0] as {
      where: { deletedAt: null; practiceId: { in: string[] } };
    };
    expect(findArgs.where.deletedAt).toBeNull();
    expect(findArgs.where.practiceId.in).toEqual([PRACTICE_A]);
  });

  it('admin gets the unscoped list (no practiceId filter)', async () => {
    prismaMock.webhookSubscription.findMany.mockResolvedValueOnce([] as never);
    const app = createTestApp(router, adminUser as Record<string, unknown>);

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    const findArgs = prismaMock.webhookSubscription.findMany.mock.calls[0]?.[0] as {
      where: { deletedAt: null; practiceId?: unknown };
    };
    expect(findArgs.where.deletedAt).toBeNull();
    expect(findArgs.where.practiceId).toBeUndefined();
  });
});

describe('DELETE /api/v1/webhook-subscriptions/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('soft-deletes a subscription owned by the user practice', async () => {
    prismaMock.webhookSubscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      practiceId: PRACTICE_A,
      deletedAt: null,
    } as never);
    prismaMock.webhookSubscription.update.mockResolvedValueOnce({
      ...baseSubRow,
      active: false,
      deletedAt: new Date(),
    } as never);

    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app).delete('/sub-1');

    expect(res.status).toBe(200);
    expect(prismaMock.webhookSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ active: false, deletedAt: expect.any(Date) }),
      })
    );
  });

  it('returns 404 for a subscription belonging to another practice (no existence leak)', async () => {
    prismaMock.webhookSubscription.findUnique.mockResolvedValueOnce({
      id: 'sub-X',
      practiceId: PRACTICE_B,
      deletedAt: null,
    } as never);
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app).delete('/sub-X');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/not found/i);
    expect(prismaMock.webhookSubscription.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a subscription that is already soft-deleted', async () => {
    prismaMock.webhookSubscription.findUnique.mockResolvedValueOnce({
      id: 'sub-1',
      practiceId: PRACTICE_A,
      deletedAt: new Date(),
    } as never);
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app).delete('/sub-1');

    expect(res.status).toBe(404);
    expect(prismaMock.webhookSubscription.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a subscription that does not exist', async () => {
    prismaMock.webhookSubscription.findUnique.mockResolvedValueOnce(null as never);
    const app = rebuildAppWithScope(practiceAdminUser as Record<string, unknown>, [PRACTICE_A]);

    const res = await request(app).delete('/missing');

    expect(res.status).toBe(404);
  });
});
