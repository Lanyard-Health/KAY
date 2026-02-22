import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app.js';
import { adminUser } from '../helpers/fixtures.js';

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
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
  const { UnauthorizedError } = await import('../../src/middleware/error.middleware.js');
  return {
    authenticate: (req: any, _res: any, next: any) => {
      if (!req.user) {
        return next(new UnauthorizedError('Not authenticated'));
      }
      next();
    },
    authorize: (..._roles: string[]) => (req: any, _res: any, next: any) => {
      next();
    },
  };
});

vi.mock('../../src/middleware/practiceScope.middleware.js', () => ({
  getPracticeProviderFilter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/services/search.service.js', () => ({
  globalSearch: vi.fn(),
}));

import searchRouter from '../../src/routes/search.routes.js';
import { globalSearch } from '../../src/services/search.service.js';

const mockGlobalSearch = globalSearch as ReturnType<typeof vi.fn>;

describe('GET /search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no user is authenticated', async () => {
    const app = createTestApp(searchRouter);
    const res = await request(app).get('/?q=test');
    expect(res.status).toBe(401);
  });

  it('returns empty array for query shorter than 2 characters', async () => {
    const app = createTestApp(searchRouter, adminUser);
    const res = await request(app).get('/?q=a');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(mockGlobalSearch).not.toHaveBeenCalled();
  });

  it('returns empty array when no q param', async () => {
    const app = createTestApp(searchRouter, adminUser);
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('returns search results for valid query', async () => {
    const mockResults = [
      {
        id: 'p1',
        type: 'provider',
        title: 'Jane Doe',
        subtitle: 'NPI: 1234567890',
        url: '/providers/p1',
      },
    ];

    mockGlobalSearch.mockResolvedValue(mockResults);

    const app = createTestApp(searchRouter, adminUser);
    const res = await request(app).get('/?q=test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: mockResults });
    expect(mockGlobalSearch).toHaveBeenCalledOnce();
  });
});
