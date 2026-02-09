import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/test-app.js';
import { adminUser, staffUser } from './helpers/fixtures.js';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
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
import {
  createCognitoUser,
  disableCognitoUser,
  enableCognitoUser,
} from '../src/services/cognitoUser.service.js';

// Staff user with practice assignments for practice-scope tests
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

describe('User Management', () => {
  const adminApp = createTestApp(userRoutes, adminUser);

  // Staff app with practice scope manually overridden
  const staffApp = (() => {
    const app = createTestApp(userRoutes, staffWithPractice);
    return app;
  })();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // CREATE USER
  // ==========================================
  describe('POST / — Create user', () => {
    it('creates user with valid data and returns 201', async () => {
      prismaMock.user.create.mockResolvedValue(mockCreatedUser as any);

      const res = await request(adminApp)
        .post('/')
        .send({
          email: 'newuser@test.com',
          firstName: 'New',
          lastName: 'User',
          role: 'credentialing_staff',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('newuser@test.com');
      expect(createCognitoUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newuser@test.com',
          firstName: 'New',
          lastName: 'User',
        })
      );
    });

    it('non-admin creating admin user returns 403', async () => {
      // Use a custom app that sets isSuperAdmin=false
      const staffScopeApp = createTestApp(userRoutes, staffUser);

      const res = await request(staffScopeApp)
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

    it('non-admin auto-assigns new user to their practice(s)', async () => {
      // Create an app where the staff user has practiceIds populated
      const { default: express } = await import('express');
      const { errorHandler } = await import('../src/middleware/error.middleware.js');
      const staffPracticeApp = express();
      staffPracticeApp.use(express.json());
      staffPracticeApp.use((req, _res, next) => {
        req.user = staffWithPractice as any;
        req.practiceScope = {
          isSuperAdmin: false,
          practiceIds: ['practice-1'],
        };
        next();
      });
      staffPracticeApp.use(userRoutes);
      staffPracticeApp.use(errorHandler);

      prismaMock.user.create.mockResolvedValue(mockCreatedUser as any);
      prismaMock.userPractice.create.mockResolvedValue({} as any);

      const res = await request(staffPracticeApp)
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

    it('returns 400 for invalid input (missing required fields)', async () => {
      const res = await request(adminApp)
        .post('/')
        .send({ email: 'no-name@test.com' }); // missing firstName, lastName

      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // DEACTIVATE USER
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

      const res = await request(adminApp)
        .put('/target-user-id/deactivate');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isActive).toBe(false);
      expect(disableCognitoUser).toHaveBeenCalledWith('target@test.com');
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'target-user-id' },
          data: { isActive: false },
        })
      );
    });

    it('cannot deactivate yourself (returns 403)', async () => {
      const res = await request(adminApp)
        .put('/admin-user-id/deactivate');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('staff cannot deactivate user outside their practice', async () => {
      // Staff with practice scope but target user is NOT in their practice
      const { default: express } = await import('express');
      const { errorHandler } = await import('../src/middleware/error.middleware.js');
      const scopedApp = express();
      scopedApp.use(express.json());
      scopedApp.use((req, _res, next) => {
        req.user = staffWithPractice as any;
        req.practiceScope = {
          isSuperAdmin: false,
          practiceIds: ['practice-1'],
        };
        next();
      });
      scopedApp.use(userRoutes);
      scopedApp.use(errorHandler);

      // userPractice.findFirst returns null → user not in staff's practice
      prismaMock.userPractice.findFirst.mockResolvedValue(null);

      const res = await request(scopedApp)
        .put('/outside-user-id/deactivate');

      expect(res.status).toBe(403);
    });
  });

  // ==========================================
  // ACTIVATE USER
  // ==========================================
  describe('PUT /:id/activate', () => {
    it('sets isActive=true and calls Cognito enable', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        email: 'target@test.com',
      } as any);
      prismaMock.user.update.mockResolvedValue({
        id: 'target-user-id',
        isActive: true,
      } as any);

      const res = await request(adminApp)
        .put('/target-user-id/activate');

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
      expect(enableCognitoUser).toHaveBeenCalledWith('target@test.com');
    });
  });

  // ==========================================
  // LIST USERS — practice scope
  // ==========================================
  describe('GET / — List users', () => {
    it('admin sees all users (no practice filter)', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'one@test.com' },
        { id: 'u2', email: 'two@test.com' },
      ] as any);

      const res = await request(adminApp).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      // Admin's where clause should NOT contain practices filter
      const calledWith = prismaMock.user.findMany.mock.calls[0]![0] as any;
      expect(calledWith.where.practices).toBeUndefined();
    });
  });

  // ==========================================
  // GET USER BY ID — practice scope
  // ==========================================
  describe('GET /:id — View user', () => {
    it('staff cannot view user outside their practice', async () => {
      const { default: express } = await import('express');
      const { errorHandler } = await import('../src/middleware/error.middleware.js');
      const scopedApp = express();
      scopedApp.use(express.json());
      scopedApp.use((req, _res, next) => {
        req.user = staffWithPractice as any;
        req.practiceScope = {
          isSuperAdmin: false,
          practiceIds: ['practice-1'],
        };
        next();
      });
      scopedApp.use(userRoutes);
      scopedApp.use(errorHandler);

      // User found but assigned to a different practice
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

  // ==========================================
  // UPDATE USER — role escalation prevention
  // ==========================================
  describe('PUT /:id — Update user', () => {
    it('staff cannot set role to admin', async () => {
      const { default: express } = await import('express');
      const { errorHandler } = await import('../src/middleware/error.middleware.js');
      const scopedApp = express();
      scopedApp.use(express.json());
      scopedApp.use((req, _res, next) => {
        req.user = staffWithPractice as any;
        req.practiceScope = {
          isSuperAdmin: false,
          practiceIds: ['practice-1'],
        };
        next();
      });
      scopedApp.use(userRoutes);
      scopedApp.use(errorHandler);

      // Target user IS in the staff's practice
      prismaMock.userPractice.findFirst.mockResolvedValue({ id: 'up-1' } as any);

      const res = await request(scopedApp)
        .put('/target-user-id')
        .send({ role: 'admin' });

      expect(res.status).toBe(403);
    });

    it('staff cannot update user outside their practice', async () => {
      const { default: express } = await import('express');
      const { errorHandler } = await import('../src/middleware/error.middleware.js');
      const scopedApp = express();
      scopedApp.use(express.json());
      scopedApp.use((req, _res, next) => {
        req.user = staffWithPractice as any;
        req.practiceScope = {
          isSuperAdmin: false,
          practiceIds: ['practice-1'],
        };
        next();
      });
      scopedApp.use(userRoutes);
      scopedApp.use(errorHandler);

      prismaMock.userPractice.findFirst.mockResolvedValue(null);

      const res = await request(scopedApp)
        .put('/outside-user-id')
        .send({ firstName: 'Hacked' });

      expect(res.status).toBe(403);
    });
  });
});
