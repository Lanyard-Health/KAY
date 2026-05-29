import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, mockProvider, validProviderInput } from '../../tests/helpers/fixtures.js';

// Mock prisma via async factory
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock auth middleware to passthrough
vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

// Mock audit middleware
vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { providerRoutes } from './provider.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

describe('Provider Routes', () => {
  const app = createTestApp(providerRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns paginated providers', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([mockProvider] as any);
      prismaMock.providerProfile.count.mockResolvedValue(1);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      expect(res.body.data.totalPages).toBe(1);
    });

    it('passes search query to Prisma', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.count.mockResolvedValue(0);

      await request(app).get('/?search=Jane');

      expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ firstName: expect.objectContaining({ contains: 'Jane' }) }),
            ]),
          }),
        })
      );
    });

    it('passes status filter to Prisma', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.count.mockResolvedValue(0);

      await request(app).get('/?status=active');

      expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        })
      );
    });

    it('respects pagination params', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.count.mockResolvedValue(50);

      const res = await request(app).get('/?page=3&pageSize=10');

      expect(res.body.data.page).toBe(3);
      expect(res.body.data.pageSize).toBe(10);
      expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });

    it('returns unassigned providers when practiceId=null', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([mockProvider] as any);
      prismaMock.providerProfile.count.mockResolvedValue(1);

      const res = await request(app).get('/?practiceId=null&pageSize=100');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ practiceId: null }),
        })
      );
    });

    it('rejects pageSize over 100', async () => {
      const res = await request(app).get('/?pageSize=200');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns providers for a specific practiceId', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([mockProvider] as any);
      prismaMock.providerProfile.count.mockResolvedValue(1);

      const res = await request(app).get('/?practiceId=practice-1-id&pageSize=100');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ practiceId: 'practice-1-id' }),
        })
      );
    });
  });

  describe('GET /:providerId', () => {
    it('returns provider with relations', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        ...mockProvider,
        addresses: [],
        licenses: [],
        boardCertifications: [],
      } as any);

      const res = await request(app).get('/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('provider-1-id');
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /', () => {
    it('creates provider with 201', async () => {
      prismaMock.providerProfile.create.mockResolvedValue({
        ...mockProvider,
        id: 'new-provider-id',
      } as any);

      const res = await request(app)
        .post('/')
        .send(validProviderInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('passes validated data to Prisma create', async () => {
      prismaMock.providerProfile.create.mockResolvedValue(mockProvider as any);

      await request(app).post('/').send(validProviderInput);

      expect(prismaMock.providerProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Jane',
            lastName: 'Doe',
          }),
        })
      );
    });

    it('sets createdById from user', async () => {
      prismaMock.providerProfile.create.mockResolvedValue(mockProvider as any);

      await request(app).post('/').send(validProviderInput);

      expect(prismaMock.providerProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: 'admin-user-id',
          }),
        })
      );
    });

    it('returns error on validation failure', async () => {
      const res = await request(app)
        .post('/')
        .send({ firstName: 'Jane' }); // missing required fields

      // ZodError from shared package passes through error handler;
      // the handler checks err.name to detect ZodError in case instanceof fails
      // across package boundaries (different zod copies).
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('PUT /:providerId', () => {
    it('updates provider partially', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(mockProvider as any);
      prismaMock.providerProfile.update.mockResolvedValue({
        ...mockProvider,
        firstName: 'Updated',
      } as any);

      const res = await request(app)
        .put('/provider-1-id')
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/nonexistent-id')
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('sets updatedById from user', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(mockProvider as any);
      prismaMock.providerProfile.update.mockResolvedValue(mockProvider as any);

      await request(app).put('/provider-1-id').send({ firstName: 'Updated' });

      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            updatedById: 'admin-user-id',
          }),
        })
      );
    });

    it('assigns provider to a practice via practiceId', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(mockProvider as any);
      prismaMock.providerProfile.update.mockResolvedValue({
        ...mockProvider,
        practiceId: 'practice-1-id',
      } as any);

      const res = await request(app)
        .put('/provider-1-id')
        .send({ practiceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            practiceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          }),
        })
      );
    });

    it('unassigns provider from a practice via practiceId=null', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        ...mockProvider,
        practiceId: 'practice-1-id',
      } as any);
      prismaMock.providerProfile.update.mockResolvedValue({
        ...mockProvider,
        practiceId: null,
      } as any);

      const res = await request(app)
        .put('/provider-1-id')
        .send({ practiceId: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            practiceId: null,
          }),
        })
      );
    });
  });

  describe('DELETE /:providerId', () => {
    it('soft deletes by setting status to inactive', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(mockProvider as any);
      prismaMock.providerProfile.update.mockResolvedValue({
        ...mockProvider,
        status: 'inactive',
      } as any);

      const res = await request(app).delete('/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Provider deactivated');
      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'inactive' }),
        })
      );
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
