import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { NotFoundError, ForbiddenError } from '../middleware/error.middleware.js';
import { setAuditContext } from '../middleware/audit.middleware.js';
import { z } from 'zod';
import {
  createCognitoUser,
  disableCognitoUser,
  enableCognitoUser,
  updateCognitoUser,
} from '../services/cognitoUser.service.js';

export const userRoutes = Router();

userRoutes.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().max(20).optional(),
  role: z.enum(['admin', 'credentialing_staff', 'provider', 'practice_admin']).default('credentialing_staff'),
  providerId: z.string().uuid().optional(),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional().nullable(),
  role: z.enum(['admin', 'credentialing_staff', 'provider', 'practice_admin']).optional(),
});

// GET /api/v1/users - List all users
userRoutes.get(
  '/',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
      const roleFilter = typeof req.query['role'] === 'string' ? req.query['role'] : undefined;
      const statusFilter = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;

      // Practice-scope: non-admins only see users who share a practice
      const practiceWhere = req.practiceScope?.isSuperAdmin
        ? {}
        : {
            practices: {
              some: {
                practiceId: { in: req.practiceScope?.practiceIds ?? [] },
              },
            },
          };

      const users = await prisma.user.findMany({
        where: {
          ...practiceWhere,
          ...(search && {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }),
          ...(roleFilter && { role: roleFilter as any }),
          ...(statusFilter === 'active' ? { isActive: true } : statusFilter === 'inactive' ? { isActive: false } : {}),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          providerId: true,
          practices: {
            select: {
              id: true,
              practiceId: true,
              role: true,
              practice: { select: { id: true, name: true, status: true } },
            },
          },
        },
        orderBy: { lastName: 'asc' },
      });

      res.json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/users/me - Get current user
userRoutes.get(
  '/me',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          providerId: true,
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              npi: true,
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundError('User');
      }

      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/users/:id - Get user by ID
userRoutes.get(
  '/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.params['id'] },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          providerId: true,
          practices: {
            select: {
              id: true,
              practiceId: true,
              role: true,
              practice: { select: { id: true, name: true, status: true } },
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundError('User');
      }

      // Practice-scope check: non-admins can only view users in their practice(s)
      if (!req.practiceScope?.isSuperAdmin) {
        const sharedPractice = user.practices.some(
          (p) => req.practiceScope?.practiceIds.includes(p.practiceId)
        );
        if (!sharedPractice) {
          throw new ForbiddenError('You do not have access to this user');
        }
      }

      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/users - Create user
userRoutes.post(
  '/',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createUserSchema.parse(req.body);

      // Non-admins cannot create admin users
      if (!req.practiceScope?.isSuperAdmin && data.role === 'admin') {
        throw new ForbiddenError('Only admins can create admin users');
      }

      // Provision user in Cognito (dev mode auto-generates a fake ID)
      const { cognitoId } = await createCognitoUser({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
      });

      setAuditContext(req, { resourceType: 'users', action: 'create' });

      const user = await prisma.user.create({
        data: {
          ...data,
          cognitoId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      // Non-admins: auto-assign new user to caller's practice(s)
      if (!req.practiceScope?.isSuperAdmin && req.practiceScope?.practiceIds.length) {
        await Promise.all(
          req.practiceScope.practiceIds.map((practiceId) =>
            prisma.userPractice.create({
              data: { userId: user.id, practiceId, role: 'PRACTICE_STAFF' },
            })
          )
        );
      }

      res.status(201).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/users/:id - Update user
userRoutes.put(
  '/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateUserSchema.parse(req.body);

      // Practice-scope check: non-admins can only edit users in their practice(s)
      if (!req.practiceScope?.isSuperAdmin) {
        const target = await prisma.userPractice.findFirst({
          where: {
            userId: req.params['id'],
            practiceId: { in: req.practiceScope?.practiceIds ?? [] },
          },
        });
        if (!target) {
          throw new ForbiddenError('You do not have access to this user');
        }
        // Non-admins cannot set role to admin
        if (data.role === 'admin') {
          throw new ForbiddenError('Only admins can assign the admin role');
        }
      }

      setAuditContext(req, { resourceType: 'users', resourceId: req.params['id'], action: 'update' });

      // Sync changes to Cognito
      const existingUser = await prisma.user.findUnique({
        where: { id: req.params['id'] },
        select: { email: true },
      });
      if (existingUser) {
        await updateCognitoUser(existingUser.email, {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
        });
      }

      const user = await prisma.user.update({
        where: { id: req.params['id'] },
        data,
      });

      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/users/:id/deactivate - Deactivate user
userRoutes.put(
  '/:id/deactivate',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Prevent self-deactivation
      if (req.params['id'] === req.user!.id) {
        throw new ForbiddenError('You cannot deactivate your own account');
      }

      // Practice-scope check
      if (!req.practiceScope?.isSuperAdmin) {
        const target = await prisma.userPractice.findFirst({
          where: {
            userId: req.params['id'],
            practiceId: { in: req.practiceScope?.practiceIds ?? [] },
          },
        });
        if (!target) {
          throw new ForbiddenError('You do not have access to this user');
        }
      }

      setAuditContext(req, { resourceType: 'users', resourceId: req.params['id'], action: 'update' });

      // Disable user in Cognito (prevents login)
      const targetUser = await prisma.user.findUnique({
        where: { id: req.params['id'] },
        select: { email: true },
      });
      if (targetUser) {
        await disableCognitoUser(targetUser.email);
      }

      const user = await prisma.user.update({
        where: { id: req.params['id'] },
        data: { isActive: false },
      });

      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/users/:id/activate - Activate user
userRoutes.put(
  '/:id/activate',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Practice-scope check
      if (!req.practiceScope?.isSuperAdmin) {
        const target = await prisma.userPractice.findFirst({
          where: {
            userId: req.params['id'],
            practiceId: { in: req.practiceScope?.practiceIds ?? [] },
          },
        });
        if (!target) {
          throw new ForbiddenError('You do not have access to this user');
        }
      }

      setAuditContext(req, { resourceType: 'users', resourceId: req.params['id'], action: 'update' });

      // Re-enable user in Cognito
      const targetUser = await prisma.user.findUnique({
        where: { id: req.params['id'] },
        select: { email: true },
      });
      if (targetUser) {
        await enableCognitoUser(targetUser.email);
      }

      const user = await prisma.user.update({
        where: { id: req.params['id'] },
        data: { isActive: true },
      });

      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);
