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
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: vi.fn((_req: any, _res: any, next: any) => next()),
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import router from './practiceLocation.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';

const mockLocation = {
  id: 'loc-1',
  providerId: 'provider-1-id',
  locationName: 'Main Office',
  locationType: 'office',
  isPrimary: true,
  isActive: true,
  addressLine1: '123 Main St',
  addressLine2: null,
  city: 'Springfield',
  state: 'IL',
  zipCode: '62701',
  county: null,
  country: 'US',
  phone: '555-0100',
  fax: null,
  email: null,
  taxIdEncrypted: null,
  npi: null,
  groupNpi: null,
  officeHours: null,
  wheelchairAccessible: false,
  publicTransitAccess: false,
  parkingAvailable: true,
  acceptingNewPatients: true,
  languagesSpoken: [],
  specialServices: [],
  notes: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validLocationInput = {
  locationName: 'Main Office',
  locationType: 'office',
  addressLine1: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  zipCode: '62701',
  phone: '555-0100',
};

describe('Practice Location Routes', () => {
  const app = createTestApp(router, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set after clearAllMocks
    (validateProviderPracticeAccess as any).mockResolvedValue(true);
  });

  describe('GET /provider/:providerId', () => {
    it('returns all locations for a provider', async () => {
      prismaMock.practiceLocation.findMany.mockResolvedValue([mockLocation] as any);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns empty array when no locations', async () => {
      prismaMock.practiceLocation.findMany.mockResolvedValue([]);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('GET /:id', () => {
    it('returns a single location', async () => {
      // assertLocationAccess calls findUnique for access check
      prismaMock.practiceLocation.findUnique
        .mockResolvedValueOnce({ providerId: 'provider-1-id' } as any) // access check
        .mockResolvedValueOnce(mockLocation as any); // full data

      const res = await request(app).get('/loc-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when location not found', async () => {
      prismaMock.practiceLocation.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /provider/:providerId', () => {
    it('creates a new practice location', async () => {
      prismaMock.practiceLocation.create.mockResolvedValue(mockLocation as any);

      const res = await request(app)
        .post('/provider/provider-1-id')
        .send(validLocationInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('unsets existing primary when new location is primary', async () => {
      prismaMock.practiceLocation.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.practiceLocation.create.mockResolvedValue(mockLocation as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send({ ...validLocationInput, isPrimary: true });

      expect(prismaMock.practiceLocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1-id', isPrimary: true },
          data: { isPrimary: false },
        })
      );
    });

    it('returns 400 for invalid ZIP code', async () => {
      const res = await request(app)
        .post('/provider/provider-1-id')
        .send({ ...validLocationInput, zipCode: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/provider/provider-1-id')
        .send({ locationName: 'X' });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id', () => {
    it('updates a location', async () => {
      // assertLocationAccess check
      prismaMock.practiceLocation.findUnique
        .mockResolvedValueOnce({ providerId: 'provider-1-id' } as any)  // access check
        .mockResolvedValueOnce({ ...mockLocation, isPrimary: false } as any); // full existing
      prismaMock.practiceLocation.update.mockResolvedValue({ ...mockLocation, locationName: 'Updated' } as any);

      const res = await request(app)
        .put('/loc-1')
        .send({ locationName: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when location not found', async () => {
      prismaMock.practiceLocation.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/nonexistent')
        .send({ locationName: 'X' });

      expect(res.status).toBe(404);
    });

    it('unsets other primaries when setting as primary', async () => {
      prismaMock.practiceLocation.findUnique
        .mockResolvedValueOnce({ providerId: 'provider-1-id' } as any)
        .mockResolvedValueOnce({ ...mockLocation, isPrimary: false } as any);
      prismaMock.practiceLocation.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.practiceLocation.update.mockResolvedValue({ ...mockLocation, isPrimary: true } as any);

      await request(app)
        .put('/loc-1')
        .send({ isPrimary: true });

      expect(prismaMock.practiceLocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isPrimary: false },
        })
      );
    });
  });

  describe('DELETE /:id', () => {
    it('deletes a location', async () => {
      prismaMock.practiceLocation.findUnique.mockResolvedValue(mockLocation as any);
      prismaMock.practiceLocation.delete.mockResolvedValue(mockLocation as any);

      const res = await request(app).delete('/loc-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when location not found', async () => {
      prismaMock.practiceLocation.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/nonexistent');

      expect(res.status).toBe(404);
    });
  });
});
