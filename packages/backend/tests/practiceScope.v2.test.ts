import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/middleware/error.middleware.js', () => ({
  ForbiddenError: class ForbiddenError extends Error {
    statusCode = 403;
    constructor(msg: string) {
      super(msg);
    }
  },
  errorHandler: vi.fn(),
}));

import { prismaMock } from './helpers/mock-prisma.js';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
} from './helpers/mock-express.js';
import {
  requirePracticeProvider,
  validateProviderPracticeAccess,
  getPracticeProviderFilter,
} from '../src/middleware/practiceScope.middleware.js';

describe('Practice Scope — Multi-Tenant Access Control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // SUPER ADMIN BYPASS
  // ==========================================
  describe('Super admin bypasses all practice filters', () => {
    it('getPracticeProviderFilter returns empty object for admin', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
      } as any);

      const filter = getPracticeProviderFilter(req);

      expect(filter).toEqual({});
    });

    it('requirePracticeProvider calls next without DB lookup for admin', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
        params: { providerId: 'any-provider-id' },
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      await requirePracticeProvider(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(prismaMock.provider.findUnique).not.toHaveBeenCalled();
    });

    it('validateProviderPracticeAccess returns true for admin without DB call', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
      } as any);

      const result = await validateProviderPracticeAccess(req, 'any-provider-id');

      expect(result).toBe(true);
      expect(prismaMock.provider.findUnique).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // STAFF WITH PRACTICE ASSIGNMENT
  // ==========================================
  describe('Staff with practice assignment', () => {
    it('only sees providers in their assigned practices', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A', 'practice-B'] },
      } as any);

      const filter = getPracticeProviderFilter(req);

      expect(filter).toEqual({
        practiceId: { in: ['practice-A', 'practice-B'] },
      });
    });

    it('cannot access providers outside their practice (403)', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        params: { providerId: 'provider-in-B' },
        user: { id: 'staff-id' } as any,
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      prismaMock.provider.findUnique.mockResolvedValue({
        practiceId: 'practice-B',
      } as any);

      await requirePracticeProvider(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ==========================================
  // STAFF WITH NO PRACTICE ASSIGNMENTS
  // ==========================================
  describe('Staff with no practice assignments', () => {
    it('sees empty results (impossible filter)', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: [] },
      } as any);

      const filter = getPracticeProviderFilter(req);

      expect(filter).toEqual({
        practiceId: '__no_practice_match__',
      });
    });
  });

  // ==========================================
  // UNASSIGNED PROVIDERS (practiceId=null)
  // ==========================================
  describe('Unassigned providers (practiceId=null)', () => {
    it('are invisible to non-admin users via requirePracticeProvider', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        params: { providerId: 'unassigned-provider' },
        user: { id: 'staff-id' } as any,
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      prismaMock.provider.findUnique.mockResolvedValue({
        practiceId: null,
      } as any);

      await requirePracticeProvider(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('validateProviderPracticeAccess returns false for null practiceId', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        user: { id: 'staff-id' } as any,
      } as any);

      prismaMock.provider.findUnique.mockResolvedValue({
        practiceId: null,
      } as any);

      const result = await validateProviderPracticeAccess(req, 'unassigned-provider');

      expect(result).toBe(false);
    });
  });
});
