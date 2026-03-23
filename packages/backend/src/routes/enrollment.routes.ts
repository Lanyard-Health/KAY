import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, getPracticeRelationFilter, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import { triggerTerminationWorkflow } from '../services/terminationWorkflow.service.js';
import { onEnrollmentCreated } from '../services/enrollment-creation-hook.js';
import { instantiateFollowUp } from '../services/followup-instantiation.service.js';
import { triggerDenialTriage } from '../services/denial-triage.service.js';
import { invalidateCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';


// Helper to check enrollment access (staff/admin can access all, providers only their own)
async function assertEnrollmentAccess(req: Request, enrollmentId: string): Promise<void> {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin') return;
  if (role === 'credentialing_staff') {
    const enr = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { providerId: true } });
    if (!enr) return;
    if (!(await validateProviderPracticeAccess(req, enr.providerId))) throw new ForbiddenError('Access denied to this enrollment');
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

const updateEnrollmentSchema = createEnrollmentSchema.partial();

// ==========================================
// PAYER ROUTES
// ==========================================

// Get all payers
router.get(
  '/payers',
  authenticate,
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = createPayerSchema.parse(req.body);

      const payer = await prisma.payer.create({
        data: {
          ...validated,
          website: validated.website || null,
        },
      });

      res.status(201).json({ success: true, data: payer });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', details: error.errors },
        });
      }
      next(error);
    }
  }
);

// ==========================================
// ENROLLMENT ROUTES
// ==========================================

// Get all enrollments across all providers (admin/staff only)
router.get(
  '/',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enrollments = await prisma.enrollment.findMany({
        where: getPracticeRelationFilter(req),
        include: {
          payer: true,
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              npi: true,
            },
          },
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
  blockPendingVerification,
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const validated = createEnrollmentSchema.parse(req.body);

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
            payerTrackId: validated.payerTrackId || null,
            createdById: req.user?.id,
            slaTargetDate,
          },
          include: {
            payer: { select: { id: true, name: true, payerId: true, payerType: true, workflowKey: true } },
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

      // Auto-hydrate workflow steps if the payer has a template
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
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', details: error.errors },
        });
      }
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

      const existing = await prisma.enrollment.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Enrollment not found' },
        });
      }

      const enrollment = await prisma.enrollment.update({
        where: { id },
        data: {
          status: validated.status,
          productTypes: validated.productTypes,
          applicationDate: validated.applicationDate ? new Date(validated.applicationDate) : undefined,
          effectiveDate: validated.effectiveDate ? new Date(validated.effectiveDate) : undefined,
          terminationDate: validated.terminationDate ? new Date(validated.terminationDate) : undefined,
          dateContractReceived: validated.dateContractReceived ? new Date(validated.dateContractReceived) : undefined,
          dateContractSigned: validated.dateContractSigned ? new Date(validated.dateContractSigned) : undefined,
          lastFollowUpDate: validated.lastFollowUpDate ? new Date(validated.lastFollowUpDate) : undefined,
          recredentialingDate: validated.recredentialingDate ? new Date(validated.recredentialingDate) : undefined,
          providerNumber: validated.providerNumber,
          groupNumber: validated.groupNumber,
          notes: validated.notes,
          updatedById: req.user?.id,
        },
        include: { payer: true },
      });

      // Trigger termination workflow when terminationDate transitions from null → value
      if (
        validated.terminationDate &&
        !existing.terminationDate &&
        enrollment.terminationDate
      ) {
        triggerTerminationWorkflow(enrollment.providerId, enrollment.id)
          .catch((err) => logger.error('Termination workflow trigger failed:', err));
      }

      // Trigger follow-up instantiation when status transitions to 'submitted'
      if (
        validated.status === 'submitted' &&
        existing.status !== 'submitted' &&
        existing.payerTrackId
      ) {
        instantiateFollowUp(prisma, enrollment.id, existing.payerTrackId)
          .then((result) => {
            if (result.runCreated) {
              logger.info(`Follow-up run created for enrollment ${enrollment.id}: ${result.runId}`);
            }
          })
          .catch((err) => logger.error(`Follow-up instantiation failed for enrollment ${enrollment.id}:`, err));
      }

      // Trigger denial triage when status transitions to 'denied'
      if (
        validated.status === 'denied' &&
        existing.status !== 'denied'
      ) {
        triggerDenialTriage(prisma, {
          enrollmentId: enrollment.id,
          denialReason: validated.notes || 'No denial reason provided',
          denialDate: new Date(),
        })
          .then((result) => {
            if (result.triageCreated) {
              logger.info(`Denial triage created for enrollment ${enrollment.id}: ${result.triageId}`);
            }
          })
          .catch((err) => logger.error(`Denial triage failed for enrollment ${enrollment.id}:`, err));
      }

      invalidateCache('dashboard');
      invalidateCache('payer-analytics');
      res.json({ success: true, data: enrollment });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', details: error.errors },
        });
      }
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

      const existing = await prisma.enrollment.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Enrollment not found' },
        });
      }

      if (!(await validateProviderPracticeAccess(req, existing.providerId))) {
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
