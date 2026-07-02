import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { nullablePartial } from '@credential-management/shared';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { STAFF_ROLES } from '../constants/roles.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, getPracticeRelationFilter, validateProviderPracticeAccess, validateEnrollmentAccess, validatePracticeAccess } from '../middleware/practiceScope.middleware.js';
import { triggerTerminationWorkflow } from '../services/terminationWorkflow.service.js';
import { triggerAutomatedEmail } from '../services/automatedEmail.service.js';
import { onEnrollmentCreated } from '../services/enrollment-creation-hook.js';
import { instantiateFollowUp } from '../services/followup-instantiation.service.js';
import { triggerDenialTriage } from '../services/denial-triage.service.js';
import { updateEnrollmentStatus } from '../services/enrollment.service.js';
import { invalidateCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { setAuditContext } from '../middleware/audit.middleware.js';


// Helper to check enrollment access (staff/admin can access all, providers only their own)
async function assertEnrollmentAccess(req: Request, enrollmentId: string): Promise<void> {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin') return;
  if (role === 'credentialing_staff' || role === 'lanyard_staff') {
    const enr = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { providerId: true, practiceId: true } });
    if (!enr) return;
    if (!(await validateEnrollmentAccess(req, enr))) throw new ForbiddenError('Access denied to this enrollment');
    return;
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { providerId: true },
  });
  if (!enrollment) return; // Let the 404 be handled by the route
  if (role === 'provider' && userProviderId === enrollment.providerId) return;
  throw new ForbiddenError('Access denied to this enrollment');
}

const router = Router();

// Guard: block enrollment mutations for pending_verification providers
async function blockPendingVerification(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (user?.role === 'provider' && user.providerId) {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: user.providerId },
      select: { status: true },
    });
    if (provider?.status === 'pending_verification') {
      return res.status(403).json({
        success: false,
        error: { message: 'Enrollment features are available once your account is verified.' },
      });
    }
  }
  next();
}

// Validation schemas
const createPayerSchema = z.object({
  name: z.string().min(1).max(200),
  payerId: z.string().min(1).max(50),
  payerType: z.string().min(1).max(50),
  addressLine1: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(2).optional(),
  zipCode: z.string().max(10).optional(),
  phone: z.string().max(20).optional(),
  website: z.string().url().optional().or(z.literal('')),
  notes: z.string().optional(),
});

const createEnrollmentSchema = z.object({
  payerId: z.string().uuid().optional(),
  payerName: z.string().min(1).max(200), // For free-text payer entry
  status: z.enum(['not_started', 'in_progress', 'submitted', 'pending_review', 'approved', 'denied', 'terminated']).optional(),
  productTypes: z.array(z.string()).optional(),
  applicationDate: z.string().optional().nullable(),
  effectiveDate: z.string().optional().nullable(),
  terminationDate: z.string().optional().nullable(),
  dateContractReceived: z.string().optional().nullable(),
  dateContractSigned: z.string().optional().nullable(),
  lastFollowUpDate: z.string().optional().nullable(),
  recredentialingDate: z.string().optional().nullable(),
  providerNumber: z.string().max(50).optional(),
  groupNumber: z.string().max(50).optional(),
  notes: z.string().optional(),
  workflowType: z.enum(['medical', 'behavioral_health']).optional().nullable(),
  payerTrackId: z.string().uuid().optional().nullable(),
});

const updateEnrollmentSchema = nullablePartial(createEnrollmentSchema);

// ==========================================
// PAYER TRACK OPTIONS (for enrollment form dropdown)
// ==========================================

router.get(
  '/payer-track-options',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const search = (req.query['search'] as string || '').trim();

      const where: Record<string, unknown> = { isActive: true };
      if (search) {
        where['payerName'] = { contains: search, mode: 'insensitive' };
      }

      const tracks = await prisma.payerTrack.findMany({
        where,
        select: {
          id: true,
          payerName: true,
          track: true,
          stateRegion: true,
          payerType: true,
          submissionMethod: true,
        },
        orderBy: [{ payerName: 'asc' }, { track: 'asc' }, { stateRegion: 'asc' }],
        take: 100,
      });

      res.json({ success: true, data: tracks });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// PAYER ROUTES
// ==========================================

// Get all payers
router.get(
  '/payers',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query['pageSize'] as string) || 200));
      const skip = (page - 1) * pageSize;

      const [payers, total] = await Promise.all([
        prisma.payer.findMany({
          orderBy: { name: 'asc' },
          skip,
          take: pageSize,
        }),
        prisma.payer.count(),
      ]);
      res.json({ success: true, data: payers, pagination: { page, pageSize, total } });
    } catch (error) {
      next(error);
    }
  }
);

