import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  errorHandler,
  UnauthorizedError,
  ForbiddenError,
} from '../../src/middleware/error.middleware.js';

// ==========================================
// Hoisted mocks
// ==========================================

const {
  mockGetEnrollmentPipeline,
  mockGetExpirationForecast,
  mockGetProviderReadiness,
  mockGetGettingStartedStatus,
} = vi.hoisted(() => ({
  mockGetEnrollmentPipeline: vi.fn(),
  mockGetExpirationForecast: vi.fn(),
  mockGetProviderReadiness: vi.fn(),
  mockGetGettingStartedStatus: vi.fn(),
}));

vi.mock('../../src/services/reporting.service.js', () => ({
  getEnrollmentPipeline: mockGetEnrollmentPipeline,
  getExpirationForecast: mockGetExpirationForecast,
  getProviderReadiness: mockGetProviderReadiness,
  getGettingStartedStatus: mockGetGettingStartedStatus,
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
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import reportingRoutes from '../../src/routes/reporting.routes.js';
import { logger } from '../../src/utils/logger.js';

// ==========================================
// Fixtures
// ==========================================

const PRACTICE_ID = 'practice-1-id';
const OTHER_PRACTICE_ID = 'practice-other-id';

const practiceAdminUser = {
  id: 'pa-user-id',
  role: 'practice_admin',
  email: 'admin@practice.com',
};

const staffUser = {
  id: 'staff-user-id',
  role: 'credentialing_staff',
  email: 'staff@test.com',
};

const enrollmentPipelineResult = {
  byPayer: [
    {
      payerName: 'Aetna',
      payerId: 'aetna-001',
      statuses: { approved: 2, submitted: 1 },
    },
  ],
  total: { approved: 2, submitted: 1 },
};

const expirationForecastResult = {
  buckets: {
    critical: [
      {
        providerId: 'p1',
        providerName: 'Jane Doe',
        credentialType: 'license',
        credentialName: 'State Medical - MD-12345',
        expirationDate: '2025-03-01T00:00:00.000Z',
        daysRemaining: 15,
      },
    ],
    warning: [],
    upcoming: [],
  },
  counts: { critical: 1, warning: 0, upcoming: 0 },
};

const providerReadinessResult = {
  providers: [
    {
      providerId: 'p1',
      providerName: 'Jane Doe',
      hasActiveLicense: true,
      hasMalpractice: true,
      hasActiveEnrollment: false,
      readinessScore: 2,
    },
  ],
  summary: { fullyReady: 0, partiallyReady: 1, notReady: 0 },
};

const gettingStartedResult = {
  providerCount: 3,
  documentCount: 5,
  enrollmentCount: 2,
  isOnboarded: true,
};

// ==========================================
// Helpers
// ==========================================

interface AppOptions {
  user?: Record<string, unknown>;
  practiceIds?: string[];
}

function createApp(options: AppOptions = {}) {
  const app = express();
  app.use(express.json());
  if (options.user) {
    app.use((req, _res, next) => {
      req.user = options.user as any;
      req.practiceScope = {
        isSuperAdmin: options.user!.role === 'admin',
        practiceIds: options.practiceIds ?? [],
      } as any;
      next();
    });
  }
  app.use(reportingRoutes);
  app.use(errorHandler);
  return app;
}

const ALL_ENDPOINTS = [
  '/enrollment-pipeline',
  '/expiration-forecast',
  '/provider-readiness',
  '/getting-started',
];

// ==========================================
// Tests
// ==========================================

describe('Reporting Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnrollmentPipeline.mockResolvedValue(enrollmentPipelineResult);
    mockGetExpirationForecast.mockResolvedValue(expirationForecastResult);
    mockGetProviderReadiness.mockResolvedValue(providerReadinessResult);
    mockGetGettingStartedStatus.mockResolvedValue(gettingStartedResult);
  });

  // ==========================================
  // Authorization (all endpoints)
  // ==========================================

  describe('Authorization', () => {
    it.each(ALL_ENDPOINTS)(
      'practice_admin requesting own practice → 200 on %s',
      async (path) => {
        const app = createApp({
          user: practiceAdminUser,
          practiceIds: [PRACTICE_ID],
        });
        const res = await request(app).get(
          `${path}?practiceId=${PRACTICE_ID}`,
        );
        expect(res.status).toBe(200);
      },
    );

    it.each(ALL_ENDPOINTS)(
      'practice_admin requesting different practice → 403 on %s',
      async (path) => {
        const app = createApp({
          user: practiceAdminUser,
          practiceIds: [PRACTICE_ID],
        });
        const res = await request(app).get(
          `${path}?practiceId=${OTHER_PRACTICE_ID}`,
        );
        expect(res.status).toBe(403);
      },
    );

    it.each(ALL_ENDPOINTS)(
      'credentialing_staff role → 200 on %s',
      async (path) => {
        const app = createApp({
          user: staffUser,
          practiceIds: [PRACTICE_ID],
        });
        const res = await request(app).get(
          `${path}?practiceId=${PRACTICE_ID}`,
        );
        expect(res.status).toBe(200);
      },
    );

    it.each(ALL_ENDPOINTS)('no auth → 401 on %s', async (path) => {
      const app = createApp(); // no user injected
      const res = await request(app).get(
        `${path}?practiceId=${PRACTICE_ID}`,
      );
      expect(res.status).toBe(401);
    });

    it('super admin can access any practice', async () => {
      const adminUser = {
        id: 'admin-id',
        role: 'admin',
        email: 'admin@sys.com',
      };
      // admin role is now authorized — super admin bypasses verifyPracticeAccess
      const app = createApp({ user: adminUser, practiceIds: [] });
      const res = await request(app).get(
        `/enrollment-pipeline?practiceId=${OTHER_PRACTICE_ID}`,
      );
      expect(res.status).toBe(200);
    });
  });

  // ==========================================
  // Validation: practiceId required
  // ==========================================

  describe('Validation: practiceId required', () => {
    it.each(ALL_ENDPOINTS)(
      'returns 400 when practiceId is missing on %s',
      async (path) => {
        const app = createApp({
          user: practiceAdminUser,
          practiceIds: [PRACTICE_ID],
        });
        const res = await request(app).get(path);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      },
    );
  });

  // ==========================================
  // GET /enrollment-pipeline
  // ==========================================

  describe('GET /enrollment-pipeline', () => {
    it('returns 200 with byPayer array, total object, and Cache-Control header', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/enrollment-pipeline?practiceId=${PRACTICE_ID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.byPayer)).toBe(true);
      expect(res.body.data.byPayer[0].payerName).toBe('Aetna');
      expect(res.body.data.total).toEqual({ approved: 2, submitted: 1 });
      expect(res.headers['cache-control']).toBe('max-age=300');
    });

    it('passes date params to service as Date objects', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/enrollment-pipeline?practiceId=${PRACTICE_ID}&startDate=2024-01-01&endDate=2024-12-31`,
      );

      expect(res.status).toBe(200);
      expect(mockGetEnrollmentPipeline).toHaveBeenCalledWith(
        PRACTICE_ID,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
      );
    });

    it('returns 400 for invalid startDate format', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/enrollment-pipeline?practiceId=${PRACTICE_ID}&startDate=not-a-date`,
      );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid endDate format', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/enrollment-pipeline?practiceId=${PRACTICE_ID}&endDate=xyz`,
      );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // GET /expiration-forecast
  // ==========================================

  describe('GET /expiration-forecast', () => {
    it('returns 200 with buckets, counts, Cache-Control header, and defaults to 90 days', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/expiration-forecast?practiceId=${PRACTICE_ID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.buckets).toHaveProperty('critical');
      expect(res.body.data.buckets).toHaveProperty('warning');
      expect(res.body.data.buckets).toHaveProperty('upcoming');
      expect(res.body.data.counts).toEqual({
        critical: 1,
        warning: 0,
        upcoming: 0,
      });
      expect(res.headers['cache-control']).toBe('max-age=300');
      expect(mockGetExpirationForecast).toHaveBeenCalledWith(
        PRACTICE_ID,
        90,
      );
    });

    it('accepts custom days parameter', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/expiration-forecast?practiceId=${PRACTICE_ID}&days=30`,
      );

      expect(res.status).toBe(200);
      expect(mockGetExpirationForecast).toHaveBeenCalledWith(
        PRACTICE_ID,
        30,
      );
    });

    it('returns 400 for days=0', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/expiration-forecast?practiceId=${PRACTICE_ID}&days=0`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for negative days', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/expiration-forecast?practiceId=${PRACTICE_ID}&days=-5`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for days > 365', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/expiration-forecast?practiceId=${PRACTICE_ID}&days=400`,
      );
      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // GET /provider-readiness
  // ==========================================

  describe('GET /provider-readiness', () => {
    it('returns 200 with providers array, summary, and Cache-Control header', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/provider-readiness?practiceId=${PRACTICE_ID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.providers)).toBe(true);
      expect(res.body.data.providers[0].providerName).toBe('Jane Doe');
      expect(res.body.data.providers[0].readinessScore).toBe(2);
      expect(res.body.data.summary).toEqual({
        fullyReady: 0,
        partiallyReady: 1,
        notReady: 0,
      });
      expect(res.headers['cache-control']).toBe('max-age=300');
    });
  });

  // ==========================================
  // GET /getting-started
  // ==========================================

  describe('GET /getting-started', () => {
    it('returns 200 with providerCount, documentCount, enrollmentCount, isOnboarded, and Cache-Control header', async () => {
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/getting-started?practiceId=${PRACTICE_ID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        providerCount: 3,
        documentCount: 5,
        enrollmentCount: 2,
        isOnboarded: true,
      });
      expect(res.headers['cache-control']).toBe('max-age=300');
    });
  });

  // ==========================================
  // Error handling
  // ==========================================

  describe('Error handling', () => {
    it('returns 500 with generic message when service throws', async () => {
      mockGetEnrollmentPipeline.mockRejectedValueOnce(
        new Error('DB connection failed'),
      );
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/enrollment-pipeline?practiceId=${PRACTICE_ID}`,
      );

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: { message: 'Failed to load report data' },
      });
    });

    it('does not leak database error details to client', async () => {
      mockGetProviderReadiness.mockRejectedValueOnce(
        new Error(
          'PrismaClientKnownRequestError: Invalid `prisma.providerProfile.findMany()` invocation',
        ),
      );
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });
      const res = await request(app).get(
        `/provider-readiness?practiceId=${PRACTICE_ID}`,
      );

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Failed to load report data');
      expect(JSON.stringify(res.body)).not.toContain('Prisma');
    });

    it('logs the actual error server-side with reporting_query_error event', async () => {
      const dbError = new Error('Query timeout');
      mockGetExpirationForecast.mockRejectedValueOnce(dbError);
      const app = createApp({
        user: practiceAdminUser,
        practiceIds: [PRACTICE_ID],
      });

      await request(app).get(
        `/expiration-forecast?practiceId=${PRACTICE_ID}`,
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'reporting_query_error',
          endpoint: 'expiration-forecast',
          practiceId: PRACTICE_ID,
          error: dbError,
        }),
      );
    });
  });
});
