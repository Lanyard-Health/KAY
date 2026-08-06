import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
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

vi.mock('../src/services/cognitoUser.service.js', () => ({
  createCognitoUser: vi.fn(() => Promise.resolve({ cognitoId: 'mock-cognito-id' })),
  disableCognitoUser: vi.fn(() => Promise.resolve()),
  enableCognitoUser: vi.fn(() => Promise.resolve()),
  updateCognitoUser: vi.fn(() => Promise.resolve()),
}));

import { prismaMock } from './helpers/mock-prisma.js';
import { userRoutes } from '../src/routes/user.routes.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import {
  createCognitoUser,
  disableCognitoUser,
} from '../src/services/cognitoUser.service.js';

const staffWithPractice = {
  ...staffUser,
  practiceIds: ['practice-1'],
};

const mockCreatedUser = {
  id: 'new-user-id',
  cognitoId: 'mock-cognito-id',
  email: 'newuser@test.com',
  firstName: 'New',
  lastName: 'User',
  phone: null,
  role: 'credentialing_staff',
  isActive: true,
  createdAt: new Date(),
};

function createScopedStaffApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = staffWithPractice as any;
    req.practiceScope = {
      isSuperAdmin: false,
      practiceIds: ['practice-1'],
    };
    next();
  });
  app.use(userRoutes);
  app.use(errorHandler);
  return app;
}

describe('User Management — v2', () => {
  const adminApp = createTestApp(userRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // CREATE USER
  // ==========================================
  describe('POST / — Create user', () => {
    // role: 'provider' — an admin has no practice to auto-assign from, so a
    // practice-scoped role created here would land with zero practice rows. That
    // is now refused; see the guard test at the end of this block.
    it('creates user with valid data and returns 201', async () => {
      prismaMock.user.create.mockResolvedValue(mockCreatedUser as any);

      const res = await request(adminApp)
        .post('/')
        .send({
          email: 'newuser@test.com',
          firstName: 'New',
          lastName: 'User',
          role: 'provider',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('newuser@test.com');
      expect(createCognitoUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'newuser@test.com' })
      );
    });

    it('returns error when Cognito throws duplicate email', async () => {
      (createCognitoUser as any).mockRejectedValueOnce(new Error('User already exists'));

      const res = await request(adminApp)
        .post('/')
        .send({
          email: 'duplicate@test.com',
          firstName: 'Dup',
          lastName: 'User',
          role: 'provider',
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('non-admin cannot create admin-role users (403)', async () => {
      const staffApp = createTestApp(userRoutes, staffUser);

      const res = await request(staffApp)
        .post('/')
        .send({
          email: 'evil@test.com',
          firstName: 'Evil',
          lastName: 'Admin',
          role: 'admin',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('practice admin creating user auto-assigns to their practice', async () => {
      const scopedApp = createScopedStaffApp();
      prismaMock.user.create.mockResolvedValue(mockCreatedUser as any);
      prismaMock.userPractice.create.mockResolvedValue({} as any);

      const res = await request(scopedApp)
        .post('/')
        .send({
          email: 'newstaff@test.com',
          firstName: 'Staff',
          lastName: 'Member',
          role: 'credentialing_staff',
        });

      expect(res.status).toBe(201);
      expect(prismaMock.userPractice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'new-user-id',
            practiceId: 'practice-1',
            role: 'PRACTICE_STAFF',
          }),
        })
      );
    });

    // A practice-scoped role with no practice is scoped to nothing: every
    // correctly-scoped route denies it, and only an unscoped route would let it
    // through, so its reach depends on which routes forgot to scope. The account
    // used to land in that state purely based on who invited it.
    describe.each(['credentialing_staff', 'practice_admin'])(
      'refuses to create a %s with no practice',
      (role) => {
        it('rejects an admin-created account and never reaches Cognito', async () => {
          const res = await request(adminApp)
            .post('/')
            .send({ email: 'orphan@test.com', firstName: 'No', lastName: 'Practice', role });

          expect(res.status).toBe(400);
          expect(res.body.error.message).toMatch(/no practice/i);
          // Nothing was provisioned anywhere — no Cognito identity, no DB row.
          expect(createCognitoUser).not.toHaveBeenCalled();
          expect(prismaMock.user.create).not.toHaveBeenCalled();
        });

        it('rejects a lanyard_staff-created account, whose scope is every practice', async () => {
          // lanyard_staff practiceIds is the ENTIRE practice list, so auto-assign
          // is skipped for them too — same orphaned outcome by a different route.
          const app = express();
          app.use(express.json());
          app.use((req, _res, next) => {
            req.user = { ...staffUser, role: 'lanyard_staff' } as any;
            req.practiceScope = { isSuperAdmin: false, practiceIds: ['practice-1', 'practice-2'] } as any;
            next();
          });
          app.use(userRoutes);
          app.use(errorHandler);

          const res = await request(app)
            .post('/')
            .send({ email: 'orphan2@test.com', firstName: 'No', lastName: 'Practice', role });

          expect(res.status).toBe(400);
          expect(prismaMock.userPractice.create).not.toHaveBeenCalled();
        });
      },
    );

    it('still allows a provider with no practice — providers scope by providerId', async () => {
      prismaMock.user.create.mockResolvedValue({ ...mockCreatedUser, role: 'provider' } as any);

      const res = await request(adminApp)
        .post('/')
        .send({ email: 'doc@test.com', firstName: 'Doc', lastName: 'Tor', role: 'provider' });

      expect(res.status).toBe(201);
    });
  });

  // ==========================================
  // DEACTIVATE
  // ==========================================
  describe('PUT /:id/deactivate', () => {
    it('sets isActive=false and calls Cognito disable', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        email: 'target@test.com',
      } as any);
      prismaMock.user.update.mockResolvedValue({
        id: 'target-user-id',
        isActive: false,
      } as any);

      const res = await request(adminApp).put('/target-user-id/deactivate');

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
      expect(disableCognitoUser).toHaveBeenCalledWith('target@test.com');
    });

    it('cannot deactivate yourself (403)', async () => {
      const res = await request(adminApp).put('/admin-user-id/deactivate');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // LIST USERS — practice scope
  // ==========================================
  describe('GET / — Practice visibility', () => {
    it('staff can only see users in their practice', async () => {
      const scopedApp = createScopedStaffApp();

      // User found but in different practice
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'other-user-id',
        email: 'other@test.com',
        practices: [
          { practiceId: 'practice-OTHER', role: 'PRACTICE_STAFF', practice: { id: 'practice-OTHER', name: 'Other Clinic' } },
        ],
      } as any);

      const res = await request(scopedApp).get('/other-user-id');

      expect(res.status).toBe(403);
    });
  });
});
