import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app.js';
import { adminUser, providerUser, staffUser } from '../helpers/fixtures.js';

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../../src/utils/cache.js', () => ({
  getCached: vi.fn().mockReturnValue(null),
  setCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/middleware/auth.middleware.js', async () => {
  const { UnauthorizedError, ForbiddenError } = await import('../../src/middleware/error.middleware.js');
  return {
    authenticate: (req: any, _res: any, next: any) => {
      if (!req.user) {
        return next(new UnauthorizedError('Not authenticated'));
      }
      next();
    },
    authorize: (...allowedRoles: string[]) => (req: any, _res: any, next: any) => {
      if (!req.user) {
        return next(new UnauthorizedError('Not authenticated'));
      }
      if (!allowedRoles.includes(req.user.role)) {
        return next(new ForbiddenError('Insufficient permissions'));
      }
      next();
    },
  };
});

vi.mock('../../src/middleware/practiceScope.middleware.js', () => ({
  getPracticeProviderFilter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/services/command-center.service.js', () => ({
  getEnrollmentMatrix: vi.fn(),
}));

import commandCenterRouter from '../../src/routes/command-center.routes.js';
import { getEnrollmentMatrix } from '../../src/services/command-center.service.js';

const mockGetMatrix = getEnrollmentMatrix as ReturnType<typeof vi.fn>;

describe('GET /matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no user is authenticated', async () => {
    const app = createTestApp(commandCenterRouter);
    const res = await request(app).get('/matrix');
    expect(res.status).toBe(401);
  });

  it('returns 403 for provider role', async () => {
    const app = createTestApp(commandCenterRouter, providerUser);
    const res = await request(app).get('/matrix');
    expect(res.status).toBe(403);
  });

  it('returns matrix data for admin user', async () => {
    const mockMatrix = {
      payers: [{ id: 'pay1', name: 'Blue Cross', payerId: 'bcbs-001' }],
      rows: [
        {
          provider: { id: 'p1', firstName: 'Jane', lastName: 'Doe', npi: '111', status: 'active' },
          enrollments: {
            pay1: {
              enrollmentId: 'e1',
              status: 'in_progress',
              applicationDate: null,
              effectiveDate: null,
              lastFollowUpDate: null,
              daysSinceUpdate: 5,
            },
          },
        },
      ],
      totals: { total: 1, byStatus: { in_progress: 1 } },
    };

    mockGetMatrix.mockResolvedValue(mockMatrix);

    const app = createTestApp(commandCenterRouter, adminUser);
    const res = await request(app).get('/matrix');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: mockMatrix });
    expect(mockGetMatrix).toHaveBeenCalledOnce();
  });

  it('returns matrix data for staff user', async () => {
    const mockMatrix = { payers: [], rows: [], totals: { total: 0, byStatus: {} } };
    mockGetMatrix.mockResolvedValue(mockMatrix);

    const app = createTestApp(commandCenterRouter, staffUser);
    const res = await request(app).get('/matrix');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: mockMatrix });
  });
});
