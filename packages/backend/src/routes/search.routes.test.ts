import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((..._roles: string[]) => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../utils/cache.js', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
}));

vi.mock('../services/search.service.js', () => ({
  globalSearch: vi.fn(),
}));

import searchRouter from './search.routes.js';
import { globalSearch } from '../services/search.service.js';
import { getCached } from '../utils/cache.js';

describe('Search Routes', () => {
  const app = createTestApp(searchRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns empty array for query shorter than 2 chars', async () => {
      const res = await request(app).get('/?q=a');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(globalSearch).not.toHaveBeenCalled();
    });

    it('returns empty array for missing query', async () => {
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns search results', async () => {
      const mockResults = [
        { type: 'provider', id: 'p1', label: 'Dr. Smith', url: '/providers/p1' },
      ];
      vi.mocked(globalSearch).mockResolvedValue(mockResults);

      const res = await request(app).get('/?q=smith');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockResults);
    });

    it('returns cached results when available', async () => {
      const cachedResults = [{ type: 'provider', id: 'p1' }];
      vi.mocked(getCached).mockReturnValueOnce(cachedResults);

      const res = await request(app).get('/?q=smith');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(cachedResults);
      expect(globalSearch).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      vi.mocked(globalSearch).mockRejectedValue(new Error('Search failed'));

      const res = await request(app).get('/?q=test');

      expect(res.status).toBe(500);
    });
  });
});
