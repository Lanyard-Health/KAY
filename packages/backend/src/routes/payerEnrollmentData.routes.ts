import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireProviderAccess, authorize } from '../middleware/auth.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import {
  createSupervisingPhysicianSchema,
  createMalpracticeClaimSchema,
  createDisclosureSchema,
  createDeaRegistrationSchema,
  createProviderIdentifierSchema,
  createBankingSchema,
  upsertDemographicsSchema,
} from '@credential-management/shared';

export const payerEnrollmentDataRoutes = Router();

payerEnrollmentDataRoutes.use(authenticate);

// ==========================================
// SUPERVISING PHYSICIANS
// ==========================================

payerEnrollmentDataRoutes.get(
  '/supervising-physicians/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.supervisingPhysician.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { agreementStartDate: 'desc' },
      });
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/supervising-physicians/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createSupervisingPhysicianSchema.parse(req.body);
      const record = await prisma.supervisingPhysician.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          agreementStartDate: new Date(data.agreementStartDate),
          ...(data.agreementEndDate && { agreementEndDate: new Date(data.agreementEndDate) }),
          createdById: req.user?.id,
        },
      });
      res.status(201).json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/supervising-physicians/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createSupervisingPhysicianSchema.partial().parse(req.body);
      const existing = await prisma.supervisingPhysician.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Supervising physician');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Supervising physician');

      const record = await prisma.supervisingPhysician.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.agreementStartDate && { agreementStartDate: new Date(data.agreementStartDate) }),
          ...(data.agreementEndDate && { agreementEndDate: new Date(data.agreementEndDate) }),
          updatedById: req.user?.id,
        },
      });
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/supervising-physicians/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.supervisingPhysician.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Supervising physician');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Supervising physician');

      await prisma.supervisingPhysician.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Supervising physician deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// MALPRACTICE CLAIMS
// ==========================================

payerEnrollmentDataRoutes.get(
  '/malpractice-claims/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.malpracticeClaim.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { dateOfClaim: 'desc' },
      });
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/malpractice-claims/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createMalpracticeClaimSchema.parse(req.body);
      const record = await prisma.malpracticeClaim.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          dateOfIncident: new Date(data.dateOfIncident),
          dateOfClaim: new Date(data.dateOfClaim),
          ...(data.dateResolved && { dateResolved: new Date(data.dateResolved) }),
          createdById: req.user?.id,
        },
      });
      res.status(201).json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/malpractice-claims/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createMalpracticeClaimSchema.partial().parse(req.body);
      const existing = await prisma.malpracticeClaim.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Malpractice claim');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Malpractice claim');

      const record = await prisma.malpracticeClaim.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.dateOfIncident && { dateOfIncident: new Date(data.dateOfIncident) }),
          ...(data.dateOfClaim && { dateOfClaim: new Date(data.dateOfClaim) }),
          ...(data.dateResolved && { dateResolved: new Date(data.dateResolved) }),
          updatedById: req.user?.id,
        },
      });
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/malpractice-claims/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.malpracticeClaim.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Malpractice claim');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Malpractice claim');

      await prisma.malpracticeClaim.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Malpractice claim deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// DISCLOSURES
// ==========================================

payerEnrollmentDataRoutes.get(
  '/disclosures/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.providerDisclosure.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { category: 'asc' },
      });
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/disclosures/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createDisclosureSchema.parse(req.body);
      const record = await prisma.providerDisclosure.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          ...(data.dateOfOccurrence && { dateOfOccurrence: new Date(data.dateOfOccurrence) }),
          createdById: req.user?.id,
        },
      });
      res.status(201).json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/disclosures/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createDisclosureSchema.partial().parse(req.body);
      const existing = await prisma.providerDisclosure.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Disclosure');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Disclosure');

      const record = await prisma.providerDisclosure.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.dateOfOccurrence && { dateOfOccurrence: new Date(data.dateOfOccurrence) }),
          updatedById: req.user?.id,
        },
      });
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/disclosures/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.providerDisclosure.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Disclosure');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Disclosure');

      await prisma.providerDisclosure.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Disclosure deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// DEA REGISTRATIONS
// ==========================================

payerEnrollmentDataRoutes.get(
  '/dea-registrations/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.deaRegistration.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { expirationDate: 'asc' },
      });
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/dea-registrations/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createDeaRegistrationSchema.parse(req.body);
      const record = await prisma.deaRegistration.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          issueDate: new Date(data.issueDate),
          expirationDate: new Date(data.expirationDate),
          createdById: req.user?.id,
        },
      });
      res.status(201).json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/dea-registrations/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createDeaRegistrationSchema.partial().parse(req.body);
      const existing = await prisma.deaRegistration.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('DEA registration');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('DEA registration');

      const record = await prisma.deaRegistration.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.issueDate && { issueDate: new Date(data.issueDate) }),
          ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
          updatedById: req.user?.id,
        },
      });
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/dea-registrations/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.deaRegistration.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('DEA registration');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('DEA registration');

      await prisma.deaRegistration.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'DEA registration deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// PROVIDER IDENTIFIERS
// ==========================================

