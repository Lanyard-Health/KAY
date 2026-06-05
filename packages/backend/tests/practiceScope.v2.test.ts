import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
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
    it('getPracticeProviderFilter returns deletedAt-only filter for admin (excludes archived)', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
      } as any);

      const filter = getPracticeProviderFilter(req);

      expect(filter).toEqual({ deletedAt: null });
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
      expect(prismaMock.providerProfile.findUnique).not.toHaveBeenCalled();
    });

    it('validateProviderPracticeAccess returns true for admin without DB call', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
      } as any);

      const result = await validateProviderPracticeAccess(req, 'any-provider-id');

      expect(result).toBe(true);
      expect(prismaMock.providerProfile.findUnique).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // STAFF WITH PRACTICE ASSIGNMENT
  // ==========================================
  describe('Staff with practice assignment', () => {
    it('sees only providers in their assigned practices (not unassigned)', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A', 'practice-B'] },
      } as any);

      const filter = getPracticeProviderFilter(req);

      expect(filter).toEqual({
        practiceId: { in: ['practice-A', 'practice-B'] },
        deletedAt: null,
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

      prismaMock.providerProfile.findUnique.mockResolvedValue({
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
    it('sees nothing (no-access filter)', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: [] },
      } as any);

      const filter = getPracticeProviderFilter(req);

      expect(filter).toEqual({
        id: '__no_access__',
      });
    });
  });

  // ==========================================
  // UNASSIGNED PROVIDERS (practiceId=null)
  // ==========================================
  describe('Unassigned providers (practiceId=null)', () => {
    it('are NOT accessible to staff (security: cross-practice isolation)', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        params: { providerId: 'unassigned-provider' },
        user: { id: 'staff-id', role: 'credentialing_staff' } as any,
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      prismaMock.providerProfile.findUnique.mockResolvedValue({
        practiceId: null,
      } as any);

      await requirePracticeProvider(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('validateProviderPracticeAccess returns false for staff with null practiceId', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        user: { id: 'staff-id', role: 'credentialing_staff' } as any,
      } as any);

      prismaMock.providerProfile.findUnique.mockResolvedValue({
        practiceId: null,
      } as any);

      const result = await validateProviderPracticeAccess(req, 'unassigned-provider');

      expect(result).toBe(false);
    });

    it('are accessible to admins', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
        params: { providerId: 'unassigned-provider' },
        user: { id: 'admin-id', role: 'admin' } as any,
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      await requirePracticeProvider(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
