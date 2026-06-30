import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { setAuditContext } from '../middleware/audit.middleware.js';
import { decryptSafe, encryptSafe } from '../utils/crypto.js';
import { ensureDraftEnrollments } from '../services/draft-enrollment.service.js';
import { softDeletePractice, restorePractice } from '../services/practice.service.js';
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

// Group-intake scalar fields shared by create + update. Empty string clears the column.
const INTAKE_KEYS = [
  'legalName', 'dba', 'entityType', 'groupNpi', 'groupSpecialty', 'emrVendor', 'billingVendor', 'billingClearinghouse',
  'addressLine1', 'addressLine2', 'city', 'state', 'zipCode',
  'billingAddressLine1', 'billingAddressLine2', 'billingCity', 'billingState', 'billingZipCode',
  'mailingAddressLine1', 'mailingAddressLine2', 'mailingCity', 'mailingState', 'mailingZipCode',
] as const;

function applyIntakeFields(target: Record<string, unknown>, v: Record<string, any>) {
  for (const k of INTAKE_KEYS) {
    if (v[k] !== undefined) target[k] = v[k] === '' ? null : v[k];
  }
}

// TIN follows the ProviderBanking convention: encrypted value + last-4 for display.
function applyTaxId(target: Record<string, unknown>, taxId: string | undefined | null) {
  if (taxId === undefined) return;
  if (taxId) {
    target['taxIdEncrypted'] = encryptSafe(taxId);
    target['taxIdLast4'] = taxId.replace(/\D/g, '').slice(-4) || null;
  } else {
    target['taxIdEncrypted'] = null;
    target['taxIdLast4'] = null;
  }
}

const router = Router();

// Shared optional-string field for the group intake fields. Empty string is
// treated as "not provided" so a cleared input clears the column.
const optStr = (max: number) => z.string().max(max).optional().or(z.literal(''));

// Group-profile intake fields shared by create + update (all optional).
const groupIntakeFields = {
  legalName: optStr(200),
  dba: optStr(200),
  entityType: optStr(100),
  groupNpi: z.string().regex(/^\d{10}$/, 'Group NPI must be 10 digits').optional().or(z.literal('')),
  groupSpecialty: optStr(120),
  emrVendor: optStr(120),
  billingVendor: optStr(120),
  billingClearinghouse: optStr(120),
  // Office (primary) address
  addressLine1: optStr(200),
  addressLine2: optStr(200),
  city: optStr(100),
  state: optStr(2),
  zipCode: optStr(10),
  // Billing address
  billingAddressLine1: optStr(200),
  billingAddressLine2: optStr(200),
  billingCity: optStr(100),
  billingState: optStr(2),
  billingZipCode: optStr(10),
  // Mailing address
  mailingAddressLine1: optStr(200),
  mailingAddressLine2: optStr(200),
  mailingCity: optStr(100),
  mailingState: optStr(2),
  mailingZipCode: optStr(10),
};

// Validation schemas
const createPracticeSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().max(500).optional().or(z.literal('')),
  notes: z.string().max(2000).optional(),
  taxId: z.string().max(20).optional(),
  ...groupIntakeFields,
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
  ...groupIntakeFields,
});

const assignUserSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['SUPER_ADMIN', 'PRACTICE_ADMIN', 'PRACTICE_STAFF', 'PROVIDER']),
});

