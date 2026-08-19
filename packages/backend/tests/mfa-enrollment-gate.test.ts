import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

// vi.hoisted: the mock factory below is lifted above every import, so a plain
// const here would not exist yet when it runs.
const { getMfaEnrollmentStatus } = vi.hoisted(() => ({ getMfaEnrollmentStatus: vi.fn() }));
vi.mock('../src/services/mfaEnrollment.service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/mfaEnrollment.service.js')>(
    '../src/services/mfaEnrollment.service.js',
  );
  return { ...actual, getMfaEnrollmentStatus };
});

import { prismaMock } from './helpers/mock-prisma.js';
import { mfaEnrollmentBlocked } from '../src/middleware/mfaEnrollmentGate.middleware.js';

/**
 * The gate exists because a redirect in the SPA stops nobody holding a stolen
 * password: they get a real access token and can call the API directly. So
 * these tests never touch the UI — they check that the API itself closes.
 *
 * The fake `authenticate` below mirrors the real one: set req.user, then ask
 * the gate, and stop if it answers yes. An earlier version of this ran the
 * check as an app-level `app.use` BEFORE any user existed, which passed every
 * request; that shape is why this stub sets the user first.
 */
function appWith(
  { authenticated = true, path = '/api/v1/providers' }: { authenticated?: boolean; path?: string } = {},
) {
  const app = express();
  app.use(express.json());
  app.use(async (req: express.Request, res: express.Response, next) => {
    if (authenticated) {
      (req as express.Request & { user: unknown }).user = {
        id: 'u1',
        cognitoId: 'sub-1',
        email: 'jordan@example.com',
        role: 'practice_admin',
      };
    }
    if (await mfaEnrollmentBlocked(req, res)) return;
    next();
  });
  app.get(path, (_req, res) => {
    res.json({ success: true, secret: 'provider data' });
  });
  return { app, path };
}

/** Created long before the cutoff, so this account is entitled to grace skips. */
const EXISTING = new Date('2026-01-01T00:00:00Z');
/** Created after the cutoff — brand new, no grace. */
const BRAND_NEW = new Date('2026-09-01T00:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  getMfaEnrollmentStatus.mockReset();
});

describe('MFA enrollment gate', () => {
  it('refuses an un-enrolled user who has spent every skip', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: EXISTING, mfaSkipsUsed: 3 } as never);
    getMfaEnrollmentStatus.mockResolvedValue({ enrolled: false, methods: [] });

    const { app, path } = appWith();
    const res = await request(app).get(path);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(JSON.stringify(res.body)).not.toContain('provider data');
  });

  it('lets an enrolled user through even with every skip spent', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: EXISTING, mfaSkipsUsed: 3 } as never);
    getMfaEnrollmentStatus.mockResolvedValue({ enrolled: true, methods: ['authenticator'] });

    const { app, path } = appWith();
    const res = await request(app).get(path);

    expect(res.status).toBe(200);
  });

  it('counts a passkey as enrolled, not just codes', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: EXISTING, mfaSkipsUsed: 3 } as never);
    getMfaEnrollmentStatus.mockResolvedValue({ enrolled: true, methods: ['passkey'] });

    const { app, path } = appWith();
    expect((await request(app).get(path)).status).toBe(200);
  });

  it('lets an un-enrolled user through while they still have skips left', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: EXISTING, mfaSkipsUsed: 1 } as never);

    const { app, path } = appWith();
    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    // Cheap by design: with skips left the answer cannot change, so Cognito is
    // never asked.
    expect(getMfaEnrollmentStatus).not.toHaveBeenCalled();
  });

  it('gives a brand-new account no grace at all', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: BRAND_NEW, mfaSkipsUsed: 0 } as never);
    getMfaEnrollmentStatus.mockResolvedValue({ enrolled: false, methods: [] });

    const { app, path } = appWith();
    expect((await request(app).get(path)).status).toBe(403);
  });

  it('keeps the enrollment endpoints reachable, or the flow could never finish', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: EXISTING, mfaSkipsUsed: 3 } as never);
    getMfaEnrollmentStatus.mockResolvedValue({ enrolled: false, methods: [] });

    const { app, path } = appWith({ path: '/api/v1/auth/mfa/status' });
    expect((await request(app).get(path)).status).toBe(200);
  });

  it("lets a walled user read their own profile, or sign-in cannot finish", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: EXISTING, mfaSkipsUsed: 3 } as never);
    getMfaEnrollmentStatus.mockResolvedValue({ enrolled: false, methods: [] });

    const { app, path } = appWith({ path: '/api/v1/users/me' });
    expect((await request(app).get(path)).status).toBe(200);
  });

  it('still blocks the wider users list, not just anything under /users', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: EXISTING, mfaSkipsUsed: 3 } as never);
    getMfaEnrollmentStatus.mockResolvedValue({ enrolled: false, methods: [] });

    const { app, path } = appWith({ path: '/api/v1/users' });
    expect((await request(app).get(path)).status).toBe(403);
  });

  it('ignores unauthenticated requests rather than 403-ing public routes', async () => {
    const { app, path } = appWith({ authenticated: false });
    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('fails open when the status check throws, so a Cognito blip is not an outage', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: EXISTING, mfaSkipsUsed: 3 } as never);
    getMfaEnrollmentStatus.mockRejectedValue(new Error('Cognito unreachable'));

    const { app, path } = appWith();
    expect((await request(app).get(path)).status).toBe(200);
  });
});
