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

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: vi.fn((_req: any, _res: any, next: any) => next()),
  getPracticeRelationFilter: vi.fn(() => ({})),
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../services/enrollment-creation-hook.js', () => ({
  onEnrollmentCreated: vi.fn(),
}));

vi.mock('../services/enrollment.service.js', () => ({
  updateEnrollmentStatus: vi.fn(),
}));

vi.mock('../services/terminationWorkflow.service.js', () => ({
  triggerTerminationWorkflow: vi.fn(),
}));

vi.mock('../services/followup-instantiation.service.js', () => ({
  instantiateFollowUp: vi.fn(),
}));

vi.mock('../services/denial-triage.service.js', () => ({
  triggerDenialTriage: vi.fn(),
}));

import enrollmentRouter from './enrollment.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { onEnrollmentCreated } from '../services/enrollment-creation-hook.js';
import { updateEnrollmentStatus } from '../services/enrollment.service.js';

const mockedOnEnrollmentCreated = vi.mocked(onEnrollmentCreated);
const mockedUpdateEnrollmentStatus = vi.mocked(updateEnrollmentStatus);

describe('Enrollment Routes', () => {
  const app = createTestApp(enrollmentRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedOnEnrollmentCreated.mockResolvedValue({
      stepsCreated: 0,
      templateFound: false,
      workflowType: null,
    });
  });

  describe('GET /', () => {
    it('returns all enrollments', async () => {
      prismaMock.enrollment.findMany.mockResolvedValue([{ ...mockEnrollment, workflowSteps: [] }] as any);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toHaveProperty('workflowProgress');
    });
  });

  describe('GET /provider/:providerId', () => {
    it('returns enrollments for specific provider', async () => {
      prismaMock.enrollment.findMany.mockResolvedValue([mockEnrollment] as any);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1-id' },
        })
      );
    });
  });

  describe('GET /:id', () => {
    it('returns a single enrollment', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);

      const res = await request(app).get('/enrollment-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('enrollment-1-id');
    });

    it('returns 404 when enrollment not found', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /provider/:providerId', () => {
    it('creates enrollment with existing payer lookup by name', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

      const res = await request(app)
        .post('/provider/provider-1-id')
        .send(validEnrollmentInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('auto-creates new payer when not found', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(null);
      prismaMock.payer.create.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

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
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send({ payerId: payerUuid, payerName: 'BCBS' });

      expect(prismaMock.payer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: payerUuid } })
      );
    });

    it('returns 409 when duplicate enrollment exists', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      const prismaError = new Error('Unique constraint failed') as any;
      prismaError.code = 'P2002';
      prismaMock.enrollment.create.mockRejectedValue(prismaError);

      const res = await request(app)
        .post('/provider/provider-1-id')
        .send(validEnrollmentInput);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already exists');
    });

    it('converts date strings to Date objects', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send({
          ...validEnrollmentInput,
          applicationDate: '2024-01-15',
          effectiveDate: '2024-02-01',
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

    it('sets createdById from authenticated user', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send(validEnrollmentInput);

      expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
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
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

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

    it('calls onEnrollmentCreated and includes workflow data in response', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);
      mockedOnEnrollmentCreated.mockResolvedValue({
        stepsCreated: 7,
        templateFound: true,
        workflowType: 'medical' as any,
      });

      const res = await request(app)
        .post('/provider/provider-1-id')
        .send(validEnrollmentInput);

      expect(res.status).toBe(201);
      expect(mockedOnEnrollmentCreated).toHaveBeenCalledWith(
        expect.anything(), // prisma
        expect.objectContaining({ id: 'enrollment-1-id' }),
        undefined // no explicit workflowType
      );
      expect(res.body.data.workflow).toEqual({
        stepsCreated: 7,
        templateFound: true,
        workflowType: 'medical',
      });
    });

    it('passes workflowType to onEnrollmentCreated when provided', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .post('/provider/provider-1-id')
        .send({ ...validEnrollmentInput, workflowType: 'behavioral_health' });

      expect(mockedOnEnrollmentCreated).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'behavioral_health'
      );
    });

    it('returns 500 when onEnrollmentCreated throws (enrollment still saved)', async () => {
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id', practiceId: null } as any);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);
      mockedOnEnrollmentCreated.mockRejectedValue(new Error('__dirname is not defined'));

      const res = await request(app)
        .post('/provider/provider-1-id')
        .send(validEnrollmentInput);

      // The enrollment was created but the workflow hook failed
      expect(prismaMock.enrollment.create).toHaveBeenCalled();
      expect(res.status).toBe(500);
    });
  });

  describe('PUT /:id', () => {
    it('updates enrollment partially', async () => {
      mockedUpdateEnrollmentStatus.mockResolvedValue({ ...mockEnrollment, status: 'submitted' } as any);

      const res = await request(app)
        .put('/enrollment-1-id')
        .send({ status: 'submitted' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when enrollment not found', async () => {
      mockedUpdateEnrollmentStatus.mockResolvedValue(undefined as any);
      prismaMock.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/nonexistent-id')
        .send({ status: 'submitted' });

      expect(res.status).toBe(404);
    });

    it('sets updatedById from user', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      prismaMock.enrollment.update.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .put('/enrollment-1-id')
        .send({ notes: 'Updated notes' });

      expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
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
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      prismaMock.enrollment.delete.mockResolvedValue(mockEnrollment as any);

      const res = await request(app).delete('/enrollment-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.enrollment.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'enrollment-1-id' } })
      );
    });

    it('returns 404 when enrollment not found', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(null);

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
