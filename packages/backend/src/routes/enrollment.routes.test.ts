import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, mockPayer, mockEnrollment, validEnrollmentInput } from '../../tests/helpers/fixtures.js';

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

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import enrollmentRouter from './enrollment.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

describe('Enrollment Routes', () => {
  const app = createTestApp(enrollmentRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns all enrollments', async () => {
      prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollment] as any);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /provider/:providerId', () => {
    it('returns enrollments for specific provider', async () => {
      prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollment] as any);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.payerEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1-id' },
        })
      );
    });
  });

  describe('GET /:id', () => {
    it('returns a single enrollment', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment as any);

      const res = await request(app).get('/enrollment-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('enrollment-1-id');
    });

    it('returns 404 when enrollment not found', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /provider/:providerId', () => {
    it('creates enrollment with existing payer lookup by name', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);
      prismaMock.payerEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const res = await request(app)
        .post('/provider/provider-1-id')
        .send(validEnrollmentInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('auto-creates new payer when not found', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(null);
      prismaMock.payer.create.mockResolvedValue(mockPayer as any);
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);
      prismaMock.payerEnrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send({ payerName: 'New Custom Payer' });

      expect(prismaMock.payer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Custom Payer',
            payerType: 'insurance',
          }),
        })
      );
    });

    it('looks up payer by payerId UUID when provided', async () => {
      const payerUuid = '550e8400-e29b-41d4-a716-446655440000';
      prismaMock.payer.findUnique.mockResolvedValue(mockPayer as any);
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);
      prismaMock.payerEnrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send({ payerId: payerUuid, payerName: 'BCBS' });

      expect(prismaMock.payer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: payerUuid } })
      );
    });

    it('returns 409 when duplicate enrollment exists', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment as any);

      const res = await request(app)
        .post('/provider/provider-1-id')
        .send(validEnrollmentInput);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already exists');
    });

    it('converts date strings to Date objects', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);
      prismaMock.payerEnrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send({
          ...validEnrollmentInput,
          applicationDate: '2024-01-15',
          effectiveDate: '2024-02-01',
        });

      expect(prismaMock.payerEnrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationDate: expect.any(Date),
            effectiveDate: expect.any(Date),
          }),
        })
      );
    });

    it('sets createdById from authenticated user', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);
      prismaMock.payerEnrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send(validEnrollmentInput);

      expect(prismaMock.payerEnrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: 'admin-user-id',
          }),
        })
      );
    });

    it('returns 400 on validation error', async () => {
      const res = await request(app)
        .post('/provider/provider-1-id')
        .send({}); // missing required payerName

      expect(res.status).toBe(400);
    });

    it('validates status enum values', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);
      prismaMock.payerEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const validStatuses = [
        'not_started', 'in_progress', 'submitted',
        'pending_review', 'approved', 'denied', 'terminated',
      ];

      for (const status of validStatuses) {
        const res = await request(app)
          .post('/provider/provider-1-id')
          .send({ ...validEnrollmentInput, status });

        expect(res.status).not.toBe(400);
      }
    });
  });

  describe('PUT /:id', () => {
    it('updates enrollment partially', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      prismaMock.payerEnrollment.update.mockResolvedValue({
        ...mockEnrollment,
        status: 'submitted',
      } as any);

      const res = await request(app)
        .put('/enrollment-1-id')
        .send({ status: 'submitted' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when enrollment not found', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/nonexistent-id')
        .send({ status: 'submitted' });

      expect(res.status).toBe(404);
    });

    it('sets updatedById from user', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      prismaMock.payerEnrollment.update.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .put('/enrollment-1-id')
        .send({ notes: 'Updated notes' });

      expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            updatedById: 'admin-user-id',
          }),
        })
      );
    });
  });

  describe('DELETE /:id', () => {
    it('deletes enrollment', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      prismaMock.payerEnrollment.delete.mockResolvedValue(mockEnrollment as any);

      const res = await request(app).delete('/enrollment-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.payerEnrollment.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'enrollment-1-id' } })
      );
    });

    it('returns 404 when enrollment not found', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/nonexistent-id');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /payers', () => {
    it('returns all payers', async () => {
      prismaMock.payer.findMany.mockResolvedValue([mockPayer] as any);

      const res = await request(app).get('/payers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });
});
