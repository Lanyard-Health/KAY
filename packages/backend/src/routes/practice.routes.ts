import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { setAuditContext } from '../middleware/audit.middleware.js';
import { decryptSafe, encryptSafe } from '../utils/crypto.js';

function maskPractice(practice: any) {
  if (!practice) return practice;
  const { taxIdEncrypted, ...rest } = practice;
  const plain = taxIdEncrypted ? decryptSafe(taxIdEncrypted) : null;
  return {
    ...rest,
    taxId: plain ? '****' + plain.slice(-4) : null,
  };
}

const router = Router();

// Validation schemas
const createPracticeSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().max(500).optional().or(z.literal('')),
  notes: z.string().max(2000).optional(),
  taxId: z.string().max(20).optional(),
});

const n = <T extends z.ZodTypeAny>(s: T) => z.union([s, z.null()]).optional().transform((v: z.input<T> | null | undefined) => v === null ? undefined : v);
const updatePracticeSchema = z.object({
  name: n(z.string().min(1).max(200)),
  status: n(z.enum(['ACTIVE', 'INACTIVE'])),
  phone: z.union([z.string().max(20), z.literal(''), z.null()]).optional().transform((v) => v === null ? undefined : v),
  email: z.union([z.string().email(), z.literal(''), z.null()]).optional().transform((v) => v === null ? undefined : v),
  website: z.union([z.string().max(500), z.literal(''), z.null()]).optional().transform((v) => v === null ? undefined : v),
  notes: n(z.string().max(2000)),
  taxId: n(z.string().max(20)),
});

const assignUserSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['SUPER_ADMIN', 'PRACTICE_ADMIN', 'PRACTICE_STAFF', 'PROVIDER']),
});

// List all practices (super admin only)
router.get(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practices = await prisma.practice.findMany({
        include: {
          _count: {
            select: {
              users: true,
              providers: true,
              practiceLocations: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      res.json({ success: true, data: practices.map(maskPractice) });
    } catch (error) {
      next(error);
    }
  }
);

// Get a single practice
router.get(
  '/:practiceId',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;

      const practice = await prisma.practice.findUnique({
        where: { id: practiceId },
        include: {
          _count: {
            select: {
              users: true,
              providers: true,
              practiceLocations: true,
            },
          },
        },
      });

      if (!practice) {
        return res.status(404).json({
          success: false,
          error: { message: 'Practice not found' },
        });
      }

      res.json({ success: true, data: maskPractice(practice) });
    } catch (error) {
      next(error);
    }
  }
);

// Create a new practice
router.post(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = createPracticeSchema.parse(req.body);

      setAuditContext(req, {
        resourceType: 'practice',
        action: 'create',
      });

      const practice = await prisma.practice.create({
        data: {
          name: validated.name,
          phone: validated.phone || null,
          email: validated.email || null,
          website: validated.website || null,
          notes: validated.notes || null,
          ...(validated.taxId ? { taxIdEncrypted: encryptSafe(validated.taxId) } : {}),
        },
      });

      res.status(201).json({ success: true, data: maskPractice(practice) });
    } catch (error) {
      next(error);
    }
  }
);

// Update a practice
router.patch(
  '/:practiceId',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;
      const validated = updatePracticeSchema.parse(req.body);

      const existing = await prisma.practice.findUnique({
        where: { id: practiceId },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Practice not found' },
        });
      }

      setAuditContext(req, {
        resourceType: 'practice',
        resourceId: practiceId,
        action: 'update',
      });

      const updateData: Record<string, unknown> = {};
      if (validated.name !== undefined) updateData['name'] = validated.name;
      if (validated.status !== undefined) updateData['status'] = validated.status;
      if (validated.phone !== undefined) updateData['phone'] = validated.phone || null;
      if (validated.email !== undefined) updateData['email'] = validated.email || null;
      if (validated.website !== undefined) updateData['website'] = validated.website || null;
      if (validated.notes !== undefined) updateData['notes'] = validated.notes || null;
      if (validated.taxId !== undefined) updateData['taxIdEncrypted'] = validated.taxId ? encryptSafe(validated.taxId) : null;

      const practice = await prisma.practice.update({
        where: { id: practiceId },
        data: updateData,
      });

      res.json({ success: true, data: maskPractice(practice) });
    } catch (error) {
      next(error);
    }
  }
);

// List users assigned to a practice
router.get(
  '/:practiceId/users',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;

      const practice = await prisma.practice.findUnique({
        where: { id: practiceId },
        select: { id: true },
      });

      if (!practice) {
        return res.status(404).json({
          success: false,
          error: { message: 'Practice not found' },
        });
      }

      const assignments = await prisma.userPractice.findMany({
        where: { practiceId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
              isActive: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      res.json({ success: true, data: assignments });
    } catch (error) {
      next(error);
    }
  }
);

// Assign a user to a practice
router.post(
  '/:practiceId/users',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;
      const validated = assignUserSchema.parse(req.body);

      // Verify practice exists
      const practice = await prisma.practice.findUnique({
        where: { id: practiceId },
        select: { id: true },
      });
      if (!practice) {
        return res.status(404).json({
          success: false,
          error: { message: 'Practice not found' },
        });
      }

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: validated.userId },
        select: { id: true },
      });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: { message: 'User not found' },
        });
      }

      // Check for duplicate assignment
      const existing = await prisma.userPractice.findUnique({
        where: {
          userId_practiceId: {
            userId: validated.userId,
            practiceId,
          },
        },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: { message: 'User is already assigned to this practice' },
        });
      }

      setAuditContext(req, {
        resourceType: 'user_practice',
        action: 'create',
      });

      const assignment = await prisma.userPractice.create({
        data: {
          userId: validated.userId,
          practiceId,
          role: validated.role,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      res.status(201).json({ success: true, data: assignment });
    } catch (error) {
      next(error);
    }
  }
);

// Remove a user from a practice
router.delete(
  '/:practiceId/users/:userId',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;
      const userId = req.params['userId']!;

      const existing = await prisma.userPractice.findUnique({
        where: {
          userId_practiceId: {
            userId,
            practiceId,
          },
        },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'User is not assigned to this practice' },
        });
      }

      setAuditContext(req, {
        resourceType: 'user_practice',
        resourceId: existing.id,
        action: 'delete',
      });

      await prisma.userPractice.delete({
        where: { id: existing.id },
      });

      res.json({ success: true, data: { message: 'User removed from practice' } });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
