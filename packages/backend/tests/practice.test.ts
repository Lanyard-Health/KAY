import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/test-app.js';
import { adminUser, staffUser } from './helpers/fixtures.js';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../src/middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((..._roles: string[]) => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../src/middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from './helpers/mock-prisma.js';
import practiceRouter from '../src/routes/practice.routes.js';

const mockPractice = {
  id: 'practice-1-id',
  name: 'Downtown Clinic',
  status: 'ACTIVE',
  phone: '555-0100',
  email: 'info@downtown.com',
  website: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { users: 2, providers: 5, practiceLocations: 1 },
};

const mockAssignment = {
  id: 'up-1-id',
  userId: '00000000-0000-4000-a000-000000000001',
  practiceId: 'practice-1-id',
  role: 'PRACTICE_STAFF',
  createdAt: new Date(),
  user: {
    id: 'user-1-id',
    email: 'staff@test.com',
    firstName: 'Staff',
    lastName: 'User',
  },
};

describe('Practice CRUD', () => {
  const adminApp = createTestApp(practiceRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // CREATE PRACTICE
  // ==========================================
  describe('POST / — Create practice', () => {
    it('admin creates practice with valid data returns 201', async () => {
      prismaMock.practice.create.mockResolvedValue(mockPractice as any);

      const res = await request(adminApp)
        .post('/')
        .send({ name: 'Downtown Clinic', phone: '555-0100', email: 'info@downtown.com' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Downtown Clinic');
      expect(prismaMock.practice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Downtown Clinic',
            phone: '555-0100',
            email: 'info@downtown.com',
          }),
        })
      );
    });

    it('returns 400 for missing name', async () => {
      const res = await request(adminApp)
        .post('/')
        .send({ phone: '555-0100' }); // missing required 'name'

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(adminApp)
        .post('/')
        .send({ name: 'Test Clinic', email: 'not-an-email' });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // LIST PRACTICES
  // ==========================================
  describe('GET / — List practices', () => {
    it('returns all practices with counts', async () => {
      prismaMock.practice.findMany.mockResolvedValue([mockPractice] as any);
      (prismaMock.enrollment as any).groupBy.mockResolvedValue([]);
      prismaMock.providerProfile.findMany.mockResolvedValue([]);

      const res = await request(adminApp).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Downtown Clinic');
      expect(res.body.data[0].enrollmentCount).toBe(0);
    });
  });

  // ==========================================
  // GET PRACTICE DETAIL
  // ==========================================
  describe('GET /:practiceId — Practice detail', () => {
    it('returns practice when found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(mockPractice as any);

      const res = await request(adminApp).get('/practice-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('practice-1-id');
    });

    it('returns 404 when not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(adminApp).get('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // ASSIGN USER TO PRACTICE
  // ==========================================
  describe('POST /:practiceId/users — Assign user', () => {
    it('assigns user to practice returns 201', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.user.findUnique.mockResolvedValue({ id: '00000000-0000-4000-a000-000000000001' } as any);
      prismaMock.userPractice.findUnique.mockResolvedValue(null); // no duplicate
      prismaMock.userPractice.create.mockResolvedValue(mockAssignment as any);

      const res = await request(adminApp)
        .post('/practice-1-id/users')
        .send({ userId: '00000000-0000-4000-a000-000000000001', role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.userPractice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: '00000000-0000-4000-a000-000000000001',
            practiceId: 'practice-1-id',
            role: 'PRACTICE_STAFF',
          }),
        })
      );
    });

    it('returns 409 for duplicate assignment', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.user.findUnique.mockResolvedValue({ id: '00000000-0000-4000-a000-000000000001' } as any);
      prismaMock.userPractice.findUnique.mockResolvedValue(mockAssignment as any); // already exists

      const res = await request(adminApp)
        .post('/practice-1-id/users')
        .send({ userId: '00000000-0000-4000-a000-000000000001', role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already assigned');
    });

    it('returns 404 when practice not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(adminApp)
        .post('/nonexistent/users')
        .send({ userId: '00000000-0000-4000-a000-000000000001', role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('Practice not found');
    });

    it('returns 404 when user not found', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'practice-1-id' } as any);
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(adminApp)
        .post('/practice-1-id/users')
        .send({ userId: '00000000-0000-4000-a000-000000000001', role: 'PRACTICE_STAFF' });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('User not found');
    });

    it('returns 400 for invalid role', async () => {
      const res = await request(adminApp)
        .post('/practice-1-id/users')
        .send({ userId: '00000000-0000-4000-a000-000000000001', role: 'INVALID_ROLE' });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // REMOVE USER FROM PRACTICE
  // ==========================================
  describe('DELETE /:practiceId/users/:userId — Remove user', () => {
    it('removes assignment successfully', async () => {
      prismaMock.userPractice.findUnique.mockResolvedValue({
        id: 'up-1-id',
        userId: '00000000-0000-4000-a000-000000000001',
        practiceId: 'practice-1-id',
      } as any);
      prismaMock.userPractice.delete.mockResolvedValue({} as any);

      const res = await request(adminApp)
        .delete('/practice-1-id/users/user-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.userPractice.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'up-1-id' } })
      );
    });

    it('returns 404 when user not assigned to practice', async () => {
      prismaMock.userPractice.findUnique.mockResolvedValue(null);

      const res = await request(adminApp)
        .delete('/practice-1-id/users/user-1-id');

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('not assigned');
    });
  });
});
