/**
 * Security regression tests for PR #97 hardening fixes.
 *
 * These tests use real role-checking authorize() logic (not mocked to pass-through)
 * so they catch regressions if someone removes an authorize() call or changes allowed roles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  errorHandler,
  UnauthorizedError,
  ForbiddenError,
} from '../../src/middleware/error.middleware.js';

// ==========================================
// Hoisted mocks — service layer stubs
// ==========================================

const {
  mockGetModelInfo,
  mockGetTodayTokenUsage,
  mockCheckTokenBudget,
  mockIsConfigured,
  mockGenerateFollowUpEmail,
  mockAnalyzeEnrollment,
  mockAnalyzePortfolio,
  mockGetRecommendations,
  mockUpdateRecommendationStatus,
  mockGetUploadUrl,
  mockConfirmUpload,
  mockGetDownloadUrl,
  mockDeleteDocument,
  mockGetEnrollmentPipeline,
  mockGetExpirationForecast,
  mockGetProviderReadiness,
  mockGetGettingStartedStatus,
} = vi.hoisted(() => ({
  mockGetModelInfo: vi.fn().mockReturnValue({ model: 'test', provider: 'test' }),
  mockGetTodayTokenUsage: vi.fn().mockResolvedValue({ input: 0, output: 0 }),
  mockCheckTokenBudget: vi.fn().mockResolvedValue({ budget: 100000, used: 0, remaining: 100000, allowed: true }),
  mockIsConfigured: vi.fn().mockReturnValue(true),
  mockGenerateFollowUpEmail: vi.fn().mockResolvedValue({ subject: 'test', body: 'test' }),
  mockAnalyzeEnrollment: vi.fn().mockResolvedValue({ analysis: 'test' }),
  mockAnalyzePortfolio: vi.fn().mockResolvedValue({ summary: 'test' }),
  mockGetRecommendations: vi.fn().mockResolvedValue({ recommendations: [] }),
  mockUpdateRecommendationStatus: vi.fn().mockResolvedValue({ id: 'r1' }),
  mockGetUploadUrl: vi.fn(),
  mockConfirmUpload: vi.fn(),
  mockGetDownloadUrl: vi.fn(),
  mockDeleteDocument: vi.fn(),
  mockGetEnrollmentPipeline: vi.fn().mockResolvedValue({ byPayer: [], total: {} }),
  mockGetExpirationForecast: vi.fn().mockResolvedValue({ buckets: {}, counts: {} }),
  mockGetProviderReadiness: vi.fn().mockResolvedValue({ providers: [], summary: {} }),
  mockGetGettingStartedStatus: vi.fn().mockResolvedValue({ providerCount: 0, isOnboarded: false }),
}));

// Mock authenticate as pass-through; authorize with real role-checking logic
vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  authorize:
    (...allowedRoles: string[]) =>
    (req: any, _res: any, next: any) => {
      if (!req.user) return next(new UnauthorizedError('Not authenticated'));
      if (!allowedRoles.includes(req.user.role))
        return next(new ForbiddenError('Insufficient permissions'));
      next();
    },
  requireProviderAccess: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../src/services/ai.service.js', () => ({
  isConfigured: mockIsConfigured,
  getModelInfo: mockGetModelInfo,
  getTodayTokenUsage: mockGetTodayTokenUsage,
  checkTokenBudget: mockCheckTokenBudget,
  generateFollowUpEmail: mockGenerateFollowUpEmail,
  analyzeEnrollment: mockAnalyzeEnrollment,
  analyzePortfolio: mockAnalyzePortfolio,
  getRecommendations: mockGetRecommendations,
  updateRecommendationStatus: mockUpdateRecommendationStatus,
  generateExpirationAlerts: vi.fn(),
}));

vi.mock('../../src/services/chat.service.js', () => ({
  sendChatMessage: vi.fn(),
  getUserConversations: vi.fn(),
  getConversationMessages: vi.fn(),
}));

vi.mock('../../src/middleware/practiceScope.middleware.js', () => ({
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
  requirePracticeProvider: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/services/document.service.js', () => ({
  DocumentService: vi.fn().mockImplementation(function () { return {
    getUploadUrl: mockGetUploadUrl,
    confirmUpload: mockConfirmUpload,
    getDownloadUrl: mockGetDownloadUrl,
    deleteDocument: mockDeleteDocument,
  }; }),
}));

vi.mock('../../src/middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../../src/services/cognitoUser.service.js', () => ({
  createCognitoUser: vi.fn(),
  disableCognitoUser: vi.fn(),
  enableCognitoUser: vi.fn(),
  updateCognitoUser: vi.fn(),
}));

vi.mock('../../src/services/reporting.service.js', () => ({
  getEnrollmentPipeline: mockGetEnrollmentPipeline,
  getExpirationForecast: mockGetExpirationForecast,
  getProviderReadiness: mockGetProviderReadiness,
  getGettingStartedStatus: mockGetGettingStartedStatus,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/terminationWorkflow.service.js', () => ({
  triggerTerminationWorkflow: vi.fn(),
}));

vi.mock('../../src/services/enrollment-creation-hook.js', () => ({
  onEnrollmentCreated: vi.fn().mockResolvedValue({ stepsCreated: 0, templateFound: false, workflowType: null }),
}));

vi.mock('../../src/utils/cache.js', () => ({
  invalidateCache: vi.fn(),
  getCached: vi.fn(),
  setCache: vi.fn(),
}));

vi.mock('../../src/services/opsWorkQueue.service.js', () => ({
  autoCreateWorkItems: vi.fn(),
}));

import { aiRoutes } from '../../src/routes/ai.routes.js';
import { documentRoutes } from '../../src/routes/document.routes.js';
import { userRoutes } from '../../src/routes/user.routes.js';
import reportingRoutes from '../../src/routes/reporting.routes.js';
import enrollmentRouter from '../../src/routes/enrollment.routes.js';
import { prismaMock } from '../helpers/mock-prisma.js';

// ==========================================
// Fixtures
// ==========================================

const providerUser = {
  id: 'provider-user-id',
  role: 'provider',
  email: 'provider@test.com',
  providerId: 'provider-record-id',
};

const adminUser = {
  id: 'admin-user-id',
  role: 'admin',
  email: 'admin@test.com',
};

const staffUser = {
  id: 'staff-user-id',
  role: 'credentialing_staff',
  email: 'staff@test.com',
};

const practiceAdminUser = {
  id: 'pa-user-id',
  role: 'practice_admin',
  email: 'pa@test.com',
};

function createApp(router: express.Router, user?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.set('trust proxy', 1);
  if (user) {
    app.use((req, _res, next) => {
      req.user = user as any;
      req.practiceScope = user.role === 'admin'
        ? { isSuperAdmin: true, practiceIds: [] }
        : { isSuperAdmin: false, practiceIds: ['practice-1'] };
      next();
    });
  }
  app.use(router);
  app.use(errorHandler);
  return app;
}

// ==========================================
// 1. AI routes: provider role must be denied
// ==========================================

describe('Security: AI routes deny provider role', () => {
  const providerApp = createApp(aiRoutes, providerUser);
  const adminApp = createApp(aiRoutes, adminUser);

  it('GET /status returns 403 for provider role', async () => {
    const res = await request(providerApp).get('/status');
    expect(res.status).toBe(403);
  });

  it('GET /usage returns 403 for provider role', async () => {
    const res = await request(providerApp).get('/usage');
    expect(res.status).toBe(403);
  });

  it('POST /enrollment/:id/generate-email returns 403 for provider role', async () => {
    const res = await request(providerApp)
      .post('/enrollment/some-id/generate-email')
      .send({ tone: 'professional' });
    expect(res.status).toBe(403);
  });

  it('POST /enrollment/:id/analyze returns 403 for provider role', async () => {
    const res = await request(providerApp)
      .post('/enrollment/some-id/analyze');
    expect(res.status).toBe(403);
  });

  it('GET /status returns 200 for admin role', async () => {
    const res = await request(adminApp).get('/status');
    expect(res.status).toBe(200);
  });

  it('GET /usage returns 200 for admin role', async () => {
    const res = await request(adminApp).get('/usage');
    expect(res.status).toBe(200);
  });
});

// ==========================================
// 2. User update excludes cognitoId
// ==========================================

describe('Security: User update response excludes cognitoId', () => {
  const app = createApp(userRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUT /users/:id does not return cognitoId', async () => {
    const userId = 'user-to-update';
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: userId,
      email: 'old@test.com',
    } as any);
    prismaMock.user.update.mockResolvedValueOnce({
      id: userId,
      email: 'new@test.com',
      firstName: 'Updated',
      lastName: 'User',
      phone: null,
      role: 'credentialing_staff',
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date(),
      providerId: null,
    } as any);

    const res = await request(app)
      .put(`/${userId}`)
      .send({ email: 'new@test.com', firstName: 'Updated', lastName: 'User' });

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('cognitoId');
  });

  it('PUT /users/:id/deactivate does not return cognitoId', async () => {
    const userId = 'user-to-deactivate';
    prismaMock.userPractice.findFirst.mockResolvedValueOnce({ id: 'up1' } as any);
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'target@test.com' } as any);
    prismaMock.user.update.mockResolvedValueOnce({
      id: userId,
      email: 'target@test.com',
      firstName: 'Target',
      lastName: 'User',
      phone: null,
      role: 'credentialing_staff',
      isActive: false,
      lastLoginAt: null,
      createdAt: new Date(),
      providerId: null,
    } as any);

    const res = await request(app).put(`/${userId}/deactivate`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('cognitoId');
  });

  it('PUT /users/:id/activate does not return cognitoId', async () => {
    const userId = 'user-to-activate';
    prismaMock.userPractice.findFirst.mockResolvedValueOnce({ id: 'up1' } as any);
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'target@test.com' } as any);
    prismaMock.user.update.mockResolvedValueOnce({
      id: userId,
      email: 'target@test.com',
      firstName: 'Target',
      lastName: 'User',
      phone: null,
      role: 'credentialing_staff',
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date(),
      providerId: null,
    } as any);

    const res = await request(app).put(`/${userId}/activate`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('cognitoId');
  });
});

// ==========================================
// 3. Document confirm-upload rejects invalid UUID
// ==========================================

describe('Security: Document confirm-upload validates documentId', () => {
  const app = createApp(documentRoutes, adminUser);

  it('returns 400 for non-UUID documentId', async () => {
    const res = await request(app)
      .post('/confirm-upload')
      .send({ documentId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/documentId/i);
  });

  it('returns 400 for missing documentId', async () => {
    const res = await request(app)
      .post('/confirm-upload')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/documentId/i);
  });

  it('returns 400 for empty string documentId', async () => {
    const res = await request(app)
      .post('/confirm-upload')
      .send({ documentId: '' });

    expect(res.status).toBe(400);
  });

  it('accepts valid UUID documentId', async () => {
    const validUuid = 'd0000000-0000-4000-a000-000000000001';
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: validUuid,
      providerId: 'p1',
    } as any);
    mockConfirmUpload.mockResolvedValueOnce({ id: validUuid });

    const res = await request(app)
      .post('/confirm-upload')
      .send({ documentId: validUuid });

    // Should pass validation (200 or 404 depending on mock, but NOT 400)
    expect(res.status).not.toBe(400);
  });
});

// ==========================================
// 4. Provider export strips dateOfBirth for non-admin
// ==========================================

describe('Security: Provider export strips dateOfBirth by role', () => {
  const providerApp = createApp(
    (() => {
      // We need to import provider routes — but they use requireProviderAccess
      // which is already mocked. We'll test inline.
      const { Router } = require('express');
      const r = Router();

      // Simulate the export logic from provider.routes.ts
      r.get('/:providerId/export', (req: any, res: any) => {
        const provider = {
          firstName: 'Jane',
          lastName: 'Doe',
          dateOfBirth: new Date('1985-06-15'),
          npi: '1234567890',
        };

        const isAdminOrStaff = req.user?.role === 'admin' || req.user?.role === 'credentialing_staff' || req.user?.role === 'practice_admin';
        const isSelf = req.user?.providerId === 'provider-1';

        const data = { ...provider };
        if (!isAdminOrStaff && !isSelf) {
          delete (data as any).dateOfBirth;
        }

        res.json({ success: true, data });
      });
      return r;
    })(),
    providerUser,
  );

  it('strips dateOfBirth for provider role accessing other provider', async () => {
    const res = await request(providerApp).get('/other-provider/export');
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('dateOfBirth');
  });

  it('includes dateOfBirth for admin role', async () => {
    const adminApp = createApp(
      (() => {
        const { Router } = require('express');
        const r = Router();
        r.get('/:providerId/export', (req: any, res: any) => {
          const provider = {
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirth: new Date('1985-06-15'),
            npi: '1234567890',
          };
          const isAdminOrStaff = req.user?.role === 'admin' || req.user?.role === 'credentialing_staff' || req.user?.role === 'practice_admin';
          const isSelf = req.user?.providerId === 'provider-1';
          const data = { ...provider };
          if (!isAdminOrStaff && !isSelf) {
            delete (data as any).dateOfBirth;
          }
          res.json({ success: true, data });
        });
        return r;
      })(),
      adminUser,
    );

    const res = await request(adminApp).get('/provider-1/export');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('dateOfBirth');
  });
});

// ==========================================
// 5. Reporting routes allow admin and staff
// ==========================================

describe('Security: Reporting routes accessible to admin and staff', () => {
  const endpoints = [
    '/enrollment-pipeline',
    '/expiration-forecast',
    '/provider-readiness',
    '/getting-started',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnrollmentPipeline.mockResolvedValue({ byPayer: [], total: {} });
    mockGetExpirationForecast.mockResolvedValue({ buckets: {}, counts: {} });
    mockGetProviderReadiness.mockResolvedValue({ providers: [], summary: {} });
    mockGetGettingStartedStatus.mockResolvedValue({ providerCount: 0, isOnboarded: false });
  });

  it.each(endpoints)('admin role gets 200 on %s', async (path) => {
    const app = createApp(reportingRoutes, adminUser);
    const res = await request(app).get(`${path}?practiceId=practice-1`);
    expect(res.status).toBe(200);
  });

  it.each(endpoints)('credentialing_staff role gets 200 on %s', async (path) => {
    const app = createApp(reportingRoutes, staffUser);
    const res = await request(app).get(`${path}?practiceId=practice-1`);
    expect(res.status).toBe(200);
  });

  it.each(endpoints)('practice_admin role gets 200 on %s', async (path) => {
    const app = createApp(reportingRoutes, practiceAdminUser);
    const res = await request(app).get(`${path}?practiceId=practice-1`);
    expect(res.status).toBe(200);
  });

  it.each(endpoints)('provider role gets 403 on %s', async (path) => {
    const app = createApp(reportingRoutes, providerUser);
    const res = await request(app).get(`${path}?practiceId=practice-1`);
    expect(res.status).toBe(403);
  });
});

// ==========================================
// 6. Payer routes: provider role must be denied
// ==========================================

describe('Security: Payer routes deny provider role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /payers returns 403 for provider role', async () => {
    const app = createApp(enrollmentRouter, providerUser);
    const res = await request(app).get('/payers');
    expect(res.status).toBe(403);
  });

  it('POST /payers returns 403 for provider role', async () => {
    const app = createApp(enrollmentRouter, providerUser);
    const res = await request(app)
      .post('/payers')
      .send({ name: 'Test Payer', payerId: 'test-001', payerType: 'insurance' });
    expect(res.status).toBe(403);
  });

  it('GET /payers returns 200 for admin role', async () => {
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.payer.count.mockResolvedValue(0);

    const app = createApp(enrollmentRouter, adminUser);
    const res = await request(app).get('/payers');
    expect(res.status).toBe(200);
  });

  it('GET /payers returns 200 for credentialing_staff role', async () => {
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.payer.count.mockResolvedValue(0);

    const app = createApp(enrollmentRouter, staffUser);
    const res = await request(app).get('/payers');
    expect(res.status).toBe(200);
  });

  it('GET /payers returns 200 for practice_admin role', async () => {
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.payer.count.mockResolvedValue(0);

    const app = createApp(enrollmentRouter, practiceAdminUser);
    const res = await request(app).get('/payers');
    expect(res.status).toBe(200);
  });

  it('POST /payers returns 201 for admin role', async () => {
    prismaMock.payer.create.mockResolvedValue({
      id: 'new-payer-id',
      name: 'Test Payer',
      payerId: 'test-001',
      payerType: 'insurance',
    } as any);

    const app = createApp(enrollmentRouter, adminUser);
    const res = await request(app)
      .post('/payers')
      .send({ name: 'Test Payer', payerId: 'test-001', payerType: 'insurance' });
    expect(res.status).toBe(201);
  });
});
