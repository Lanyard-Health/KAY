import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import {
  adminUser,
  staffUser,
  providerUser,
} from '../../tests/helpers/fixtures.js';
import {
  mockProviderForTermination,
  mockEnrollment1,
  mockTerminationLetter,
  mockDraftLetterTask,
} from '../../tests/helpers/termination-fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((...allowedRoles: string[]) => (req: any, res: any, next: any) => {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Forbidden' },
      });
    }
    next();
  }),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/terminationLetter.service.js', () => ({
  generateTerminationLetter: vi.fn().mockResolvedValue({
    id: 'generated-letter-id',
    status: 'DRAFT',
    payerName: 'Blue Cross Blue Shield',
    providerName: 'Sheree Ann Mitchell MD',
  }),
}));

import terminationLetterRoutes from './terminationLetter.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { generateTerminationLetter } from '../services/terminationLetter.service.js';

const PROVIDER_ID = mockProviderForTermination.id;
const ENROLLMENT_ID = mockEnrollment1.id;
const LETTER_ID = mockTerminationLetter.id;
const TASK_ID = mockDraftLetterTask.id;

describe('Termination Letter Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // POST /providers/:providerId/termination-letters/generate
  // ==========================================
  describe('POST /providers/:providerId/termination-letters/generate', () => {
    const app = createTestApp(terminationLetterRoutes, adminUser);

    it('generates a draft termination letter', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: PROVIDER_ID } as any);
      prismaMock.enrollment.findFirst.mockResolvedValue({ id: ENROLLMENT_ID } as any);
      prismaMock.task.findFirst.mockResolvedValue({ id: TASK_ID } as any);
      prismaMock.terminationLetter.findFirst.mockResolvedValue(null); // No existing letter

      const res = await request(app)
        .post(`/providers/${PROVIDER_ID}/termination-letters/generate`)
        .send({ enrollmentId: ENROLLMENT_ID });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(generateTerminationLetter).toHaveBeenCalledWith(
        PROVIDER_ID,
        ENROLLMENT_ID,
        TASK_ID
      );
    });

    it('returns 409 when letter already exists for enrollment', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: PROVIDER_ID } as any);
      prismaMock.enrollment.findFirst.mockResolvedValue({ id: ENROLLMENT_ID } as any);
      prismaMock.task.findFirst.mockResolvedValue({ id: TASK_ID } as any);
      prismaMock.terminationLetter.findFirst.mockResolvedValue(mockTerminationLetter as any);

      const res = await request(app)
        .post(`/providers/${PROVIDER_ID}/termination-letters/generate`)
        .send({ enrollmentId: ENROLLMENT_ID });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already exists');
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`/providers/${PROVIDER_ID}/termination-letters/generate`)
        .send({ enrollmentId: ENROLLMENT_ID });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Provider not found');
    });

    it('returns 404 when enrollment not found for provider', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: PROVIDER_ID } as any);
      prismaMock.enrollment.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post(`/providers/${PROVIDER_ID}/termination-letters/generate`)
        .send({ enrollmentId: ENROLLMENT_ID });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Enrollment not found for this provider');
    });

    it('returns 403 when provider role tries to generate', async () => {
      const providerApp = createTestApp(terminationLetterRoutes, providerUser);

      const res = await request(providerApp)
        .post(`/providers/${PROVIDER_ID}/termination-letters/generate`)
        .send({ enrollmentId: ENROLLMENT_ID });

      expect(res.status).toBe(403);
    });

    it('creates task if DRAFT_TERM_LETTER task does not exist yet', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: PROVIDER_ID } as any);
      prismaMock.enrollment.findFirst.mockResolvedValue({ id: ENROLLMENT_ID } as any);
      prismaMock.task.findFirst.mockResolvedValue(null); // No existing task
      prismaMock.enrollment.findUnique.mockResolvedValue({
        id: ENROLLMENT_ID,
        payer: { name: 'Blue Cross Blue Shield' },
      } as any);
      prismaMock.task.create.mockResolvedValue({ id: 'newly-created-task-id' } as any);
      prismaMock.terminationLetter.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post(`/providers/${PROVIDER_ID}/termination-letters/generate`)
        .send({ enrollmentId: ENROLLMENT_ID });

      expect(res.status).toBe(201);
      expect(prismaMock.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: PROVIDER_ID,
            enrollmentId: ENROLLMENT_ID,
            type: 'DRAFT_TERM_LETTER',
          }),
        })
      );
    });
  });

  // ==========================================
  // GET /providers/:providerId/termination-letters
  // ==========================================
  describe('GET /providers/:providerId/termination-letters', () => {
    const app = createTestApp(terminationLetterRoutes, adminUser);

    it('returns list of termination letters for a provider', async () => {
      prismaMock.terminationLetter.findMany.mockResolvedValue([mockTerminationLetter] as any);

      const res = await request(app).get(`/providers/${PROVIDER_ID}/termination-letters`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].payerName).toBe('Blue Cross Blue Shield');
    });

    it('returns empty array when no letters exist', async () => {
      prismaMock.terminationLetter.findMany.mockResolvedValue([]);

      const res = await request(app).get(`/providers/${PROVIDER_ID}/termination-letters`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ==========================================
  // GET /termination-letters/:letterId
  // ==========================================
  describe('GET /termination-letters/:letterId', () => {
    const app = createTestApp(terminationLetterRoutes, adminUser);

    it('returns a single termination letter with full content', async () => {
      prismaMock.terminationLetter.findUnique.mockResolvedValue({
        ...mockTerminationLetter,
        task: { id: TASK_ID, status: 'PENDING', enrollmentId: ENROLLMENT_ID, title: 'Draft letter' },
        reviewedBy: null,
      } as any);

      const res = await request(app).get(`/termination-letters/${LETTER_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(LETTER_ID);
      expect(res.body.data.letterContent).toBeDefined();
    });

    it('returns 404 when letter not found', async () => {
      prismaMock.terminationLetter.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/termination-letters/nonexistent-id');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // PATCH /termination-letters/:letterId
  // ==========================================
  describe('PATCH /termination-letters/:letterId', () => {
    const app = createTestApp(terminationLetterRoutes, adminUser);

    it('updates letter content', async () => {
      prismaMock.terminationLetter.findUnique.mockResolvedValue({
        ...mockTerminationLetter,
        status: 'DRAFT',
      } as any);
      prismaMock.terminationLetter.update.mockResolvedValue({
        ...mockTerminationLetter,
        letterContent: 'Updated content',
      } as any);

      const res = await request(app)
        .patch(`/termination-letters/${LETTER_ID}`)
        .send({ letterContent: 'Updated content' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('marks letter as REVIEWED with reviewer info', async () => {
      prismaMock.terminationLetter.findUnique.mockResolvedValue({
        ...mockTerminationLetter,
        status: 'DRAFT',
      } as any);
      prismaMock.terminationLetter.update.mockResolvedValue({
        ...mockTerminationLetter,
        status: 'REVIEWED',
        reviewedById: adminUser.id,
        reviewedAt: new Date(),
      } as any);

      const res = await request(app)
        .patch(`/termination-letters/${LETTER_ID}`)
        .send({ status: 'REVIEWED' });

      expect(res.status).toBe(200);
      expect(prismaMock.terminationLetter.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REVIEWED',
            reviewedById: 'admin-user-id',
            reviewedAt: expect.any(Date),
          }),
        })
      );
    });

    it('rejects edit on SENT letter', async () => {
      prismaMock.terminationLetter.findUnique.mockResolvedValue({
        ...mockTerminationLetter,
        status: 'SENT',
      } as any);

      const res = await request(app)
        .patch(`/termination-letters/${LETTER_ID}`)
        .send({ letterContent: 'Should not work' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('already been sent');
    });

    it('returns 403 when provider role tries to update', async () => {
      const providerApp = createTestApp(terminationLetterRoutes, providerUser);

      const res = await request(providerApp)
        .patch(`/termination-letters/${LETTER_ID}`)
        .send({ letterContent: 'Should not work' });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================
  // POST /termination-letters/:letterId/send
  // ==========================================
  describe('POST /termination-letters/:letterId/send', () => {
    const app = createTestApp(terminationLetterRoutes, adminUser);

    it('marks letter as SENT and completes associated task', async () => {
      prismaMock.terminationLetter.findUnique.mockResolvedValue({
        ...mockTerminationLetter,
        status: 'REVIEWED',
      } as any);
      prismaMock.terminationLetter.update.mockResolvedValue({
        ...mockTerminationLetter,
        status: 'SENT',
        sentAt: new Date(),
      } as any);
      prismaMock.task.update.mockResolvedValue({
        ...mockDraftLetterTask,
        status: 'COMPLETED',
      } as any);

      const res = await request(app).post(`/termination-letters/${LETTER_ID}/send`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Letter marked as SENT
      expect(prismaMock.terminationLetter.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SENT',
            sentAt: expect.any(Date),
          }),
        })
      );

      // Associated task marked as COMPLETED
      expect(prismaMock.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TASK_ID },
          data: expect.objectContaining({
            status: 'COMPLETED',
            completedAt: expect.any(Date),
            completedById: 'admin-user-id',
          }),
        })
      );
    });

    it('rejects sending an already-SENT letter', async () => {
      prismaMock.terminationLetter.findUnique.mockResolvedValue({
        ...mockTerminationLetter,
        status: 'SENT',
      } as any);

      const res = await request(app).post(`/termination-letters/${LETTER_ID}/send`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('already been sent');
    });

    it('returns 404 when letter not found', async () => {
      prismaMock.terminationLetter.findUnique.mockResolvedValue(null);

      const res = await request(app).post('/termination-letters/nonexistent-id/send');

      expect(res.status).toBe(404);
    });

    it('returns 403 when provider role tries to send', async () => {
      const providerApp = createTestApp(terminationLetterRoutes, providerUser);

      const res = await request(providerApp).post(`/termination-letters/${LETTER_ID}/send`);

      expect(res.status).toBe(403);
    });
  });
});
