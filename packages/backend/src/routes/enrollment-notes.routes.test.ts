import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, practiceAdminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((...allowedRoles: string[]) => (req: any, res: any, next: any) => {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
    }
    next();
  }),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: vi.fn((_req: any, _res: any, next: any) => next()),
  getPracticeRelationFilter: vi.fn(() => ({})),
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
  validateEnrollmentAccess: vi.fn().mockResolvedValue(true),
  validatePracticeAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../services/terminationWorkflow.service.js', () => ({ triggerTerminationWorkflow: vi.fn() }));
vi.mock('../services/automatedEmail.service.js', () => ({ triggerAutomatedEmail: vi.fn() }));
vi.mock('../services/enrollment-creation-hook.js', () => ({ onEnrollmentCreated: vi.fn() }));
vi.mock('../services/followup-instantiation.service.js', () => ({ instantiateFollowUp: vi.fn() }));
vi.mock('../services/denial-triage.service.js', () => ({ triggerDenialTriage: vi.fn() }));
vi.mock('../services/enrollment.service.js', () => ({
  updateEnrollmentStatus: vi.fn(),
  correctEnrollmentStatus: vi.fn(),
}));
vi.mock('../utils/cache.js', () => ({ invalidateCache: vi.fn() }));
vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import enrollmentRoutes from './enrollment.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { setAuditContext } from '../middleware/audit.middleware.js';

const ENROLLMENT_ID = '00000000-0000-4000-a000-000000000001';
const NOTE_ID = '00000000-0000-4000-a000-000000000002';
const NEW_PAYER_ID = '00000000-0000-4000-a000-000000000003';

const baseNote = {
  id: NOTE_ID,
  enrollmentId: ENROLLMENT_ID,
  body: 'Called the payer, on hold 40 minutes',
  authorId: practiceAdminUser.id,
  createdAt: new Date('2026-07-30T12:00:00Z'),
};