// Create a payer
router.post(
  '/payers',
  authenticate,
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = createPayerSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'payer', action: 'create' });

      const payer = await prisma.payer.create({
        data: {
          ...validated,
          website: validated.website || null,
        },
      });

      res.status(201).json({ success: true, data: payer });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// ENROLLMENT ROUTES
// ==========================================

// Scope filter for the enrollments list. getPracticeRelationFilter requires a
// non-deleted provider relation, which silently drops practice-level
// (provider-optional) enrollments — those have no provider at all, so they are
// scoped by the enrollment's own practiceId instead.
function enrollmentScopeFilter(req: Request): Record<string, unknown> {
  if (req.practiceScope?.isSuperAdmin) {
    return { OR: [{ providerId: null }, { provider: { deletedAt: null } }] };
  }
  const ids = req.practiceScope?.practiceIds ?? [];
  if (ids.length === 0) return { id: '__no_access__' }; // matches nothing
  return {
    OR: [
      { provider: { practiceId: { in: ids }, deletedAt: null } },
      { providerId: null, practiceId: { in: ids } },
    ],
  };
}

// Get all enrollments across all providers (admin/staff only)
router.get(
  '/',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enrollments = await prisma.enrollment.findMany({
        where: enrollmentScopeFilter(req),
        include: {
          payer: true,
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              npi: true,
              practice: { select: { id: true, name: true } },
            },
          },
          // Direct practice link for practice-level enrollments (no provider)
          practice: { select: { id: true, name: true } },
          workflowSteps: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const data = enrollments.map((e) => ({
        ...e,
        workflowProgress: {
          total: e.workflowSteps?.length || 0,
          completed: e.workflowSteps?.filter((s) => s.status === 'completed' || s.status === 'skipped').length || 0,
        },
        workflowSteps: undefined,
      }));

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Get all enrollments for a provider
router.get(
  '/provider/:providerId',
  authenticate,
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const enrollments = await prisma.enrollment.findMany({
        where: { providerId },
        include: { payer: true },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: enrollments });
    } catch (error) {
      next(error);
    }
  }
);

// Get a single enrollment
router.get(
  '/:id',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;
      await assertEnrollmentAccess(req, id);

      const enrollment = await prisma.enrollment.findUnique({
        where: { id },
        include: {
          payer: true,
          provider: {
            select: { id: true, firstName: true, lastName: true, npi: true, providerType: true },
          },
        },
      });

      if (!enrollment) {
        return res.status(404).json({
          success: false,
          error: { message: 'Enrollment not found' },
        });
      }

      res.json({ success: true, data: enrollment });
    } catch (error) {
      next(error);
    }
  }
);

