import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// auth.middleware constructs a CognitoJwtVerifier at module level.
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify: vi.fn() }) },
}));

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Only authenticate is replaced — authorize() stays real, so this exercises the
// actual role list on the router plus the real lanyard_staff inheritance rule.
const { currentRole } = vi.hoisted(() => ({ currentRole: { value: 'admin' } }));

vi.mock('../src/middleware/auth.middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/middleware/auth.middleware.js')>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 'u1', role: currentRole.value };
      next();
    },
  };
});

const { defactoRoutes } = await import('../src/routes/defacto.routes.js');

function appFor(role: string) {
  currentRole.value = role;
  const app = express();
  app.use(express.json());
  app.use('/admin/providers', defactoRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

// The Defacto routes look up by ID with no practice filter, so admitting a
// practice-scoped role leaks another practice's provider NPI and full network
// participation. Only cross-practice roles may hold this.
describe('defacto routes authorization', () => {
  const ID = '11111111-1111-4111-8111-111111111111';

  it.each(['credentialing_staff', 'practice_admin', 'provider'])(
    'denies %s',
    async (role) => {
      const res = await request(appFor(role)).get(`/admin/providers/${ID}/defacto`);
      expect(res.status).toBe(403);
    },
  );

  it.each(['admin', 'lanyard_staff'])('admits %s', async (role) => {
    const res = await request(appFor(role)).get(`/admin/providers/${ID}/defacto`);
    expect(res.status).not.toBe(403);
  });

  it('denies credentialing_staff on the write route too', async () => {
    const res = await request(appFor('credentialing_staff')).post(
      `/admin/providers/${ID}/defacto-check`,
    );
    expect(res.status).toBe(403);
  });
});
