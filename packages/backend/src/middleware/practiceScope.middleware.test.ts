import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { requirePracticeProvider } from './practiceScope.middleware.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

function makeReq(role: string, providerId = 'prov-1', extra: Record<string, unknown> = {}) {
  return {
    user: { id: 'user-1', role, ...extra },
    params: { providerId },
    body: {},
    practiceScope: { isSuperAdmin: role === 'admin', practiceIds: [] },
  } as any;
}

function makeRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (payload: unknown) => ((res.body = payload), res);
  return res;
}

describe('requirePracticeProvider — unassigned provider (no practiceId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.providerProfile.findUnique.mockResolvedValue({ practiceId: null } as any);
  });

  it('allows lanyard_staff (services all practices; creates unassigned providers)', async () => {
    const next = vi.fn();
    await requirePracticeProvider(makeReq('lanyard_staff'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows admin', async () => {
    const next = vi.fn();
    await requirePracticeProvider(makeReq('admin'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('still blocks practice_admin without an in-scope claim', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requirePracticeProvider(makeReq('practice_admin'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toMatch(/unassigned provider/);
  });

  it('still blocks a provider touching a different unassigned provider', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requirePracticeProvider(makeReq('provider', 'prov-1', { providerId: 'someone-else' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
