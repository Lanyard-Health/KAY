import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
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

// Rate limit account mutations (Cognito interactions are expensive)
const accountMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many account operations, please try again later.',
});

export const userRoutes = Router();

userRoutes.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().max(20).optional(),
  role: z.enum(['admin', 'lanyard_staff', 'credentialing_staff', 'provider', 'practice_admin']).default('credentialing_staff'),
  providerId: z.string().uuid().optional(),
});

const n = <T extends z.ZodTypeAny>(s: T) => z.union([s, z.null()]).optional().transform((v: z.input<T> | null | undefined) => v === null ? undefined : v);
const updateUserSchema = z.object({
  firstName: n(z.string().min(1)),
  lastName: n(z.string().min(1)),
  email: n(z.string().email()),
  phone: n(z.string().max(20)),
  role: n(z.enum(['admin', 'lanyard_staff', 'credentialing_staff', 'provider', 'practice_admin'])),
});

// GET /api/v1/users - List all users
userRoutes.get(
  '/',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
      const VALID_ROLES = ['admin', 'lanyard_staff', 'credentialing_staff', 'provider', 'practice_admin'] as const;
      type Role = typeof VALID_ROLES[number];
      const rawRole = typeof req.query['role'] === 'string' ? req.query['role'] : undefined;
      const roleFilter: Role | undefined = rawRole && (VALID_ROLES as readonly string[]).includes(rawRole) ? rawRole as Role : undefined;
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
          ...(roleFilter && { role: roleFilter }),
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
          practices: {
            select: {
              practiceId: true,
              role: true,
              practice: { select: { id: true, name: true } },
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
  accountMutationLimiter,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createUserSchema.parse(req.body);

      // Escalation firewall: only the founder (admin / isSuperAdmin) can mint
      // Lanyard-internal logins (admin or lanyard_staff). Everyone else — including
      // lanyard_staff themselves — may only create practice-level roles.
      if (!req.practiceScope?.isSuperAdmin && (data.role === 'admin' || data.role === 'lanyard_staff')) {
        throw new ForbiddenError('Only the founder can create Lanyard-internal logins');
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

      // Non-admins: auto-assign new user to caller's practice(s).
      // Skip lanyard_staff: their practiceIds is the ENTIRE practice list (cross-practice
      // scope), so auto-assigning would attach every new user to every practice. They
      // assign practice membership explicitly via the per-practice add-user flow instead.
      if (
        !req.practiceScope?.isSuperAdmin &&
        req.user?.role !== 'lanyard_staff' &&
        req.practiceScope?.practiceIds.length
      ) {
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
  accountMutationLimiter,
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
        // Non-admins can only assign provider or practice_admin roles
        const ALLOWED_ROLES_FOR_NON_ADMIN = ['provider', 'practice_admin'] as const;
        if (data.role && !(ALLOWED_ROLES_FOR_NON_ADMIN as readonly string[]).includes(data.role)) {
          throw new ForbiddenError('You are not permitted to assign this role');
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
        select: {
          id: true, email: true, firstName: true, lastName: true,
          phone: true, role: true, isActive: true, lastLoginAt: true,
          createdAt: true, providerId: true,
        },
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
  accountMutationLimiter,
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
        select: {
          id: true, email: true, firstName: true, lastName: true,
          phone: true, role: true, isActive: true, lastLoginAt: true,
          createdAt: true, providerId: true,
        },
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
  accountMutationLimiter,
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
        select: {
          id: true, email: true, firstName: true, lastName: true,
          phone: true, role: true, isActive: true, lastLoginAt: true,
          createdAt: true, providerId: true,
        },
      });

      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);
