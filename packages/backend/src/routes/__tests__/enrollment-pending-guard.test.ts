import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Router } from 'express';
import { errorHandler } from '../../middleware/error.middleware.js';

// Hoist mocks
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    providerProfile: { findUnique: vi.fn() },
    enrollment: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    payer: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('../../utils/prisma.js', () => ({ prisma: mockPrisma }));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../middleware/auth.middleware.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  authorize: () => (_req: any, _res: any, next: any) => next(),
  requireProviderAccess: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: (_req: any, _res: any, next: any) => next(),
  getPracticeRelationFilter: () => ({}),
  validateProviderPracticeAccess: async () => true,
}));

vi.mock('../../services/enrollment-creation-hook.js', () => ({
  onEnrollmentCreated: vi.fn().mockResolvedValue({ stepsCreated: 0, templateFound: false, workflowType: null }),
}));

vi.mock('../../services/terminationWorkflow.service.js', () => ({
  triggerTerminationWorkflow: vi.fn(),
}));

vi.mock('../../services/opsWorkQueue.service.js', () => ({
  autoCreateWorkItems: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/cache.js', () => ({
  invalidateCache: vi.fn(),
}));

import enrollmentRoutes from '../../routes/enrollment.routes.js';

function createApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user as any;
    req.practiceScope = { isSuperAdmin: false, practiceIds: [] };
    next();
  });
  app.use(enrollmentRoutes);
  app.use(errorHandler);
  return app;
}

const pendingVerificationProvider = {
  id: 'provider-pv',
  role: 'provider' as const,
  providerId: 'provider-pv',
  email: 'pv@test.com',
  isActive: true,
};

const activeProvider = {
  id: 'provider-active',
  role: 'provider' as const,
  providerId: 'provider-active',
  email: 'active@test.com',
  isActive: true,
};

const adminUser = {
  id: 'admin-1',
  role: 'admin' as const,
  providerId: undefined,
  email: 'admin@test.com',
  isActive: true,
};

describe('Enrollment routes — blockPendingVerification guard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /provider/:providerId (create enrollment)', () => {
    it('returns 403 for pending_verification provider', async () => {
      mockPrisma.providerProfile.findUnique.mockResolvedValue({ id: 'provider-pv', status: 'pending_verification' });

      const res = await request(createApp(pendingVerificationProvider))
        .post('/provider/provider-pv')
        .send({ payerName: 'Test Payer' });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('verified');
    });

    it('does not return 403 for active provider', async () => {
      mockPrisma.providerProfile.findUnique.mockResolvedValue({ id: 'provider-active', status: 'active' });

      const res = await request(createApp(activeProvider))
        .post('/provider/provider-active')
        .send({ payerName: 'Test Payer' });

      // Should pass the guard (not 403) — may fail later in route logic, that's fine
      expect(res.status).not.toBe(403);
    });

    it('allows admin to create enrollment regardless of provider status', async () => {
      // Admin user has no providerId, so guard skips
      const res = await request(createApp(adminUser))
        .post('/provider/provider-pv')
        .send({ payerName: 'Test Payer' });

      // Won't be 403 — admin bypasses the guard
      expect(res.status).not.toBe(403);
    });
  });

  describe('PUT /:id (update enrollment)', () => {
    it('returns 403 for pending_verification provider', async () => {
      mockPrisma.providerProfile.findUnique.mockResolvedValue({ id: 'provider-pv', status: 'pending_verification' });

      const res = await request(createApp(pendingVerificationProvider))
        .put('/enr-1')
        .send({ status: 'in_progress' });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('verified');
    });

    it('allows active provider to update enrollment', async () => {
      mockPrisma.providerProfile.findUnique.mockResolvedValue({ id: 'provider-active', status: 'active' });
      mockPrisma.enrollment.findUnique.mockResolvedValue({
        id: 'enr-1',
        providerId: 'provider-active',
      });
      mockPrisma.enrollment.update.mockResolvedValue({
        id: 'enr-1',
        status: 'in_progress',
        payer: {},
      });

      const res = await request(createApp(activeProvider))
        .put('/enr-1')
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /:id (delete enrollment)', () => {
    it('returns 403 for pending_verification provider', async () => {
      mockPrisma.providerProfile.findUnique.mockResolvedValue({ id: 'provider-pv', status: 'pending_verification' });

      const res = await request(createApp(pendingVerificationProvider))
        .delete('/enr-1');

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('verified');
    });
  });
});