// List all practices (super admin only)
router.get(
  '/',
  authenticate,
  // lanyard_staff (cross-practice Lanyard employees) view all practices
  authorize(...ADMIN_ROLES, 'lanyard_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const includeDeleted = req.query['includeDeleted'] === 'true' && req.practiceScope?.isSuperAdmin;
      const practices = await prisma.practice.findMany({
        where: includeDeleted ? {} : { deletedAt: null },
        include: {
          _count: {
            select: {
              users: true,
              // Exclude soft-deleted providers from the practice count — Prisma's _count.select
              // does NOT inherit the providerProfile query extension, so we filter here.
              providers: { where: { deletedAt: null } },
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
  authorize(...ADMIN_ROLES, 'lanyard_staff'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const practices = await prisma.practice.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          _count: {
            select: {
              // Exclude soft-deleted providers — Prisma's _count.select doesn't inherit the extension.
              providers: { where: { deletedAt: null } },
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
  authorize(...ADMIN_ROLES, 'lanyard_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;

      // Practice-admin can only access their own practice
      if (!req.practiceScope?.isSuperAdmin && !req.practiceScope?.practiceIds?.includes(practiceId)) {
        return res.status(403).json({ success: false, error: { message: 'Insufficient permissions' } });
      }

      const includeDeleted = req.query['includeDeleted'] === 'true' && req.practiceScope?.isSuperAdmin;
      const practice = await prisma.practice.findUnique({
        where: { id: practiceId },
        include: {
          _count: {
            select: {
              users: true,
              // Exclude soft-deleted providers from the practice count — Prisma's _count.select
              // does NOT inherit the providerProfile query extension, so we filter here.
              providers: { where: { deletedAt: null } },
              practiceLocations: true,
            },
          },
        },
      });

      if (!practice || (!includeDeleted && practice.deletedAt)) {
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
  // lanyard_staff (cross-practice Lanyard employees) create practices — mirrors GET / view access
  authorize(...ADMIN_ROLES, 'lanyard_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = createPracticeSchema.parse(req.body);

      setAuditContext(req, {
        resourceType: 'practice',
        action: 'create',
      });

      const createData: Record<string, unknown> = {
        name: validated.name,
        phone: validated.phone || null,
        email: validated.email || null,
        website: validated.website || null,
        notes: validated.notes || null,
      };
      applyIntakeFields(createData, validated);
      applyTaxId(createData, validated.taxId);

      const practice = await prisma.practice.create({ data: createData as any });

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
  authorize(...ADMIN_ROLES, 'lanyard_staff', 'practice_admin'),
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
      applyTaxId(updateData, validated.taxId);
      applyIntakeFields(updateData, validated);
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
  authorize(...ADMIN_ROLES, 'lanyard_staff', 'practice_admin'),
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
  authorize(...ADMIN_ROLES, 'lanyard_staff'),
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
  authorize(...ADMIN_ROLES, 'lanyard_staff'),
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

// DELETE /api/v1/practices/:practiceId?reason=<urlencoded> - Soft-delete practice
// Reason is a query param (not body) because some proxies strip DELETE bodies.
router.delete(
  '/:practiceId',
  authenticate,
  authorize(...ADMIN_ROLES, 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;

      // Practice-admin can only delete their own practice
      if (!req.practiceScope?.isSuperAdmin && !req.practiceScope?.practiceIds?.includes(practiceId)) {
        return res.status(403).json({ success: false, error: { message: 'Insufficient permissions' } });
      }

      const rawReason = typeof req.query['reason'] === 'string' ? req.query['reason'] : null;
      if (rawReason && rawReason.length > 2000) {
        return res.status(400).json({ success: false, error: { message: 'reason too long' } });
      }

      setAuditContext(req, {
        resourceType: 'practice',
        resourceId: practiceId,
        action: 'delete',
      });

      try {
        const { practice, wasAlreadyDeleted } = await softDeletePractice({
          practiceId,
          actorId: req.user?.id,
          reason: rawReason,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.get('user-agent'),
        });
        res.json({
          success: true,
          data: {
            practice: maskPractice(practice),
            alreadyDeleted: wasAlreadyDeleted,
          },
        });
      } catch (e) {
        if ((e as Error).message === 'PRACTICE_NOT_FOUND') {
          return res.status(404).json({ success: false, error: { message: 'Practice not found' } });
        }
        throw e;
      }
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/practices/:practiceId/restore - Restore a soft-deleted practice
router.post(
  '/:practiceId/restore',
  authenticate,
  authorize(...ADMIN_ROLES, 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;

      if (!req.practiceScope?.isSuperAdmin && !req.practiceScope?.practiceIds?.includes(practiceId)) {
        return res.status(403).json({ success: false, error: { message: 'Insufficient permissions' } });
      }

      setAuditContext(req, {
        resourceType: 'practice',
        resourceId: practiceId,
        action: 'update',
      });

      try {
        const { practice, wasAlreadyActive } = await restorePractice({
          practiceId,
          actorId: req.user?.id,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.get('user-agent'),
        });
        res.json({
          success: true,
          data: {
            practice: maskPractice(practice),
            alreadyActive: wasAlreadyActive,
          },
        });
      } catch (e) {
        if ((e as Error).message === 'PRACTICE_NOT_FOUND') {
          return res.status(404).json({ success: false, error: { message: 'Practice not found' } });
        }
        throw e;
      }
    } catch (error) {
      next(error);
    }
  }
);

export default router;
