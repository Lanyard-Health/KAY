import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { z } from 'zod';

export const payerRoutes = Router();

payerRoutes.use(authenticate);

const createPayerSchema = z.object({
  name: z.string().min(1),
  payerId: z.string().min(1),
  payerType: z.string().min(1),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  notes: z.string().optional(),
});

const createEnrollmentSchema = z.object({
  payerId: z.string().uuid(),
  status: z.enum([
    'not_started',
    'in_progress',
    'submitted',
    'pending_review',
    'approved',
    'denied',
    'terminated',
  ]).optional(),
  applicationDate: z.string().optional(),
  effectiveDate: z.string().optional(),
  providerNumber: z.string().optional(),
  groupNumber: z.string().optional(),
  notes: z.string().optional(),
});

// ==========================================
// PAYERS
// ==========================================

// GET /api/v1/payers - List all payers
payerRoutes.get(
  '/',
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

// GET /api/v1/payers/:id - Get payer details
payerRoutes.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payer = await prisma.payer.findUnique({
        where: { id: req.params['id'] },
        include: {
          _count: {
            select: { enrollments: true },
          },
        },
      });

      if (!payer) {
        throw new NotFoundError('Payer');
      }

      res.json({ success: true, data: payer });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/payers - Create payer (admin only)
payerRoutes.post(
  '/',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createPayerSchema.parse(req.body);

      const payer = await prisma.payer.create({
        data,
      });

      res.status(201).json({ success: true, data: payer });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/payers/:id - Update payer
payerRoutes.put(
  '/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createPayerSchema.partial().parse(req.body);

      const payer = await prisma.payer.update({
        where: { id: req.params['id'] },
        data,
      });

      res.json({ success: true, data: payer });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// ENROLLMENTS
// ==========================================

// GET /api/v1/payers/enrollments/:providerId - Get provider enrollments
payerRoutes.get(
  '/enrollments/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enrollments = await prisma.payerEnrollment.findMany({
        where: { providerId: req.params['providerId'] },
        include: {
          payer: true,
        },
        orderBy: { payer: { name: 'asc' } },
      });

      res.json({ success: true, data: enrollments });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/payers/enrollments/:providerId - Create enrollment
payerRoutes.post(
  '/enrollments/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createEnrollmentSchema.parse(req.body);

      const enrollment = await prisma.payerEnrollment.create({
        data: {
          providerId: req.params['providerId']!,
          payerId: data.payerId,
          status: data.status || 'not_started',
          ...(data.applicationDate && { applicationDate: new Date(data.applicationDate) }),
          ...(data.effectiveDate && { effectiveDate: new Date(data.effectiveDate) }),
          providerNumber: data.providerNumber,
          groupNumber: data.groupNumber,
          notes: data.notes,
          createdById: req.user?.id,
        },
        include: {
          payer: true,
        },
      });

      res.status(201).json({ success: true, data: enrollment });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/payers/enrollments/:id - Update enrollment
payerRoutes.put(
  '/enrollments/update/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createEnrollmentSchema.partial().parse(req.body);

      const enrollment = await prisma.payerEnrollment.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.applicationDate && { applicationDate: new Date(data.applicationDate) }),
          ...(data.effectiveDate && { effectiveDate: new Date(data.effectiveDate) }),
          updatedById: req.user?.id,
        },
        include: {
          payer: true,
        },
      });

      res.json({ success: true, data: enrollment });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/payers/enrollments/:id - Delete enrollment
payerRoutes.delete(
  '/enrollments/delete/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.payerEnrollment.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'Enrollment deleted' });
    } catch (error) {
      next(error);
    }
  }
);
