import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import { z } from 'zod';
import { nullablePartial } from '@credential-management/shared';
import { setAuditContext } from '../middleware/audit.middleware.js';
import { logger } from '../utils/logger.js';
import { STAFF_ROLES } from '../constants/roles.js';

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
  authorize(...STAFF_ROLES),
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

// GET /api/v1/payers/demo-availity - Look up the seeded "Availity (DEMO)" payer
// Used by the frontend Availity demo button. Returns 404 if the demo payer
// hasn't been seeded yet — frontend can show "run the seed script" guidance.
payerRoutes.get(
  '/demo-availity',
  authorize(...STAFF_ROLES),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (process.env['NODE_ENV'] === 'production') {
        res.status(404).json({ success: false, error: { message: 'Demo not available in production' } });
        return;
      }
      const payer = await prisma.payer.findUnique({
        where: { payerId: 'AVAILITY-DEMO-001' },
        select: { id: true, name: true, payerId: true },
      });
      if (!payer) {
        res.status(404).json({
          success: false,
          error: { message: 'Demo Availity payer not seeded. Run: npx tsx scripts/seed-demo-availity-payer.ts' },
        });
        return;
      }
      res.json({ success: true, data: payer });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/payers/demo-aetna - Look up the seeded "Aetna (DEMO)" payer
// Mirror of demo-availity. Backs the frontend Aetna demo button.
payerRoutes.get(
  '/demo-aetna',
  authorize(...STAFF_ROLES),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (process.env['NODE_ENV'] === 'production') {
        res.status(404).json({ success: false, error: { message: 'Demo not available in production' } });
        return;
      }
      const payer = await prisma.payer.findUnique({
        where: { payerId: 'AETNA-DEMO-001' },
        select: { id: true, name: true, payerId: true },
      });
      if (!payer) {
        res.status(404).json({
          success: false,
          error: { message: 'Demo Aetna payer not seeded. Run: npx tsx scripts/seed-demo-aetna-payer.ts' },
        });
        return;
      }
      res.json({ success: true, data: payer });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/payers/:id - Get payer details
payerRoutes.get(
  '/:id',
  authorize(...STAFF_ROLES),
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

// POST /api/v1/payers - Create payer
payerRoutes.post(
  '/',
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createPayerSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'payer', action: 'create' });

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
      const data = nullablePartial(createPayerSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'payer', resourceId: req.params['id'], action: 'update' });

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

// @deprecated 2026-03-26 — Use GET /api/v1/enrollments/:providerId instead (includes workflow, SLA, denial triage)
payerRoutes.get(
  '/enrollments/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.warn('Deprecated endpoint called: GET /payers/enrollments/:providerId — use GET /enrollments/:providerId', { user: req.user?.id });
      res.setHeader('X-Deprecated', 'Use GET /api/v1/enrollments/:providerId instead');
      const enrollments = await prisma.enrollment.findMany({
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

// @deprecated 2026-03-26 — Use POST /api/v1/enrollments/:providerId instead (includes workflow, SLA, denial triage)
payerRoutes.post(
  '/enrollments/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.warn('Deprecated endpoint called: POST /payers/enrollments/:providerId — use POST /enrollments/:providerId', { user: req.user?.id });
      res.setHeader('X-Deprecated', 'Use POST /api/v1/enrollments/:providerId instead');
      const data = createEnrollmentSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'enrollment', action: 'create' });

      const enrollment = await prisma.enrollment.create({
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

// @deprecated 2026-03-26 — Use PUT /api/v1/enrollments/:id instead (includes workflow, SLA, denial triage)
payerRoutes.put(
  '/enrollments/update/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.warn('Deprecated endpoint called: PUT /payers/enrollments/update/:id — use PUT /enrollments/:id', { user: req.user?.id });
      res.setHeader('X-Deprecated', 'Use PUT /api/v1/enrollments/:id instead');
      const data = nullablePartial(createEnrollmentSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'enrollment', resourceId: req.params['id'], action: 'update' });

      const existing = await prisma.enrollment.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Enrollment');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Enrollment');

      const enrollment = await prisma.enrollment.update({
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

// @deprecated 2026-03-26 — Use DELETE /api/v1/enrollments/:id instead (includes workflow, SLA, denial triage)
payerRoutes.delete(
  '/enrollments/delete/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.warn('Deprecated endpoint called: DELETE /payers/enrollments/delete/:id — use DELETE /enrollments/:id', { user: req.user?.id });
      res.setHeader('X-Deprecated', 'Use DELETE /api/v1/enrollments/:id instead');
      setAuditContext(req, { resourceType: 'enrollment', resourceId: req.params['id'], action: 'delete' });

      const existing = await prisma.enrollment.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Enrollment');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Enrollment');

      await prisma.enrollment.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'Enrollment deleted' });
    } catch (error) {
      next(error);
    }
  }
);
