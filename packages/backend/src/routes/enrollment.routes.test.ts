import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, mockPayer, mockEnrollment, validEnrollmentInput } from '../../tests/helpers/fixtures.js';

// Mock prisma via async factory
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
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
  validateEnrollmentAccess: vi.fn().mockResolvedValue(true),
  validatePracticeAccess: vi.fn(() => true),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../services/enrollment-creation-hook.js', () => ({
  onEnrollmentCreated: vi.fn(),
}));

vi.mock('../services/enrollment.service.js', () => ({
  updateEnrollmentStatus: vi.fn(),
  correctEnrollmentStatus: vi.fn(),
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
import { updateEnrollmentStatus, correctEnrollmentStatus } from '../services/enrollment.service.js';
import { validatePracticeAccess, validateEnrollmentAccess } from '../middleware/practiceScope.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';

const mockedOnEnrollmentCreated = vi.mocked(onEnrollmentCreated);
const mockedUpdateEnrollmentStatus = vi.mocked(updateEnrollmentStatus);
const mockedCorrectEnrollmentStatus = vi.mocked(correctEnrollmentStatus);

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

  describe('GET /:id as practice_admin', () => {
    const practiceAdminApp = createTestApp(enrollmentRouter, { ...adminUser, role: 'practice_admin' });

    it('allows a practice admin scoped to the enrollment practice', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);

      const res = await request(practiceAdminApp).get('/enrollment-1-id');

      expect(res.status).toBe(200);
      expect(vi.mocked(validateEnrollmentAccess)).toHaveBeenCalled();
    });

    it('rejects a practice admin outside the enrollment practice', async () => {
      vi.mocked(validateEnrollmentAccess).mockResolvedValueOnce(false);
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);

      const res = await request(practiceAdminApp).get('/enrollment-1-id');

      expect(res.status).toBe(403);
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

  describe('POST /practice/:practiceId', () => {
    it('creates a practice enrollment (no provider) with existing payer', async () => {
      prismaMock.practice.findFirst.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      prismaMock.enrollment.create.mockResolvedValue(mockEnrollment as any);

      const res = await request(app)
        .post('/practice/practice-1-id')
        .send(validEnrollmentInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subjectType: 'PRACTICE', practiceId: 'practice-1-id' }),
        }),
      );
    });

    it('returns 404 when the practice does not exist', async () => {
      prismaMock.practice.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/practice/missing-practice')
        .send(validEnrollmentInput);

      expect(res.status).toBe(404);
    });

    it('returns 403 when the practice is not in the caller scope', async () => {
      vi.mocked(validatePracticeAccess).mockReturnValueOnce(false);

      const res = await request(app)
        .post('/practice/practice-1-id')
        .send(validEnrollmentInput);

      expect(res.status).toBe(403);
    });

    it('returns 409 on a duplicate practice+payer enrollment', async () => {
      prismaMock.practice.findFirst.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.payer.findFirst.mockResolvedValue(mockPayer as any);
      prismaMock.payerTrack.findMany.mockResolvedValue([]);
      const prismaError = new Error('Unique constraint failed') as any;
      prismaError.code = 'P2002';
      prismaMock.enrollment.create.mockRejectedValue(prismaError);

      const res = await request(app)
        .post('/practice/practice-1-id')
        .send(validEnrollmentInput);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already exists');
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

    it('parses a provided date string into a Date', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      prismaMock.enrollment.update.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .put('/enrollment-1-id')
        .send({ applicationDate: '2026-01-15' });

      expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationDate: new Date('2026-01-15'),
          }),
        })
      );
    });

    it('clears a date when empty string is sent', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      prismaMock.enrollment.update.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .put('/enrollment-1-id')
        .send({ applicationDate: '', notes: 'keep entering update branch' });

      expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationDate: null,
          }),
        })
      );
    });

    it('leaves dates untouched when omitted or JSON null', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      prismaMock.enrollment.update.mockResolvedValue(mockEnrollment as any);

      await request(app)
        .put('/enrollment-1-id')
        .send({ notes: 'no dates here', effectiveDate: null });

      const updateArg = prismaMock.enrollment.update.mock.calls[0]![0] as any;
      expect(updateArg.data.applicationDate).toBeUndefined();
      expect(updateArg.data.effectiveDate).toBeUndefined();
    });

    it('does not trigger termination workflow when clearing terminationDate', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue({ ...mockEnrollment, terminationDate: new Date('2026-01-01') } as any);
      prismaMock.enrollment.update.mockResolvedValue({ ...mockEnrollment, terminationDate: null } as any);

      const { triggerTerminationWorkflow } = await import('../services/terminationWorkflow.service.js');

      await request(app)
        .put('/enrollment-1-id')
        .send({ terminationDate: '' });

      expect(vi.mocked(triggerTerminationWorkflow)).not.toHaveBeenCalled();
    });
  });

  describe('POST /:id/status-correction', () => {
    it('corrects the status via the service', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);
      mockedCorrectEnrollmentStatus.mockResolvedValue({ ...mockEnrollment, status: 'submitted' } as any);

      const res = await request(app)
        .post('/enrollment-1-id/status-correction')
        .send({ toStatus: 'submitted' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockedCorrectEnrollmentStatus).toHaveBeenCalledWith('enrollment-1-id', 'submitted', 'admin-user-id');
    });

    it('rejects an invalid toStatus with 400', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollment as any);

      const res = await request(app)
        .post('/enrollment-1-id/status-correction')
        .send({ toStatus: 'bogus' });

      expect(res.status).toBe(400);
      expect(mockedCorrectEnrollmentStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when the enrollment does not exist', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(null);
      mockedCorrectEnrollmentStatus.mockRejectedValue(new NotFoundError('Enrollment'));

      const res = await request(app)
        .post('/nonexistent-id/status-correction')
        .send({ toStatus: 'submitted' });

      expect(res.status).toBe(404);
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