describe('Enrollment notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /:id/notes', () => {
    it('creates a note authored by the caller', async () => {
      const app = createTestApp(enrollmentRoutes, adminUser);
      prismaMock.enrollment.findUnique.mockResolvedValue({ id: ENROLLMENT_ID } as any);
      prismaMock.enrollmentNote.create.mockResolvedValue({
        ...baseNote,
        authorId: adminUser.id,
        author: { id: adminUser.id, firstName: 'Admin', lastName: 'User' },
      } as any);

      const res = await request(app)
        .post(`/${ENROLLMENT_ID}/notes`)
        .send({ body: 'Called the payer, on hold 40 minutes' });

      expect(res.status).toBe(201);
      expect(prismaMock.enrollmentNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            enrollmentId: ENROLLMENT_ID,
            body: 'Called the payer, on hold 40 minutes',
            authorId: adminUser.id,
          },
        })
      );
    });

    it('rejects an empty note', async () => {
      const app = createTestApp(enrollmentRoutes, adminUser);
      const res = await request(app).post(`/${ENROLLMENT_ID}/notes`).send({ body: '' });
      expect(res.status).toBe(400);
      expect(prismaMock.enrollmentNote.create).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /:id/notes/:noteId', () => {
    it('lets the author delete their own note, with an audit row in the same transaction', async () => {
      const app = createTestApp(enrollmentRoutes, practiceAdminUser);
      prismaMock.enrollment.findUnique.mockResolvedValue({
        id: ENROLLMENT_ID,
        providerId: null,
        practiceId: 'practice-1',
      } as any);
      prismaMock.enrollmentNote.findFirst.mockResolvedValue(baseNote as any);

      const res = await request(app).delete(`/${ENROLLMENT_ID}/notes/${NOTE_ID}`);

      expect(res.status).toBe(200);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.enrollmentNote.delete).toHaveBeenCalledWith({ where: { id: NOTE_ID } });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: practiceAdminUser.id,
          action: 'delete',
          resourceType: 'enrollment_note',
          resourceId: NOTE_ID,
          changes: expect.objectContaining({
            source: 'note_delete',
            body: baseNote.body,
            authorId: baseNote.authorId,
          }),
        }),
      });
    });

    it('lets Lanyard staff delete another user’s note', async () => {
      const app = createTestApp(enrollmentRoutes, adminUser);
      prismaMock.enrollmentNote.findFirst.mockResolvedValue(baseNote as any);

      const res = await request(app).delete(`/${ENROLLMENT_ID}/notes/${NOTE_ID}`);
      expect(res.status).toBe(200);
      expect(prismaMock.enrollmentNote.delete).toHaveBeenCalled();
    });

    it('blocks a practice user from deleting someone else’s note', async () => {
      const app = createTestApp(enrollmentRoutes, practiceAdminUser);
      prismaMock.enrollment.findUnique.mockResolvedValue({
        id: ENROLLMENT_ID,
        providerId: null,
        practiceId: 'practice-1',
      } as any);
      prismaMock.enrollmentNote.findFirst.mockResolvedValue({
        ...baseNote,
        authorId: 'someone-else',
      } as any);

      const res = await request(app).delete(`/${ENROLLMENT_ID}/notes/${NOTE_ID}`);
      expect(res.status).toBe(403);
      expect(prismaMock.enrollmentNote.delete).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('404s when the note does not belong to the enrollment', async () => {
      const app = createTestApp(enrollmentRoutes, adminUser);
      prismaMock.enrollmentNote.findFirst.mockResolvedValue(null);

      const res = await request(app).delete(`/${ENROLLMENT_ID}/notes/${NOTE_ID}`);
      expect(res.status).toBe(404);
      expect(prismaMock.enrollmentNote.delete).not.toHaveBeenCalled();
    });
  });

  describe('PUT /:id reassignment gate', () => {
    it('rejects a payer change after submission', async () => {
      const app = createTestApp(enrollmentRoutes, adminUser);
      prismaMock.enrollment.findUnique.mockResolvedValue({
        id: ENROLLMENT_ID,
        status: 'submitted',
        subjectType: 'PROVIDER',
        payerId: 'old-payer',
        providerId: 'prov-1',
        practiceId: null,
      } as any);

      const res = await request(app).put(`/${ENROLLMENT_ID}`).send({ payerId: NEW_PAYER_ID });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/before the application is submitted/);
      expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    });

    it('reassigns the payer pre-submission, clears stale outcomes, and audits the change', async () => {
      const app = createTestApp(enrollmentRoutes, adminUser);
      prismaMock.enrollment.findUnique.mockResolvedValue({
        id: ENROLLMENT_ID,
        status: 'not_started',
        subjectType: 'PROVIDER',
        payerId: 'old-payer',
        providerId: 'prov-1',
        practiceId: null,
      } as any);
      prismaMock.payer.findUnique.mockResolvedValue({ id: NEW_PAYER_ID, name: 'Aetna' } as any);
      prismaMock.enrollment.findFirst.mockResolvedValue(null); // no duplicate
      prismaMock.enrollment.update.mockResolvedValue({
        id: ENROLLMENT_ID,
        payerId: NEW_PAYER_ID,
      } as any);

      const res = await request(app).put(`/${ENROLLMENT_ID}`).send({ payerId: NEW_PAYER_ID });

      expect(res.status).toBe(200);
      expect(prismaMock.enrollmentOutcome.deleteMany).toHaveBeenCalledWith({
        where: { enrollmentId: ENROLLMENT_ID },
      });
      expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payerId: NEW_PAYER_ID }),
        })
      );
      expect(setAuditContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          changes: expect.objectContaining({
            source: 'reassignment',
            payerId: { from: 'old-payer', to: NEW_PAYER_ID },
          }),
        })
      );
    });

    it('rejects the reassignment when it would duplicate an existing enrollment', async () => {
      const app = createTestApp(enrollmentRoutes, adminUser);
      prismaMock.enrollment.findUnique.mockResolvedValue({
        id: ENROLLMENT_ID,
        status: 'not_started',
        subjectType: 'PROVIDER',
        payerId: 'old-payer',
        providerId: 'prov-1',
        practiceId: null,
      } as any);
      prismaMock.payer.findUnique.mockResolvedValue({ id: NEW_PAYER_ID } as any);
      prismaMock.enrollment.findFirst.mockResolvedValue({ id: 'other-enrollment' } as any);

      const res = await request(app).put(`/${ENROLLMENT_ID}`).send({ payerId: NEW_PAYER_ID });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/already exists/);
      expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    });
  });
});
