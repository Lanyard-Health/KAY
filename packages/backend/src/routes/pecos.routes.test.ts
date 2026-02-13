import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

const {
  mockLookupByNPI,
  mockIsEnrolledInMedicare,
  mockGetEnrollmentStates,
  mockGetSpecialties,
  mockBatchLookup,
} = vi.hoisted(() => ({
  mockLookupByNPI: vi.fn(),
  mockIsEnrolledInMedicare: vi.fn(),
  mockGetEnrollmentStates: vi.fn(),
  mockGetSpecialties: vi.fn(),
  mockBatchLookup: vi.fn(),
}));

vi.mock('../services/pecos.service.js', () => ({
  PECOSService: vi.fn().mockImplementation(function () { return {
    lookupByNPI: mockLookupByNPI,
    isEnrolledInMedicare: mockIsEnrolledInMedicare,
    getEnrollmentStates: mockGetEnrollmentStates,
    getSpecialties: mockGetSpecialties,
    batchLookup: mockBatchLookup,
  }; }),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { pecosRoutes } from './pecos.routes.js';

describe('PECOS Routes', () => {
  const app = createTestApp(pecosRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /lookup/:npiNumber', () => {
    it('returns PECOS data for valid NPI', async () => {
      mockLookupByNPI.mockResolvedValue({ npi: '1234567890', enrolled: true });

      const res = await request(app).get('/lookup/1234567890');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid NPI', async () => {
      const res = await request(app).get('/lookup/123');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('10 digits');
    });
  });

  describe('GET /enrolled/:npiNumber', () => {
    it('returns enrollment status for valid NPI', async () => {
      mockIsEnrolledInMedicare.mockResolvedValue(true);

      const res = await request(app).get('/enrolled/1234567890');

      expect(res.status).toBe(200);
      expect(res.body.data.enrolled).toBe(true);
      expect(res.body.data.npi).toBe('1234567890');
    });

    it('returns 400 for invalid NPI', async () => {
      const res = await request(app).get('/enrolled/bad');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /states/:npiNumber', () => {
    it('returns enrollment states', async () => {
      mockGetEnrollmentStates.mockResolvedValue(['CA', 'NY']);

      const res = await request(app).get('/states/1234567890');

      expect(res.status).toBe(200);
      expect(res.body.data.states).toEqual(['CA', 'NY']);
    });

    it('returns 400 for invalid NPI', async () => {
      const res = await request(app).get('/states/abc');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /specialties/:npiNumber', () => {
    it('returns specialties for provider', async () => {
      mockGetSpecialties.mockResolvedValue(['Internal Medicine']);

      const res = await request(app).get('/specialties/1234567890');

      expect(res.status).toBe(200);
      expect(res.body.data.specialties).toEqual(['Internal Medicine']);
    });

    it('returns 400 for invalid NPI', async () => {
      const res = await request(app).get('/specialties/12345');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /batch', () => {
    it('returns batch results for valid NPIs', async () => {
      const resultMap = new Map([
        ['1234567890', { enrolled: true }],
        ['0987654321', { enrolled: false }],
      ]);
      mockBatchLookup.mockResolvedValue(resultMap);

      const res = await request(app)
        .post('/batch')
        .send({ npis: ['1234567890', '0987654321'] });

      expect(res.status).toBe(200);
      expect(res.body.data['1234567890']).toEqual({ enrolled: true });
    });

    it('returns 400 for empty npis array', async () => {
      const res = await request(app).post('/batch').send({ npis: [] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('non-empty array');
    });

    it('returns 400 when npis is not an array', async () => {
      const res = await request(app).post('/batch').send({ npis: 'not-array' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for more than 50 NPIs', async () => {
      const npis = Array.from({ length: 51 }, (_, i) => `${String(i).padStart(10, '0')}`);

      const res = await request(app).post('/batch').send({ npis });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Maximum 50');
    });

    it('returns 400 for invalid NPI in batch', async () => {
      const res = await request(app)
        .post('/batch')
        .send({ npis: ['1234567890', 'bad'] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Invalid NPI');
    });
  });
});