payerEnrollmentDataRoutes.get(
  '/identifiers/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.providerIdentifier.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { identifierType: 'asc' },
      });
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/identifiers/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createProviderIdentifierSchema.parse(req.body);
      const record = await prisma.providerIdentifier.create({
        data: {
          providerId: req.params['providerId']!,
          ...data,
          ...(data.effectiveDate && { effectiveDate: new Date(data.effectiveDate) }),
          ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
          createdById: req.user?.id,
        },
      });
      res.status(201).json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/identifiers/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createProviderIdentifierSchema.partial().parse(req.body);
      const existing = await prisma.providerIdentifier.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Provider identifier');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Provider identifier');

      const record = await prisma.providerIdentifier.update({
        where: { id: req.params['id'] },
        data: {
          ...data,
          ...(data.effectiveDate && { effectiveDate: new Date(data.effectiveDate) }),
          ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
          updatedById: req.user?.id,
        },
      });
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/identifiers/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.providerIdentifier.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Provider identifier');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Provider identifier');

      await prisma.providerIdentifier.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Provider identifier deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// BANKING / EFT
// ==========================================

payerEnrollmentDataRoutes.get(
  '/banking/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.providerBanking.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { isPrimary: 'desc' },
      });

      // Mask sensitive fields — never return raw routing/account numbers
      const masked = records.map((r) => ({
        ...r,
        routingNumberEncrypted: '****' + r.routingNumberEncrypted.slice(-4),
        accountNumberEncrypted: '****' + r.accountNumberLast4,
        accountHolderTaxId: r.accountHolderTaxId ? '****' + r.accountHolderTaxId.slice(-4) : null,
      }));

      res.json({ success: true, data: masked });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/banking/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createBankingSchema.parse(req.body);
      const record = await prisma.providerBanking.create({
        data: {
          providerId: req.params['providerId']!,
          bankName: data.bankName,
          bankAccountType: data.bankAccountType,
          routingNumberEncrypted: data.routingNumber, // TODO: encrypt with same pattern as ssnEncrypted
          accountNumberEncrypted: data.accountNumber, // TODO: encrypt
          accountNumberLast4: data.accountNumber.slice(-4),
          accountHolderName: data.accountHolderName,
          ...(data.accountHolderTaxId && { accountHolderTaxId: data.accountHolderTaxId }),
          ...(data.eftAuthorizationDate && { eftAuthorizationDate: new Date(data.eftAuthorizationDate) }),
          w9OnFile: data.w9OnFile ?? false,
          voidedCheckOnFile: data.voidedCheckOnFile ?? false,
          isPrimary: data.isPrimary ?? false,
          ...(data.notes && { notes: data.notes }),
          createdById: req.user?.id,
        },
      });

      // Return masked response
      res.status(201).json({
        success: true,
        data: {
          ...record,
          routingNumberEncrypted: '****' + record.routingNumberEncrypted.slice(-4),
          accountNumberEncrypted: '****' + record.accountNumberLast4,
          accountHolderTaxId: record.accountHolderTaxId ? '****' + record.accountHolderTaxId.slice(-4) : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/banking/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createBankingSchema.partial().parse(req.body);
      const existing = await prisma.providerBanking.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Banking record');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Banking record');

      const updateData: Record<string, unknown> = { updatedById: req.user?.id };
      if (data.bankName) updateData['bankName'] = data.bankName;
      if (data.bankAccountType) updateData['bankAccountType'] = data.bankAccountType;
      if (data.routingNumber) updateData['routingNumberEncrypted'] = data.routingNumber;
      if (data.accountNumber) {
        updateData['accountNumberEncrypted'] = data.accountNumber;
        updateData['accountNumberLast4'] = data.accountNumber.slice(-4);
      }
      if (data.accountHolderName) updateData['accountHolderName'] = data.accountHolderName;
      if (data.accountHolderTaxId) updateData['accountHolderTaxId'] = data.accountHolderTaxId;
      if (data.eftAuthorizationDate) updateData['eftAuthorizationDate'] = new Date(data.eftAuthorizationDate);
      if (data.w9OnFile !== undefined) updateData['w9OnFile'] = data.w9OnFile;
      if (data.voidedCheckOnFile !== undefined) updateData['voidedCheckOnFile'] = data.voidedCheckOnFile;
      if (data.isPrimary !== undefined) updateData['isPrimary'] = data.isPrimary;
      if (data.notes !== undefined) updateData['notes'] = data.notes;

      const record = await prisma.providerBanking.update({
        where: { id: req.params['id'] },
        data: updateData,
      });

      res.json({
        success: true,
        data: {
          ...record,
          routingNumberEncrypted: '****' + record.routingNumberEncrypted.slice(-4),
          accountNumberEncrypted: '****' + record.accountNumberLast4,
          accountHolderTaxId: record.accountHolderTaxId ? '****' + record.accountHolderTaxId.slice(-4) : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/banking/:id',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.providerBanking.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Banking record');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Banking record');

      await prisma.providerBanking.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Banking record deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// DEMOGRAPHICS (1:1 — upsert pattern)
// ==========================================

payerEnrollmentDataRoutes.get(
  '/demographics/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.providerDemographics.findUnique({
        where: { providerId: req.params['providerId'] },
      });
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/demographics/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = upsertDemographicsSchema.parse(req.body);
      const record = await prisma.providerDemographics.upsert({
        where: { providerId: req.params['providerId'] },
        create: {
          providerId: req.params['providerId']!,
          ...data,
          ...(data.visaExpirationDate && { visaExpirationDate: new Date(data.visaExpirationDate) }),
        },
        update: {
          ...data,
          ...(data.visaExpirationDate && { visaExpirationDate: new Date(data.visaExpirationDate) }),
        },
      });
      res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
);
