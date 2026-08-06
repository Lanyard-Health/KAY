import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

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

vi.mock('../src/middleware/auth.middleware.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  authorize: () => (_req: any, _res: any, next: any) => next(),
  requireProviderAccess: (_req: any, _res: any, next: any) => next(),
  ALL_AUTHENTICATED_ROLES: ['admin', 'lanyard_staff', 'credentialing_staff', 'provider', 'practice_admin'],
}));

import { prismaMock } from './helpers/mock-prisma.js';
import { documentRoutes } from '../src/routes/document.routes.js';

function appAs(role: string, practiceIds: string[], isSuperAdmin = false) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: 'u1', role };
    req.practiceScope = { isSuperAdmin, practiceIds };
    next();
  });
  app.use(documentRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

/**
 * The OCR review queue returns provider first name, last name and NPI. It was
 * querying `{ ocrStatus: 'needs_review' }` with no practice filter at all, while
 * admitting practice_admin — a role real production users hold. Every other
 * route in document.routes.ts scopes; these two did not.
 */
describe('OCR review routes are practice-scoped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.document.findMany.mockResolvedValue([] as any);
    prismaMock.document.count.mockResolvedValue(0 as any);
  });

  it('restricts the queue to the caller practices', async () => {
    await request(appAs('practice_admin', ['practice-1'])).get('/ocr-review-queue');

    const where = prismaMock.document.findMany.mock.calls[0]![0]!.where;
    expect(where.ocrStatus).toBe('needs_review');
    // Both ownership shapes, restricted to the caller's practice.
    expect(where.OR).toEqual([
      { provider: { practiceId: { in: ['practice-1'] }, deletedAt: null } },
      { providerId: null, practiceId: { in: ['practice-1'] } },
    ]);
  });

  it('restricts the count the same way', async () => {
    await request(appAs('credentialing_staff', ['practice-2'])).get('/ocr-review-count');

    const where = prismaMock.document.count.mock.calls[0]![0]!.where;
    expect(where.OR).toEqual([
      { provider: { practiceId: { in: ['practice-2'] }, deletedAt: null } },
      { providerId: null, practiceId: { in: ['practice-2'] } },
    ]);
  });

  it('leaves a super admin unfiltered — cross-practice is the point of the role', async () => {
    await request(appAs('admin', [], true)).get('/ocr-review-queue');

    const where = prismaMock.document.findMany.mock.calls[0]![0]!.where;
    expect(where.OR).toBeUndefined();
    expect(where.ocrStatus).toBe('needs_review');
  });

  it('matches nothing when the caller has no practice at all', async () => {
    // A practice-scoped account with zero practices must see nothing, never
    // everything — the failure mode this whole workstream exists to prevent.
    await request(appAs('practice_admin', [])).get('/ocr-review-queue');

    const where = prismaMock.document.findMany.mock.calls[0]![0]!.where;
    expect(where.id).toBe('__no_access__');
  });
});
