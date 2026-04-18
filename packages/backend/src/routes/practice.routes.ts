import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { setAuditContext } from '../middleware/audit.middleware.js';
import { decryptSafe, encryptSafe } from '../utils/crypto.js';
import { ensureDraftEnrollments } from '../services/draft-enrollment.service.js';
import { logger } from '../utils/logger.js';

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
  targetPayerIds: z.array(z.string().uuid()).optional(),
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

      // Count enrollments per practice via providers
      const enrollmentCounts = await prisma.enrollment.groupBy({
        by: ['providerId'],
        _count: { id: true },
      });
      const providerPracticeRows = await prisma.providerProfile.findMany({
        select: { id: true, practiceId: true },
        where: { practiceId: { not: null } },
      });
      const providerToPractice = new Map(providerPracticeRows.map((p) => [p.id, p.practiceId]));
      const practiceEnrollmentCount = new Map<string, number>();
      for (const row of enrollmentCounts) {
        const pid = providerToPractice.get(row.providerId);
        if (pid) {
          practiceEnrollmentCount.set(pid, (practiceEnrollmentCount.get(pid) || 0) + row._count.id);
        }
      }

      const data = practices.map((p) => ({
        ...maskPractice(p),
        enrollmentCount: practiceEnrollmentCount.get(p.id) || 0,
      }));

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Practice onboarding pipeline — grouped by stage
router.get(
  '/onboarding-pipeline',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const practices = await prisma.practice.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          _count: {
            select: {
              providers: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Count enrollments per practice via providers
      const enrollmentCounts = await prisma.enrollment.groupBy({
        by: ['providerId'],
        _count: { id: true },
      });

      const providerPractice = await prisma.providerProfile.findMany({
        select: { id: true, practiceId: true },
        where: { practiceId: { not: null } },
      });
      const providerToPractice = new Map(providerPractice.map((p) => [p.id, p.practiceId]));

      const practiceEnrollmentCount = new Map<string, number>();
      for (const row of enrollmentCounts) {
        const practiceId = providerToPractice.get(row.providerId);
        if (practiceId) {
          practiceEnrollmentCount.set(practiceId, (practiceEnrollmentCount.get(practiceId) || 0) + row._count.id);
        }
      }

      const registered: any[] = [];
      const profileComplete: any[] = [];
      const active: any[] = [];

      for (const p of practices) {
        const providerCount = p._count.providers;
        const enrollmentCount = practiceEnrollmentCount.get(p.id) || 0;
        const record = {
          id: p.id,
          name: p.name,
          email: p.email,
          createdAt: p.createdAt,
          providerCount,
          enrollmentCount,
        };

        if (providerCount === 0) {
          registered.push(record);
        } else if (enrollmentCount === 0) {
          profileComplete.push(record);
        } else {
          active.push(record);
        }
      }

      res.json({ success: true, data: { registered, profileComplete, active } });
    } catch (error) {
      next(error);
    }
  }
);

// Get a single practice
router.get(
  '/:practiceId',
  authenticate,
  authorize(...ADMIN_ROLES, 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;

      // Practice-admin can only access their own practice
      if (!req.practiceScope?.isSuperAdmin && !req.practiceScope?.practiceIds?.includes(practiceId)) {
        return res.status(403).json({ success: false, error: { message: 'Insufficient permissions' } });
      }

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
  authorize(...ADMIN_ROLES, 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;

      // Practice-admin can only update their own practice
      if (!req.practiceScope?.isSuperAdmin && !req.practiceScope?.practiceIds?.includes(practiceId)) {
        return res.status(403).json({ success: false, error: { message: 'Insufficient permissions' } });
      }

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
      if (validated.targetPayerIds !== undefined) updateData['targetPayerIds'] = validated.targetPayerIds;

      const practice = await prisma.practice.update({
        where: { id: practiceId },
        data: updateData,
      });

      // When payers are added to targetPayerIds:
      //  1. Seed a PracticePayer row for the new (practice, payer) pair so
      //     the settings UI has something to edit.
      //  2. Auto-create draft enrollments for every provider in the practice.
      // Removed payers are preserved — existing drafts and PracticePayer
      // rows are NOT deleted.
      if (validated.targetPayerIds !== undefined) {
        const before = new Set(existing.targetPayerIds);
        const addedPayerIds = validated.targetPayerIds.filter((id) => !before.has(id));
        if (addedPayerIds.length > 0) {
          await prisma.practicePayer.createMany({
            data: addedPayerIds.map((payerId) => ({ practiceId, payerId })),
            skipDuplicates: true,
          }).catch((err) => {
            logger.warn(`practicePayer seed failed for practice ${practiceId}`, err);
          });
        }
        for (const newPayerId of addedPayerIds) {
          ensureDraftEnrollments({
            practiceId,
            payerId: newPayerId,
            createdById: req.user?.id,
          }).catch((err) => {
            logger.warn(
              `ensureDraftEnrollments failed for practice ${practiceId}, payer ${newPayerId}`,
              err
            );
          });
        }
      }

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
  authorize(...ADMIN_ROLES, 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;

      // Practice-admin can only view users in their own practice
      if (!req.practiceScope?.isSuperAdmin && !req.practiceScope?.practiceIds?.includes(practiceId)) {
        return res.status(403).json({ success: false, error: { message: 'Insufficient permissions' } });
      }

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
