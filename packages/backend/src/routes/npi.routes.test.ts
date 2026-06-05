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
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

const { mockLookupByNPI, mockSearchByName } = vi.hoisted(() => ({
  mockLookupByNPI: vi.fn(),
  mockSearchByName: vi.fn(),
}));

vi.mock('../services/npi.service.js', () => ({
  NPIService: vi.fn().mockImplementation(function () { return {
    lookupByNPI: mockLookupByNPI,
    searchByName: mockSearchByName,
  }; }),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { npiRoutes } from './npi.routes.js';

describe('NPI Routes', () => {
  const app = createTestApp(npiRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /lookup/:npiNumber', () => {
    it('returns provider data for valid NPI', async () => {
      const mockResult = { npi: '1234567890', name: 'Dr. Smith', taxonomy: 'Internal Medicine' };
      mockLookupByNPI.mockResolvedValue(mockResult);

      const res = await request(app).get('/lookup/1234567890');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.npi).toBe('1234567890');
    });

    it('returns 400 for invalid NPI format (too short)', async () => {
      const res = await request(app).get('/lookup/12345');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('10 digits');
    });

    it('returns 400 for NPI with letters', async () => {
      const res = await request(app).get('/lookup/123456789a');

      expect(res.status).toBe(400);
    });

    it('returns 400 for NPI with too many digits', async () => {
      const res = await request(app).get('/lookup/12345678901');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /search', () => {
    it('returns search results with name params', async () => {
      const mockResults = [{ npi: '1234567890', name: 'Dr. Smith' }];
      mockSearchByName.mockResolvedValue(mockResults);

      const res = await request(app).get('/search?lastName=Smith');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns 400 when no name params provided', async () => {
      const res = await request(app).get('/search');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('passes all search params to service', async () => {
      mockSearchByName.mockResolvedValue([]);

      await request(app).get('/search?firstName=John&lastName=Smith&state=CA&city=LA');

      expect(mockSearchByName).toHaveBeenCalledWith('John', 'Smith', 'CA', 'LA');
    });
  });
});
