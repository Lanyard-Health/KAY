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

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock('../../src/utils/prisma.js', () => ({
  prisma: {
    provider: {
      findUnique: mockFindUnique,
    },
  },
}));

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
  requireProviderAccess: (req: any, _res: any, next: any) => {
    if (!req.user) return next(new UnauthorizedError('Not authenticated'));
    next();
  },
}));

vi.mock('../../src/middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: (_req: any, _res: any, next: any) => next(),
  getPracticeProviderFilter: () => ({}),
}));

vi.mock('../../src/middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../../src/utils/cache.js', () => ({
  invalidateCache: vi.fn(),
}));

vi.mock('../../src/utils/queryValidation.js', () => ({
  providerListQuerySchema: {},
  parseQuery: (_query: any, _schema: any) => ({
    page: 1,
    pageSize: 20,
    search: undefined,
    status: undefined,
  }),
}));

vi.mock('@credential-management/shared', () => ({
  createProviderSchema: { parse: (d: any) => d },
  updateProviderSchema: { parse: (d: any) => d },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { providerRoutes } from '../../src/routes/provider.routes.js';

// ==========================================
// Fixtures
// ==========================================

const PROVIDER_ID = 'provider-1-id';

const fullProvider = {
  id: PROVIDER_ID,
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  middleName: null,
  suffix: null,
  dateOfBirth: new Date('1985-06-15'),
  gender: 'female',
  email: 'jane.doe@example.com',
  phone: '(555) 123-4567',
  providerType: 'psychiatrist',
  taxonomy: null,
  specialties: [],
  languages: [],
  status: 'active',
  practiceId: 'practice-1-id',
  // Sensitive fields that must NEVER be returned
  ssnEncrypted: 'encrypted-ssn-value',
  caqhPassword: 'secret-caqh-pass',
  caqhUsername: 'secret-caqh-user',
  // Relations
  addresses: [],
  practiceLocations: [],
  licenses: [],
  boardCertifications: [],
  malpracticeInsurances: [],
  educations: [],
  workHistories: [],
  hospitalAffiliations: [],
  professionalReferences: [],
  disciplinaryActions: [],
  continuingEducations: [],
  documents: [],
  practice: { id: 'practice-1-id', name: 'Test Practice', status: 'active' },
  createdAt: new Date(),
  updatedAt: new Date(),
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

const providerUserSelf = {
  id: 'provider-user-id',
  role: 'provider',
  email: 'provider@test.com',
  providerId: PROVIDER_ID, // same as the provider being fetched
};

const providerUserOther = {
  id: 'other-provider-user-id',
  role: 'provider',
  email: 'other@test.com',
  providerId: 'different-provider-id', // NOT the provider being fetched
};

// ==========================================
// Helpers
// ==========================================

function createApp(user?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => {
      req.user = user as any;
      next();
    });
  }
  app.use('/providers', providerRoutes);
  app.use(errorHandler);
  return app;
}

// ==========================================
// Tests
// ==========================================

describe('Provider Routes — GET /:providerId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Return a fresh deep copy each time so mutations don't bleed between tests
    mockFindUnique.mockImplementation(() =>
      Promise.resolve(JSON.parse(JSON.stringify(fullProvider, (_k, v) =>
        v instanceof Date ? v : v,
      ))),
    );
  });

  // ------------------------------------------
  // Sensitive fields stripped for ALL roles
  // ------------------------------------------

  describe('Sensitive field stripping', () => {
    it.each([
      ['admin', adminUser],
      ['credentialing_staff', staffUser],
      ['practice_admin', practiceAdminUser],
      ['provider (self)', providerUserSelf],
      ['provider (other)', providerUserOther],
    ])(
      'never returns ssnEncrypted, caqhPassword, or caqhUsername for %s',
      async (_roleName, user) => {
        const app = createApp(user);
        const res = await request(app).get(`/providers/${PROVIDER_ID}`);

        expect(res.status).toBe(200);
        expect(res.body.data).not.toHaveProperty('ssnEncrypted');
        expect(res.body.data).not.toHaveProperty('caqhPassword');
        expect(res.body.data).not.toHaveProperty('caqhUsername');
      },
    );
  });

  // ------------------------------------------
  // dateOfBirth visibility by role
  // ------------------------------------------

  describe('dateOfBirth visibility', () => {
    it('admin sees dateOfBirth', async () => {
      const app = createApp(adminUser);
      const res = await request(app).get(`/providers/${PROVIDER_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('dateOfBirth');
      expect(res.body.data.dateOfBirth).toBeTruthy();
    });

    it('credentialing_staff sees dateOfBirth', async () => {
      const app = createApp(staffUser);
      const res = await request(app).get(`/providers/${PROVIDER_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('dateOfBirth');
      expect(res.body.data.dateOfBirth).toBeTruthy();
    });

    it('practice_admin sees dateOfBirth', async () => {
      const app = createApp(practiceAdminUser);
      const res = await request(app).get(`/providers/${PROVIDER_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('dateOfBirth');
      expect(res.body.data.dateOfBirth).toBeTruthy();
    });

    it('provider viewing their own record sees dateOfBirth', async () => {
      const app = createApp(providerUserSelf);
      const res = await request(app).get(`/providers/${PROVIDER_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('dateOfBirth');
      expect(res.body.data.dateOfBirth).toBeTruthy();
    });

    it('provider viewing another provider does NOT see dateOfBirth', async () => {
      const app = createApp(providerUserOther);
      const res = await request(app).get(`/providers/${PROVIDER_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('dateOfBirth');
    });
  });

  // ------------------------------------------
  // 404 when provider not found
  // ------------------------------------------

  describe('Not found', () => {
    it('returns 404 when provider does not exist', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      const app = createApp(adminUser);
      const res = await request(app).get(`/providers/nonexistent-id`);

      expect(res.status).toBe(404);
    });
  });
});
