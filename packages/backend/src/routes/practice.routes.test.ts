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

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/crypto.js', () => ({
  encryptSafe: (v: string) => `enc:${v}`,
  decryptSafe: (v: string) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v),
}));

import practiceRoutes from './practice.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const USER_UUID = '00000000-0000-4000-a000-000000000010';

const mockPractice = {
  id: 'practice-1-id',
  name: 'Test Practice',
  status: 'ACTIVE',
  phone: '555-1234',
  email: 'office@practice.com',
  website: 'https://practice.com',
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { users: 2, providers: 5, practiceLocations: 1 },
};

const mockAssignment = {
  id: 'assignment-1-id',
  userId: USER_UUID,
  practiceId: 'practice-1-id',
  role: 'PRACTICE_STAFF',
  createdAt: new Date(),
  user: {
    id: USER_UUID,
    email: 'user@test.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'credentialing_staff',
    isActive: true,
  },
};

describe('Practice Routes', () => {
  const app = createTestApp(practiceRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // GET / — List practices
  // ==========================================
  describe('GET /', () => {
    it('returns list of practices with counts', async () => {
      prismaMock.practice.findMany.mockResolvedValue([mockPractice] as any);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Test Practice');
      expect(prismaMock.practice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
          include: expect.objectContaining({
            _count: expect.any(Object),
          }),
        })
      );
    });

    it('returns empty array when no practices', async () => {
      prismaMock.practice.findMany.mockResolvedValue([]);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ==========================================
  // GET /:practiceId — Single practice
  // ==========================================
  describe('GET /:practiceId', () => {
    it('returns practice by ID', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(mockPractice as any);

      const res = await request(app).get('/practice-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Test Practice');
    });

    it('returns 404 when practice not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Practice not found');
    });
  });

  // ==========================================
  // POST / — Create practice
  // ==========================================
  describe('POST /', () => {
    it('creates a practice with 201', async () => {
      prismaMock.practice.create.mockResolvedValue(mockPractice as any);

      const res = await request(app)
        .post('/')
        .send({ name: 'New Practice', phone: '555-1234', email: 'new@practice.com' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.practice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Practice',
            phone: '555-1234',
            email: 'new@practice.com',
          }),
        })
      );
    });

    it('creates practice with only name (minimal)', async () => {
      prismaMock.practice.create.mockResolvedValue(mockPractice as any);

      const res = await request(app)
        .post('/')
        .send({ name: 'Minimal Practice' });

      expect(res.status).toBe(201);
      expect(prismaMock.practice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Minimal Practice',
            phone: null,
            email: null,
            website: null,
          }),
        })
      );
    });

    it('persists group intake fields and computes the TIN last-4', async () => {
      prismaMock.practice.create.mockResolvedValue(mockPractice as any);

      const res = await request(app)
        .post('/')
        .send({
          name: 'Group Practice',
          legalName: 'Group Practice LLC',
          dba: 'GP Health',
          entityType: 'Limited Liability Company (LLC)',
          groupNpi: '1234567890',
          taxId: '12-3456789',
          emrVendor: 'Epic',
          billingClearinghouse: 'Availity',
          billingAddressLine1: '1 Billing St',
          billingCity: 'Boston',
          billingState: 'MA',
          billingZipCode: '02101',
        });

      expect(res.status).toBe(201);
      expect(prismaMock.practice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            legalName: 'Group Practice LLC',
            dba: 'GP Health',
            entityType: 'Limited Liability Company (LLC)',
            groupNpi: '1234567890',
            emrVendor: 'Epic',
            billingClearinghouse: 'Availity',
            billingAddressLine1: '1 Billing St',
            billingCity: 'Boston',
            billingState: 'MA',
            billingZipCode: '02101',
            taxIdEncrypted: 'enc:12-3456789',
            taxIdLast4: '6789',
          }),
        })
      );
    });

    it('rejects a malformed group NPI', async () => {
      const res = await request(app)
        .post('/')
        .send({ name: 'Bad NPI Practice', groupNpi: '123' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/')
        .send({ phone: '555-1234' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when name is empty', async () => {
      const res = await request(app)
        .post('/')
        .send({ name: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/')
        .send({ name: 'Practice', email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // PATCH /:practiceId — Update practice
  // ==========================================
  describe('PATCH /:practiceId', () => {
    it('updates practice fields', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(mockPractice as any);
      prismaMock.practice.update.mockResolvedValue({
        ...mockPractice,
        name: 'Updated Practice',
      } as any);

      const res = await request(app)
        .patch('/practice-1-id')
        .send({ name: 'Updated Practice' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.practice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'practice-1-id' },
          data: expect.objectContaining({ name: 'Updated Practice' }),
        })
      );
    });

    it('updates status to INACTIVE', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(mockPractice as any);
      prismaMock.practice.update.mockResolvedValue({
        ...mockPractice,
        status: 'INACTIVE',
      } as any);

      const res = await request(app)
        .patch('/practice-1-id')
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(200);
      expect(prismaMock.practice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'INACTIVE' }),
        })
      );
    });

    it('returns 404 when practice not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/nonexistent-id')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid status value', async () => {
      const res = await request(app)
        .patch('/practice-1-id')
        .send({ status: 'DELETED' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // GET /:practiceId/users — List practice users
  // ==========================================
  describe('GET /:practiceId/users', () => {
    it('returns users assigned to the practice', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.userPractice.findMany.mockResolvedValue([mockAssignment] as any);

      const res = await request(app).get('/practice-1-id/users');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].user.email).toBe('user@test.com');
    });

    it('returns 404 when practice not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id/users');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns empty array when no users assigned', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.userPractice.findMany.mockResolvedValue([]);

      const res = await request(app).get('/practice-1-id/users');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ==========================================
  // POST /:practiceId/users — Assign user
  // ==========================================
  describe('POST /:practiceId/users', () => {
    it('assigns user to practice with 201', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.user.findUnique.mockResolvedValue({ id: USER_UUID } as any);
      prismaMock.userPractice.findUnique.mockResolvedValue(null); // not already assigned
      prismaMock.userPractice.create.mockResolvedValue(mockAssignment as any);

      const res = await request(app)
        .post('/practice-1-id/users')
        .send({ userId: USER_UUID, role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.userPractice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_UUID,
            practiceId: 'practice-1-id',
            role: 'PRACTICE_STAFF',
          }),
        })
      );
    });

    it('returns 404 when practice not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/nonexistent-id/users')
        .send({ userId: USER_UUID, role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Practice not found');
    });

    it('returns 404 when user not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/practice-1-id/users')
        .send({ userId: USER_UUID, role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('User not found');
    });

    it('returns 409 when user already assigned', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.user.findUnique.mockResolvedValue({ id: USER_UUID } as any);
      prismaMock.userPractice.findUnique.mockResolvedValue(mockAssignment as any);

      const res = await request(app)
        .post('/practice-1-id/users')
        .send({ userId: USER_UUID, role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already assigned');
    });

    it('returns 400 for missing userId', async () => {
      const res = await request(app)
        .post('/practice-1-id/users')
        .send({ role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid role', async () => {
      const res = await request(app)
        .post('/practice-1-id/users')
        .send({ userId: USER_UUID, role: 'INVALID_ROLE' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for non-UUID userId', async () => {
      const res = await request(app)
        .post('/practice-1-id/users')
        .send({ userId: 'not-a-uuid', role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('accepts all valid role types', async () => {
      const roles = ['SUPER_ADMIN', 'PRACTICE_ADMIN', 'PRACTICE_STAFF', 'PROVIDER'];

      for (const role of roles) {
        vi.clearAllMocks();
        prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
        prismaMock.user.findUnique.mockResolvedValue({ id: USER_UUID } as any);
        prismaMock.userPractice.findUnique.mockResolvedValue(null);
        prismaMock.userPractice.create.mockResolvedValue({ ...mockAssignment, role } as any);

        const res = await request(app)
          .post('/practice-1-id/users')
          .send({ userId: USER_UUID, role });

        expect(res.status).toBe(201);
      }
    });
  });

  // ==========================================
  // DELETE /:practiceId/users/:userId — Remove user
  // ==========================================
  describe('DELETE /:practiceId/users/:userId', () => {
    it('removes user from practice', async () => {
      prismaMock.userPractice.findUnique.mockResolvedValue(mockAssignment as any);
      prismaMock.userPractice.delete.mockResolvedValue(mockAssignment as any);

      const res = await request(app).delete(`/practice-1-id/users/${USER_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.userPractice.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'assignment-1-id' },
        })
      );
    });

    it('returns 404 when assignment not found', async () => {
      prismaMock.userPractice.findUnique.mockResolvedValue(null);

      const res = await request(app).delete(`/practice-1-id/users/${USER_UUID}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('not assigned');
    });
  });

  // ==========================================
  // DELETE /:practiceId — Soft-delete practice
  // ==========================================
  describe('DELETE /:practiceId', () => {
    it('soft deletes by setting deletedAt + deletedBy + deletionReason and audits the action', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({
        ...mockPractice, deletedAt: null,
      } as any);
      prismaMock.practice.update.mockResolvedValue({
        ...mockPractice, deletedAt: new Date(),
      } as any);

      const res = await request(app).delete('/practice-1-id?reason=Duplicate');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alreadyDeleted).toBe(false);
      expect(prismaMock.practice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            deletionReason: 'Duplicate',
          }),
        })
      );
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PRACTICE_SOFT_DELETE',
            resourceType: 'practice',
          }),
        })
      );
    });

    it('returns 404 when practice not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('is idempotent on already-deleted practice', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({
        ...mockPractice, deletedAt: new Date('2026-06-01'),
      } as any);
      prismaMock.practice.findUniqueOrThrow.mockResolvedValue({
        ...mockPractice, deletedAt: new Date('2026-06-01'),
      } as any);

      const res = await request(app).delete('/practice-1-id');

      expect(res.status).toBe(200);
      expect(res.body.data.alreadyDeleted).toBe(true);
      expect(prismaMock.practice.update).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // POST /:practiceId/restore — Restore practice
  // ==========================================
  describe('POST /:practiceId/restore', () => {
    it('clears soft-delete columns and audits restore', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({
        ...mockPractice, deletedAt: new Date('2026-06-01'),
      } as any);
      prismaMock.practice.update.mockResolvedValue({
        ...mockPractice, deletedAt: null,
      } as any);

      const res = await request(app).post('/practice-1-id/restore');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alreadyActive).toBe(false);
      expect(prismaMock.practice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deletedAt: null,
            deletedBy: null,
            deletionReason: null,
          }),
        })
      );
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PRACTICE_RESTORE',
            resourceType: 'practice',
          }),
        })
      );
    });

    it('is idempotent on already-active practice', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({
        ...mockPractice, deletedAt: null,
      } as any);
      prismaMock.practice.findUniqueOrThrow.mockResolvedValue({
        ...mockPractice, deletedAt: null,
      } as any);

      const res = await request(app).post('/practice-1-id/restore');

      expect(res.status).toBe(200);
      expect(res.body.data.alreadyActive).toBe(true);
      expect(prismaMock.practice.update).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('returns 404 when practice not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(app).post('/nonexistent-id/restore');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
