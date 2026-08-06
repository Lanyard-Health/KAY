import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, mockUser, validUserInput } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
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

const mockCreateCognitoUser = vi.fn().mockResolvedValue({ cognitoId: 'mock-cognito-id' });
vi.mock('../services/cognitoUser.service.js', () => ({
  createCognitoUser: (...args: any[]) => mockCreateCognitoUser(...args),
}));

import { userRoutes } from './user.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

describe('User Routes', () => {
  const app = createTestApp(userRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns list of users ordered by lastName', async () => {
      prismaMock.user.findMany.mockResolvedValue([mockUser] as any);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { lastName: 'asc' },
        })
      );
    });

    it('uses select to limit returned fields', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      await request(app).get('/');

      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
          }),
        })
      );
    });
  });

  describe('GET /me', () => {
    it('returns current user with provider relation', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...mockUser,
        provider: null,
      } as any);

      const res = await request(app).get('/me');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'admin-user-id' },
          select: expect.objectContaining({
            provider: expect.any(Object),
          }),
        })
      );
    });

    it('returns 404 when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/me');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /:id', () => {
    it('returns user by ID', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);

      const res = await request(app).get('/user-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1-id' },
        })
      );
    });

    it('returns 404 when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /', () => {
    it('creates user with 201', async () => {
      mockCreateCognitoUser.mockResolvedValueOnce({ cognitoId: 'new-cognito-id' });
      prismaMock.user.create.mockResolvedValue({
        ...mockUser,
        ...validUserInput,
        id: 'new-user-id',
      } as any);

      const res = await request(app)
        .post('/')
        .send(validUserInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(mockCreateCognitoUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: validUserInput.email,
          firstName: validUserInput.firstName,
          lastName: validUserInput.lastName,
        })
      );
    });

    it('passes validated data and cognitoId from Cognito to Prisma', async () => {
      mockCreateCognitoUser.mockResolvedValueOnce({ cognitoId: 'cognito-123' });
      prismaMock.user.create.mockResolvedValue(mockUser as any);

      await request(app)
        .post('/')
        .send(validUserInput);

      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'newuser@test.com',
            firstName: 'New',
            lastName: 'User',
            role: 'provider',
            cognitoId: 'cognito-123',
          }),
        })
      );
    });

    it('returns error on validation failure', async () => {
      const res = await request(app)
        .post('/')
        .send({ email: 'not-an-email' }); // invalid email, missing fields

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('PUT /:id', () => {
    it('updates user partially', async () => {
      prismaMock.user.update.mockResolvedValue({
        ...mockUser,
        firstName: 'Updated',
      } as any);

      const res = await request(app)
        .put('/user-1-id')
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1-id' },
          data: expect.objectContaining({ firstName: 'Updated' }),
        })
      );
    });
  });

  describe('PUT /:id/deactivate', () => {
    it('deactivates a user', async () => {
      prismaMock.user.update.mockResolvedValue({
        ...mockUser,
        isActive: false,
      } as any);

      const res = await request(app).put('/user-1-id/deactivate');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1-id' },
          data: { isActive: false },
        })
      );
    });
  });

  describe('PUT /:id/activate', () => {
    it('activates a user', async () => {
      prismaMock.user.update.mockResolvedValue({
        ...mockUser,
        isActive: true,
      } as any);

      const res = await request(app).put('/user-1-id/activate');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1-id' },
          data: { isActive: true },
        })
      );
    });
  });
});
