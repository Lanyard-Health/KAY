import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';

// Helper to check enrollment access (staff/admin can access all, providers only their own)
async function assertEnrollmentAccess(req: Request, enrollmentId: string): Promise<void> {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin' || role === 'credentialing_staff') return;

  const enrollment = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { providerId: true },
  });
  if (!enrollment) return; // Let the 404 be handled by the route
  if (role === 'provider' && userProviderId === enrollment.providerId) return;
  throw new ForbiddenError('Access denied to this enrollment');
}

const router = Router();

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
      const payers = await prisma.payer.findMany({
        orderBy: { name: 'asc' },
      });
      res.json({ success: true, data: payers });
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
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enrollments = await prisma.payerEnrollment.findMany({
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
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: enrollments });
    } catch (error) {
      next(error);
    }
  }
);

// Get all enrollments for a provider
router.get(
  '/provider/:providerId',
  authenticate,
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = req.params;

      const enrollments = await prisma.payerEnrollment.findMany({
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
      const { id } = req.params;
      await assertEnrollmentAccess(req, id!);

      const enrollment = await prisma.payerEnrollment.findUnique({
        where: { id },
        include: { payer: true },
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
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = req.params;
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

      // Check if enrollment already exists
      const existingEnrollment = await prisma.payerEnrollment.findUnique({
        where: {
          providerId_payerId: {
            providerId: providerId!,
            payerId: payer.id,
          },
        },
      });

      if (existingEnrollment) {
        return res.status(409).json({
          success: false,
          error: { message: 'Enrollment already exists for this payer' },
        });
      }

      const enrollment = await prisma.payerEnrollment.create({
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
          createdById: req.user?.id,
        },
        include: { payer: true },
      });

      res.status(201).json({ success: true, data: enrollment });
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await assertEnrollmentAccess(req, id!);
      const validated = updateEnrollmentSchema.parse(req.body);

      const existing = await prisma.payerEnrollment.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Enrollment not found' },
        });
      }

      const enrollment = await prisma.payerEnrollment.update({
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
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await prisma.payerEnrollment.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Enrollment not found' },
        });
      }

      await prisma.payerEnrollment.delete({ where: { id } });

      res.json({ success: true, data: { message: 'Enrollment deleted' } });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
