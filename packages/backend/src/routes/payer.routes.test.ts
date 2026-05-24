import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import {
  adminUser,
  mockPayer,
  validPayerInput,
  mockEnrollment,
  validPayerEnrollmentInput,
} from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { payerRoutes } from './payer.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

describe('Payer Routes', () => {
  const app = createTestApp(payerRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // PAYERS
  // ==========================================
  describe('GET /', () => {
    it('returns payers ordered by name', async () => {
      prismaMock.payer.findMany.mockResolvedValue([mockPayer] as any);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.payer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        })
      );
    });

    it('returns empty array when no payers', async () => {
      prismaMock.payer.findMany.mockResolvedValue([]);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('GET /:id', () => {
    it('returns payer with enrollment count', async () => {
      prismaMock.payer.findUnique.mockResolvedValue({
        ...mockPayer,
        _count: { enrollments: 5 },
      } as any);

      const res = await request(app).get('/payer-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data._count.enrollments).toBe(5);
      expect(prismaMock.payer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payer-1-id' },
          include: { _count: { select: { enrollments: true } } },
        })
      );
    });

    it('returns 404 when payer not found', async () => {
      prismaMock.payer.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /', () => {
    it('creates payer with 201', async () => {
      prismaMock.payer.create.mockResolvedValue({
        ...mockPayer,
        ...validPayerInput,
      } as any);

      const res = await request(app)
        .post('/')
        .send(validPayerInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.payer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Aetna',
            payerId: 'aetna-001',
            payerType: 'insurance',
          }),
        })
      );
    });

    it('returns error on validation failure', async () => {
      const res = await request(app)
        .post('/')
        .send({ name: '' }); // empty name fails min(1)

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('PUT /:id', () => {
    it('updates payer partially', async () => {
      prismaMock.payer.update.mockResolvedValue({
        ...mockPayer,
        name: 'Updated Payer',
      } as any);

      const res = await request(app)
        .put('/payer-1-id')
        .send({ name: 'Updated Payer' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.payer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payer-1-id' },
          data: expect.objectContaining({ name: 'Updated Payer' }),
        })
      );
    });
  });

  // ==========================================
  // ENROLLMENTS
  // ==========================================
  describe('GET /enrollments/:providerId', () => {
    it('returns enrollments for a provider with payer included', async () => {
      prismaMock.enrollment.findMany.mockResolvedValue([mockEnrollment] as any);

      const res = await request(app).get('/enrollments/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1-id' },
          include: { payer: true },
        })
      );
    });

    it('returns empty array when no enrollments', async () => {
      prismaMock.enrollment.findMany.mockResolvedValue([]);

      const res = await request(app).get('/enrollments/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('POST /enrollments/:providerId', () => {
    it('creates enrollment with 201 and sets createdById', async () => {
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

      const res = await request(app)
        .post('/enrollments/provider-1-id')
        .send(validPayerEnrollmentInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-1-id',
            payerId: '00000000-0000-0000-0000-000000000001',
            createdById: 'admin-user-id',
          }),
        })
      );
    });

    it('converts optional date fields when provided', async () => {
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/enrollments/provider-1-id')
        .send({
          ...validPayerEnrollmentInput,
          applicationDate: '2024-03-15',
          effectiveDate: '2024-04-01',
        });

      expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationDate: expect.any(Date),
            effectiveDate: expect.any(Date),
          }),
        })
      );
    });

    it('returns error on validation failure', async () => {
      const res = await request(app)
        .post('/enrollments/provider-1-id')
        .send({ payerId: 'not-a-uuid' }); // fails uuid validation

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('PUT /enrollments/update/:id', () => {
    it('updates enrollment partially and sets updatedById', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue({ providerId: 'provider-1-id' } as any);
      prismaMock.enrollment.update.mockResolvedValue({
        ...mockEnrollment,
        status: 'in_progress',
        updatedById: 'admin-user-id',
      } as any);

      const res = await request(app)
        .put('/enrollments/update/enrollment-1-id')
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'enrollment-1-id' },
          data: expect.objectContaining({
            updatedById: 'admin-user-id',
          }),
        })
      );
    });
  });

  describe('DELETE /enrollments/delete/:id', () => {
    it('deletes an enrollment', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue({ providerId: 'provider-1-id' } as any);
      prismaMock.enrollment.delete.mockResolvedValue(mockEnrollment as any);

      const res = await request(app).delete('/enrollments/delete/enrollment-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Enrollment deleted');
      expect(prismaMock.enrollment.delete).toHaveBeenCalledWith({
        where: { id: 'enrollment-1-id' },
      });
    });
  });
});
