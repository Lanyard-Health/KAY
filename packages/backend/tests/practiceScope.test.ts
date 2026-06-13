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
  initPracticeScope,
  attachPracticeScope,
  requirePracticeProvider,
  validateProviderPracticeAccess,
  getPracticeProviderFilter,
  getPracticeRelationFilter,
} from '../src/middleware/practiceScope.middleware.js';

describe('Practice Scope Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // initPracticeScope
  // ==========================================
  describe('initPracticeScope', () => {
    it('sets isSuperAdmin=true for admin role', async () => {
      const req = createMockRequest({
        user: { id: 'admin-id', role: 'admin' } as any,
      });

      await initPracticeScope(req);

      expect(req.practiceScope).toEqual({
        isSuperAdmin: true,
        practiceIds: [],
      });
    });

    it('loads practiceIds from DB for staff user', async () => {
      const req = createMockRequest({
        user: { id: 'staff-id', role: 'credentialing_staff' } as any,
      });

      prismaMock.userPractice.findMany.mockResolvedValue([
        { practiceId: 'practice-1' } as any,
        { practiceId: 'practice-2' } as any,
      ]);

      await initPracticeScope(req);

      expect(req.practiceScope).toEqual({
        isSuperAdmin: false,
        practiceIds: ['practice-1', 'practice-2'],
      });
      expect(prismaMock.userPractice.findMany).toHaveBeenCalledWith({
        where: { userId: 'staff-id' },
        select: { practiceId: true },
      });
    });

    it('skips if practiceScope is already set', async () => {
      const req = createMockRequest({
        user: { id: 'staff-id', role: 'credentialing_staff' } as any,
        practiceScope: { isSuperAdmin: false, practiceIds: ['existing'] },
      } as any);

      await initPracticeScope(req);

      expect(req.practiceScope!.practiceIds).toEqual(['existing']);
      expect(prismaMock.userPractice.findMany).not.toHaveBeenCalled();
    });

    it('does nothing when no user is set', async () => {
      const req = createMockRequest();

      await initPracticeScope(req);

      expect(req.practiceScope).toBeUndefined();
      expect(prismaMock.userPractice.findMany).not.toHaveBeenCalled();
    });

    it('falls back to empty practiceIds on DB error', async () => {
      const req = createMockRequest({
        user: { id: 'staff-id', role: 'credentialing_staff' } as any,
      });

      prismaMock.userPractice.findMany.mockRejectedValue(new Error('DB down'));

      await initPracticeScope(req);

      expect(req.practiceScope).toEqual({
        isSuperAdmin: false,
        practiceIds: [],
      });
    });
  });

  // ==========================================
  // attachPracticeScope (middleware)
  // ==========================================
  describe('attachPracticeScope', () => {
    it('sets isSuperAdmin=true for admin and calls next', async () => {
      const req = createMockRequest({
        user: { id: 'admin-id', role: 'admin' } as any,
      });
      const res = createMockResponse();
      const next = createMockNext();

      await attachPracticeScope(req, res, next);

      expect(req.practiceScope).toEqual({
        isSuperAdmin: true,
        practiceIds: [],
      });
      expect(next).toHaveBeenCalled();
    });

    it('loads practice IDs for staff and calls next', async () => {
      const req = createMockRequest({
        user: { id: 'staff-id', role: 'credentialing_staff' } as any,
      });
      const res = createMockResponse();
      const next = createMockNext();

      prismaMock.userPractice.findMany.mockResolvedValue([
        { practiceId: 'p-1' } as any,
      ]);

      await attachPracticeScope(req, res, next);

      expect(req.practiceScope).toEqual({
        isSuperAdmin: false,
        practiceIds: ['p-1'],
      });
      expect(next).toHaveBeenCalled();
    });

    it('calls next without setting scope when no user', async () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await attachPracticeScope(req, res, next);

      expect(req.practiceScope).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });

  // ==========================================
  // requirePracticeProvider (route middleware)
  // ==========================================
  describe('requirePracticeProvider', () => {
    it('super admin bypasses and calls next', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
        params: { providerId: 'any-provider' },
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      await requirePracticeProvider(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(prismaMock.providerProfile.findUnique).not.toHaveBeenCalled();
    });

    it('staff with matching practice passes', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        params: { providerId: 'provider-1' },
        user: { id: 'staff-id' } as any,
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      prismaMock.providerProfile.findUnique.mockResolvedValue({
        practiceId: 'practice-A',
      } as any);

      await requirePracticeProvider(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('staff with wrong practice gets 403', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        params: { providerId: 'provider-1' },
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ message: expect.stringContaining('not in your practice') }),
        })
      );
    });

    it('staff cannot access provider with null practiceId (security: cross-practice isolation)', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        params: { providerId: 'provider-unassigned' },
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

    it('provider can access their own unassigned record', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: [] },
        params: { providerId: 'my-provider-id' },
        user: { id: 'user-id', role: 'provider', providerId: 'my-provider-id' } as any,
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      prismaMock.providerProfile.findUnique.mockResolvedValue({
        practiceId: null,
      } as any);

      await requirePracticeProvider(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next when provider not found (let route handler 404)', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        params: { providerId: 'nonexistent' },
        user: { id: 'staff-id' } as any,
      } as any);
      const res = createMockResponse();
      const next = createMockNext();

      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      await requirePracticeProvider(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ==========================================
  // validateProviderPracticeAccess (helper)
  // ==========================================
  describe('validateProviderPracticeAccess', () => {
    it('returns true for super admin', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
      } as any);

      const result = await validateProviderPracticeAccess(req, 'any-provider');

      expect(result).toBe(true);
      expect(prismaMock.providerProfile.findUnique).not.toHaveBeenCalled();
    });

    it('returns true when provider is in staff practice', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        user: { id: 'staff-id' } as any,
      } as any);

      prismaMock.providerProfile.findUnique.mockResolvedValue({
        practiceId: 'practice-A',
      } as any);

      const result = await validateProviderPracticeAccess(req, 'provider-1');

      expect(result).toBe(true);
    });

    it('returns false when provider is outside staff practice', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        user: { id: 'staff-id' } as any,
      } as any);

      prismaMock.providerProfile.findUnique.mockResolvedValue({
        practiceId: 'practice-B',
      } as any);

      const result = await validateProviderPracticeAccess(req, 'provider-1');

      expect(result).toBe(false);
    });

    it('returns false for staff accessing provider with null practiceId', async () => {
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

    it('fails closed (returns false) when the provider row is missing', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['practice-A'] },
        user: { id: 'staff-id', role: 'credentialing_staff' } as any,
      } as any);

      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const result = await validateProviderPracticeAccess(req, 'ghost-provider');

      expect(result).toBe(false);
    });

    it('returns true for provider accessing their own unassigned record', async () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: [] },
        user: { id: 'user-id', role: 'provider', providerId: 'my-provider-id' } as any,
      } as any);

      prismaMock.providerProfile.findUnique.mockResolvedValue({
        practiceId: null,
      } as any);

      const result = await validateProviderPracticeAccess(req, 'my-provider-id');

      expect(result).toBe(true);
    });
  });

  // ==========================================
  // getPracticeProviderFilter (WHERE clause builder)
  // ==========================================
  describe('getPracticeProviderFilter', () => {
    it('returns deletedAt-only filter for super admin (active providers only)', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
      } as any);

      // Soft-delete filter applied to every variant — super admin still sees only active.
      expect(getPracticeProviderFilter(req)).toEqual({ deletedAt: null });
    });

    it('returns own-practice + deletedAt filter for staff (no unassigned, no archived)', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['p-1', 'p-2'] },
      } as any);

      expect(getPracticeProviderFilter(req)).toEqual({
        practiceId: { in: ['p-1', 'p-2'] },
        deletedAt: null,
      });
    });

    it('returns no-access filter for staff with no practices', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: [] },
      } as any);

      expect(getPracticeProviderFilter(req)).toEqual({
        id: '__no_access__',
      });
    });
  });

  // ==========================================
  // getPracticeRelationFilter (nested WHERE builder)
  // ==========================================
  describe('getPracticeRelationFilter', () => {
    it('returns nested deletedAt-only filter for super admin (active providers’ resources)', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: true, practiceIds: [] },
      } as any);

      expect(getPracticeRelationFilter(req)).toEqual({ provider: { deletedAt: null } });
    });

    it('returns nested filter for own practice + deletedAt: null', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: ['p-1'] },
      } as any);

      expect(getPracticeRelationFilter(req)).toEqual({
        provider: { practiceId: { in: ['p-1'] }, deletedAt: null },
      });
    });

    it('returns no-access nested filter for staff with no practices', () => {
      const req = createMockRequest({
        practiceScope: { isSuperAdmin: false, practiceIds: [] },
      } as any);

      expect(getPracticeRelationFilter(req)).toEqual({
        provider: { id: '__no_access__' },
      });
    });
  });
});
