import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireProviderAccess, authorize } from '../middleware/auth.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import {
  createLicenseSchema,
  createBoardCertificationSchema,
  createMalpracticeInsuranceSchema,
  createEducationSchema,
  createWorkHistorySchema,
} from '@credential-management/shared';

export const credentialRoutes = Router();

credentialRoutes.use(authenticate);

// ==========================================
// LICENSES
// ==========================================

// GET /api/v1/credentials/licenses/:providerId
credentialRoutes.get(
  '/licenses/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const licenses = await prisma.license.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { expirationDate: 'asc' },
      });

      res.json({ success: true, data: licenses });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/credentials/licenses/:providerId
credentialRoutes.post(
  '/licenses/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createLicenseSchema.parse(req.body);

      const license = await prisma.license.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          issueDate: new Date(data.issueDate),
          expirationDate: new Date(data.expirationDate),
          createdById: req.user?.id,
        },
      });

      res.status(201).json({ success: true, data: license });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/credentials/licenses/:id
credentialRoutes.put(
  '/licenses/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createLicenseSchema.partial().parse(req.body);

      const existing = await prisma.license.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('License');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('License');

      const license = await prisma.license.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.issueDate && { issueDate: new Date(data.issueDate) }),
          ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
          updatedById: req.user?.id,
        },
      });

      res.json({ success: true, data: license });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/credentials/licenses/:id
credentialRoutes.delete(
  '/licenses/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.license.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('License');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('License');

      await prisma.license.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'License deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// BOARD CERTIFICATIONS
// ==========================================

// GET /api/v1/credentials/certifications/:providerId
credentialRoutes.get(
  '/certifications/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const certifications = await prisma.boardCertification.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { expirationDate: 'asc' },
      });

      res.json({ success: true, data: certifications });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/credentials/certifications/:providerId
credentialRoutes.post(
  '/certifications/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createBoardCertificationSchema.parse(req.body);

      const certification = await prisma.boardCertification.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          initialCertificationDate: new Date(data.initialCertificationDate),
          ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
          createdById: req.user?.id,
        },
      });

      res.status(201).json({ success: true, data: certification });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/credentials/certifications/:id
credentialRoutes.put(
  '/certifications/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createBoardCertificationSchema.partial().parse(req.body);

      const existing = await prisma.boardCertification.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Board certification');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Board certification');

      const certification = await prisma.boardCertification.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.initialCertificationDate && { initialCertificationDate: new Date(data.initialCertificationDate) }),
          ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
          updatedById: req.user?.id,
        },
      });

      res.json({ success: true, data: certification });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/credentials/certifications/:id
credentialRoutes.delete(
  '/certifications/:id',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.boardCertification.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Board certification');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Board certification');

      await prisma.boardCertification.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'Board certification deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// MALPRACTICE INSURANCE
// ==========================================

// GET /api/v1/credentials/malpractice/:providerId
credentialRoutes.get(
  '/malpractice/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const insurance = await prisma.malpracticeInsurance.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { expirationDate: 'asc' },
      });

      res.json({ success: true, data: insurance });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/credentials/malpractice/:providerId
credentialRoutes.post(
  '/malpractice/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createMalpracticeInsuranceSchema.parse(req.body);

      const insurance = await prisma.malpracticeInsurance.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          effectiveDate: new Date(data.effectiveDate),
          expirationDate: new Date(data.expirationDate),
          createdById: req.user?.id,
        },
      });

      res.status(201).json({ success: true, data: insurance });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// EDUCATION
// ==========================================

// GET /api/v1/credentials/education/:providerId
credentialRoutes.get(
  '/education/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const education = await prisma.education.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { graduationDate: 'desc' },
      });

      res.json({ success: true, data: education });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/credentials/education/:providerId
credentialRoutes.post(
  '/education/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createEducationSchema.parse(req.body);

      const education = await prisma.education.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          startDate: new Date(data.startDate),
          ...(data.endDate && { endDate: new Date(data.endDate) }),
          ...(data.graduationDate && { graduationDate: new Date(data.graduationDate) }),
          createdById: req.user?.id,
        },
      });

      res.status(201).json({ success: true, data: education });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// WORK HISTORY
// ==========================================

// GET /api/v1/credentials/work-history/:providerId
credentialRoutes.get(
  '/work-history/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workHistory = await prisma.workHistory.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { startDate: 'desc' },
      });

      res.json({ success: true, data: workHistory });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/credentials/work-history/:providerId
credentialRoutes.post(
  '/work-history/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createWorkHistorySchema.parse(req.body);

      const workHistory = await prisma.workHistory.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          startDate: new Date(data.startDate),
          ...(data.endDate && { endDate: new Date(data.endDate) }),
          createdById: req.user?.id,
        },
      });

      res.status(201).json({ success: true, data: workHistory });
    } catch (error) {
      next(error);
    }
  }
);
