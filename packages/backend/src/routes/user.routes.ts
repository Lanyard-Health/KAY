import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { z } from 'zod';

export const userRoutes = Router();

userRoutes.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['admin', 'credentialing_staff', 'provider']),
  providerId: z.string().uuid().optional(),
});

// GET /api/v1/users - List all users (admin only)
userRoutes.get(
  '/',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          providerId: true,
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

// GET /api/v1/users/:id - Get user by ID (admin only)
userRoutes.get(
  '/:id',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.params['id'] },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          providerId: true,
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

// POST /api/v1/users - Create user (admin only)
// Note: User creation in Cognito should be done separately
userRoutes.post(
  '/',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createUserSchema.parse(req.body);

      // Note: cognitoId should come from Cognito user creation
      const user = await prisma.user.create({
        data: {
          ...data,
          cognitoId: req.body.cognitoId, // This should be set after Cognito user creation
        },
      });

      res.status(201).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/users/:id - Update user (admin only)
userRoutes.put(
  '/:id',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createUserSchema.partial().parse(req.body);

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

// PUT /api/v1/users/:id/deactivate - Deactivate user (admin only)
userRoutes.put(
  '/:id/deactivate',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
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

// PUT /api/v1/users/:id/activate - Activate user (admin only)
userRoutes.put(
  '/:id/activate',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
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
