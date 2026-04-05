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
import { setAuditContext } from '../middleware/audit.middleware.js';

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

      setAuditContext(req, { resourceType: 'license', action: 'create' });

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
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createLicenseSchema.partial().parse(req.body);

      setAuditContext(req, { resourceType: 'license', resourceId: req.params['id'], action: 'update' });

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
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'license', resourceId: req.params['id'], action: 'delete' });

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

      setAuditContext(req, { resourceType: 'board_certification', action: 'create' });

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
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createBoardCertificationSchema.partial().parse(req.body);

      setAuditContext(req, { resourceType: 'board_certification', resourceId: req.params['id'], action: 'update' });

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
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'board_certification', resourceId: req.params['id'], action: 'delete' });

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

      setAuditContext(req, { resourceType: 'malpractice_insurance', action: 'create' });

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

// PUT /api/v1/credentials/malpractice/:id
credentialRoutes.put(
  '/malpractice/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createMalpracticeInsuranceSchema.partial().parse(req.body);

      setAuditContext(req, { resourceType: 'malpractice_insurance', resourceId: req.params['id'], action: 'update' });

      const existing = await prisma.malpracticeInsurance.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Malpractice insurance');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Malpractice insurance');

      const insurance = await prisma.malpracticeInsurance.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.effectiveDate && { effectiveDate: new Date(data.effectiveDate) }),
          ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
          ...(data.retroactiveDate && { retroactiveDate: new Date(data.retroactiveDate) }),
          updatedById: req.user?.id,
        },
      });

      res.json({ success: true, data: insurance });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/credentials/malpractice/:id
credentialRoutes.delete(
  '/malpractice/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'malpractice_insurance', resourceId: req.params['id'], action: 'delete' });

      const existing = await prisma.malpracticeInsurance.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Malpractice insurance');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Malpractice insurance');

      await prisma.malpracticeInsurance.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'Malpractice insurance deleted' });
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

      setAuditContext(req, { resourceType: 'education', action: 'create' });

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

// PUT /api/v1/credentials/education/:id
credentialRoutes.put(
  '/education/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createEducationSchema.partial().parse(req.body);

      setAuditContext(req, { resourceType: 'education', resourceId: req.params['id'], action: 'update' });

      const existing = await prisma.education.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Education');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Education');

      const education = await prisma.education.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.startDate && { startDate: new Date(data.startDate) }),
          ...(data.endDate && { endDate: new Date(data.endDate) }),
          ...(data.graduationDate && { graduationDate: new Date(data.graduationDate) }),
          updatedById: req.user?.id,
        },
      });

      res.json({ success: true, data: education });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/credentials/education/:id
credentialRoutes.delete(
  '/education/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'education', resourceId: req.params['id'], action: 'delete' });

      const existing = await prisma.education.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Education');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Education');

      await prisma.education.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'Education deleted' });
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

      setAuditContext(req, { resourceType: 'work_history', action: 'create' });

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

// PUT /api/v1/credentials/work-history/:id
credentialRoutes.put(
  '/work-history/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createWorkHistorySchema.partial().parse(req.body);

      setAuditContext(req, { resourceType: 'work_history', resourceId: req.params['id'], action: 'update' });

      const existing = await prisma.workHistory.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Work history');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Work history');

      const workHistory = await prisma.workHistory.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.startDate && { startDate: new Date(data.startDate) }),
          ...(data.endDate && { endDate: new Date(data.endDate) }),
          updatedById: req.user?.id,
        },
      });

      res.json({ success: true, data: workHistory });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/credentials/work-history/:id
credentialRoutes.delete(
  '/work-history/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'work_history', resourceId: req.params['id'], action: 'delete' });

      const existing = await prisma.workHistory.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Work history');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Work history');

      await prisma.workHistory.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'Work history deleted' });
    } catch (error) {
      next(error);
    }
  }
);