// Create enrollment for a provider
router.post(
  '/provider/:providerId',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  blockPendingVerification,
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const validated = createEnrollmentSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'enrollment', action: 'create' });

      // First, find or create the payer
      let payer = validated.payerId
        ? await prisma.payer.findUnique({ where: { id: validated.payerId } })
        : await prisma.payer.findFirst({ where: { name: validated.payerName } });

      if (!payer) {
        // Create a new payer with free-text name
        const payerIdSlug = validated.payerName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .substring(0, 50);

        payer = await prisma.payer.create({
          data: {
            name: validated.payerName,
            payerId: `custom-${payerIdSlug}-${Date.now()}`,
            payerType: 'insurance',
          },
        });
      }

      // Resolve payerTrackId: use explicit value, or fuzzy-match by payer name
      let resolvedPayerTrackId = validated.payerTrackId || null;
      if (!resolvedPayerTrackId && validated.payerName) {
        const matches = await prisma.payerTrack.findMany({
          where: {
            payerName: { equals: validated.payerName, mode: 'insensitive' },
            isActive: true,
          },
          select: { id: true },
        });
        if (matches.length === 1) {
          resolvedPayerTrackId = matches[0]!.id;
        }
      }

      // Look up practice SLA target days for the SLA deadline
      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
        select: { practiceId: true },
      });
      const slaTargetDays = 90;
      const slaTargetDate = new Date(Date.now() + slaTargetDays * 86_400_000);

      let enrollment;
      try {
        enrollment = await prisma.enrollment.create({
          data: {
            subjectType: 'PROVIDER',
            providerId: providerId!,
            payerId: payer.id,
            status: validated.status || 'not_started',
            productTypes: validated.productTypes || [],
            applicationDate: validated.applicationDate ? new Date(validated.applicationDate) : null,
            effectiveDate: validated.effectiveDate ? new Date(validated.effectiveDate) : null,
            terminationDate: validated.terminationDate ? new Date(validated.terminationDate) : null,
            dateContractReceived: validated.dateContractReceived ? new Date(validated.dateContractReceived) : null,
            dateContractSigned: validated.dateContractSigned ? new Date(validated.dateContractSigned) : null,
            lastFollowUpDate: validated.lastFollowUpDate ? new Date(validated.lastFollowUpDate) : null,
            recredentialingDate: validated.recredentialingDate ? new Date(validated.recredentialingDate) : null,
            providerNumber: validated.providerNumber,
            groupNumber: validated.groupNumber,
            notes: validated.notes,
            payerTrackId: resolvedPayerTrackId,
            createdById: req.user?.id,
            slaTargetDate,
          },
          include: {
            payer: { select: { id: true, name: true, payerId: true, payerType: true } },
            provider: { select: { providerType: true } },
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          return res.status(409).json({
            success: false,
            error: { message: 'Enrollment already exists for this payer' },
          });
        }
        throw err;
      }

      // Seed the practice-payer settings row so this payer shows on the
      // practice's Payers tab even if it was never picked as a target payer
      // in Settings. Non-blocking — the enrollment itself already succeeded.
      if (provider?.practiceId) {
        await prisma.practicePayer
          .createMany({
            data: [{ practiceId: provider.practiceId, payerId: payer.id }],
            skipDuplicates: true,
          })
          .catch((err) =>
            logger.warn(`practicePayer seed failed for practice ${provider.practiceId}`, err)
          );
      }

      // Auto-hydrate workflow steps if the payer has a template
      const workflow = await onEnrollmentCreated(prisma, enrollment, validated.workflowType);

      // Trigger first-enrollment email (non-blocking)
      if (provider?.practiceId) {
        const enrollmentCount = await prisma.enrollment.count({
          where: { provider: { practiceId: provider.practiceId } },
        });
        if (enrollmentCount === 1) {
          triggerAutomatedEmail('FIRST_ENROLLMENT_SUBMITTED', provider.practiceId)
            .catch((err) => logger.error('Failed to trigger first-enrollment email:', err));
        }
      }

      invalidateCache('dashboard');
      invalidateCache('payer-analytics');
      res.status(201).json({
        success: true,
        data: {
          ...enrollment,
          workflow: {
            stepsCreated: workflow.stepsCreated,
            templateFound: workflow.templateFound,
            workflowType: workflow.workflowType,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Create enrollment for a PRACTICE (group / state Medicaid) — no individual provider.
// Mirrors the provider create route; the provider-readiness gate and provider-scope
// middleware don't apply, so access is checked against the practice directly.
router.post(
  '/practice/:practiceId',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;
      const validated = createEnrollmentSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'enrollment', action: 'create' });

      // Authz: caller must own this practice (super admins / staff pass)
      if (!validatePracticeAccess(req, practiceId)) {
        return res.status(403).json({ success: false, error: { message: 'Access denied — practice not in your scope' } });
      }

      // Practice must exist and not be soft-deleted
      const practice = await prisma.practice.findFirst({
        where: { id: practiceId, deletedAt: null },
        select: { id: true },
      });
      if (!practice) {
        return res.status(404).json({ success: false, error: { message: 'Practice not found' } });
      }

      // Find or create the payer (same as the provider flow)
      let payer = validated.payerId
        ? await prisma.payer.findUnique({ where: { id: validated.payerId } })
        : await prisma.payer.findFirst({ where: { name: validated.payerName } });

      if (!payer) {
        const payerIdSlug = validated.payerName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .substring(0, 50);

        payer = await prisma.payer.create({
          data: {
            name: validated.payerName,
            payerId: `custom-${payerIdSlug}-${Date.now()}`,
            payerType: 'insurance',
          },
        });
      }

      // Resolve payerTrackId: explicit value, or fuzzy-match by payer name.
      // (Provider-type-based resolution doesn't apply — practice enrollments have none.)
      let resolvedPayerTrackId = validated.payerTrackId || null;
      if (!resolvedPayerTrackId && validated.payerName) {
        const matches = await prisma.payerTrack.findMany({
          where: { payerName: { equals: validated.payerName, mode: 'insensitive' }, isActive: true },
          select: { id: true },
        });
        if (matches.length === 1) {
          resolvedPayerTrackId = matches[0]!.id;
        }
      }

      const slaTargetDate = new Date(Date.now() + 90 * 86_400_000);

      let enrollment;
      try {
        enrollment = await prisma.enrollment.create({
          data: {
            subjectType: 'PRACTICE',
            practiceId,
            payerId: payer.id,
            status: validated.status || 'not_started',
            productTypes: validated.productTypes || [],
            applicationDate: validated.applicationDate ? new Date(validated.applicationDate) : null,
            effectiveDate: validated.effectiveDate ? new Date(validated.effectiveDate) : null,
            terminationDate: validated.terminationDate ? new Date(validated.terminationDate) : null,
            dateContractReceived: validated.dateContractReceived ? new Date(validated.dateContractReceived) : null,
            dateContractSigned: validated.dateContractSigned ? new Date(validated.dateContractSigned) : null,
            lastFollowUpDate: validated.lastFollowUpDate ? new Date(validated.lastFollowUpDate) : null,
            recredentialingDate: validated.recredentialingDate ? new Date(validated.recredentialingDate) : null,
            providerNumber: validated.providerNumber,
            groupNumber: validated.groupNumber,
            notes: validated.notes,
            payerTrackId: resolvedPayerTrackId,
            createdById: req.user?.id,
            slaTargetDate,
          },
          include: {
            payer: { select: { id: true, name: true, payerId: true, payerType: true } },
            practice: { select: { id: true, name: true } },
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          return res.status(409).json({
            success: false,
            error: { message: 'Enrollment already exists for this practice and payer' },
          });
        }
        throw err;
      }

      // Auto-hydrate workflow steps if a payer track resolved to a template.
      const workflow = await onEnrollmentCreated(prisma, enrollment, validated.workflowType);

      invalidateCache('dashboard');
      invalidateCache('payer-analytics');
      res.status(201).json({
        success: true,
        data: {
          ...enrollment,
          workflow: {
            stepsCreated: workflow.stepsCreated,
            templateFound: workflow.templateFound,
            workflowType: workflow.workflowType,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update enrollment
router.put(
  '/:id',
  authenticate,
  blockPendingVerification,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;
      await assertEnrollmentAccess(req, id);
      const validated = updateEnrollmentSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'enrollment', resourceId: id, action: 'update' });

      // Non-status field updates
      const { status: newStatus, ...fieldUpdates } = validated;
      const hasFieldUpdates = Object.values(fieldUpdates).some((v) => v !== undefined);

      let enrollment;

      if (hasFieldUpdates) {
        const existing = await prisma.enrollment.findUnique({ where: { id } });
        if (!existing) {
          return res.status(404).json({
            success: false,
            error: { message: 'Enrollment not found' },
          });
        }

        enrollment = await prisma.enrollment.update({
          where: { id },
          data: {
            productTypes: fieldUpdates.productTypes,
            applicationDate: fieldUpdates.applicationDate ? new Date(fieldUpdates.applicationDate) : undefined,
            effectiveDate: fieldUpdates.effectiveDate ? new Date(fieldUpdates.effectiveDate) : undefined,
            terminationDate: fieldUpdates.terminationDate ? new Date(fieldUpdates.terminationDate) : undefined,
            dateContractReceived: fieldUpdates.dateContractReceived ? new Date(fieldUpdates.dateContractReceived) : undefined,
            dateContractSigned: fieldUpdates.dateContractSigned ? new Date(fieldUpdates.dateContractSigned) : undefined,
            lastFollowUpDate: fieldUpdates.lastFollowUpDate ? new Date(fieldUpdates.lastFollowUpDate) : undefined,
            recredentialingDate: fieldUpdates.recredentialingDate ? new Date(fieldUpdates.recredentialingDate) : undefined,
            providerNumber: fieldUpdates.providerNumber,
            groupNumber: fieldUpdates.groupNumber,
            notes: fieldUpdates.notes,
            updatedById: req.user?.id,
          },
          include: { payer: true },
        });

        // Trigger termination workflow when terminationDate transitions from null → value
        if (
          fieldUpdates.terminationDate &&
          !existing.terminationDate &&
          enrollment.terminationDate &&
          enrollment.providerId
        ) {
          triggerTerminationWorkflow(enrollment.providerId, enrollment.id)
            .catch((err) => logger.error('Termination workflow trigger failed:', err));
        }
      }

      // Delegate status transition to the service
      if (newStatus) {
        enrollment = await updateEnrollmentStatus(id, newStatus, req.user!.id, {
          notes: validated.notes,
          triggerDenialTriage: true,
        });
      }

      // If neither field updates nor status change, just fetch and return
      if (!enrollment) {
        enrollment = await prisma.enrollment.findUnique({
          where: { id },
          include: { payer: true },
        });
        if (!enrollment) {
          return res.status(404).json({
            success: false,
            error: { message: 'Enrollment not found' },
          });
        }
      }

      res.json({ success: true, data: enrollment });
    } catch (error) {
      next(error);
    }
  }
);

// Delete enrollment (admin/staff only)
router.delete(
  '/:id',
  authenticate,
  blockPendingVerification,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;

      setAuditContext(req, { resourceType: 'enrollment', resourceId: id, action: 'delete' });

      const existing = await prisma.enrollment.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Enrollment not found' },
        });
      }

      if (!(await validateEnrollmentAccess(req, existing))) {
        return res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
      }

      await prisma.enrollment.delete({ where: { id } });

      invalidateCache('dashboard');
      invalidateCache('payer-analytics');
      res.json({ success: true, data: { message: 'Enrollment deleted' } });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
