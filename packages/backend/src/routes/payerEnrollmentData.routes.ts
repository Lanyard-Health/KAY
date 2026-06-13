import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireProviderAccess, authorize } from '../middleware/auth.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { STAFF_ROLES, ALL_AUTHENTICATED_ROLES } from '../constants/roles.js';
import { encryptSafe, decryptSafe } from '../utils/crypto.js';
import { requirePracticeProvider, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import { setAuditContext, logSensitiveFieldReveal } from '../middleware/audit.middleware.js';
import {
  createSupervisingPhysicianSchema,
  createMalpracticeClaimSchema,
  createDisclosureSchema,
  createDeaRegistrationSchema,
  createCdsRegistrationSchema,
  createProviderIdentifierSchema,
  createBankingSchema,
  upsertDemographicsSchema,
  nullablePartial,
} from '@credential-management/shared';

export const payerEnrollmentDataRoutes = Router();

payerEnrollmentDataRoutes.use(authenticate);

// Mask a sensitive registration number to its last 4 chars for API responses
// (matches the SSN / tax-id / bank-account treatment below). The full value
// never leaves the server via REST — server-side form-fill decrypts straight
// from the DB through the internal credentialing packet, not these responses.
function maskLast4(plain: string | null | undefined): string | null {
  if (!plain) return null;
  return '****' + String(plain).slice(-4);
}

// On update, a value that's absent, null, or itself a mask ("****1234") means
// "leave the stored secret unchanged" — so we never re-encrypt a masked value
// the client echoed back from a previous masked response.
function isRealSecretUpdate(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !v.startsWith('****');
}

// ==========================================
// SUPERVISING PHYSICIANS
// ==========================================

payerEnrollmentDataRoutes.get(
  '/supervising-physicians/:providerId',
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.supervisingPhysician.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { agreementStartDate: 'desc' },
        include: { practiceLocation: { select: { id: true, locationName: true } } },
      });
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/supervising-physicians/:providerId',
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createSupervisingPhysicianSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'supervising_physician', action: 'create' });

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
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = nullablePartial(createSupervisingPhysicianSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'supervising_physician', resourceId: req.params['id'], action: 'update' });

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
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'supervising_physician', resourceId: req.params['id'], action: 'delete' });

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
  authorize(...ALL_AUTHENTICATED_ROLES),
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
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createMalpracticeClaimSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'malpractice_claim', action: 'create' });

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
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = nullablePartial(createMalpracticeClaimSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'malpractice_claim', resourceId: req.params['id'], action: 'update' });

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
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'malpractice_claim', resourceId: req.params['id'], action: 'delete' });

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
  authorize(...ALL_AUTHENTICATED_ROLES),
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
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createDisclosureSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'provider_disclosure', action: 'create' });

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
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = nullablePartial(createDisclosureSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'provider_disclosure', resourceId: req.params['id'], action: 'update' });

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
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'provider_disclosure', resourceId: req.params['id'], action: 'delete' });

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
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.deaRegistration.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { expirationDate: 'asc' },
      });
      const masked = records.map((r) => ({ ...r, deaNumberEncrypted: undefined, deaNumber: maskLast4(decryptSafe(r.deaNumberEncrypted)) }));
      res.json({ success: true, data: masked });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/dea-registrations/:providerId',
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createDeaRegistrationSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'dea_registration', action: 'create' });

      const { deaNumber, buprenorphineWaiver, ...rest } = data;
      const record = await prisma.deaRegistration.create({
        data: {
          providerId: req.params['providerId']!,
          ...rest,
          deaNumberEncrypted: encryptSafe(deaNumber),
          issueDate: new Date(data.issueDate),
          expirationDate: new Date(data.expirationDate),
          ...(buprenorphineWaiver !== undefined && { buprenorphineWaiver }),
          createdById: req.user?.id,
        },
      });
      res.status(201).json({ success: true, data: { ...record, deaNumberEncrypted: undefined, deaNumber: maskLast4(decryptSafe(record.deaNumberEncrypted)) } });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/dea-registrations/:id',
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = nullablePartial(createDeaRegistrationSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'dea_registration', resourceId: req.params['id'], action: 'update' });

      const existing = await prisma.deaRegistration.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('DEA registration');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('DEA registration');

      const { deaNumber, buprenorphineWaiver, ...rest } = data;
      const record = await prisma.deaRegistration.update({
        where: { id: req.params['id'] },
        data: {
          ...rest,
          ...(isRealSecretUpdate(deaNumber) && { deaNumberEncrypted: encryptSafe(deaNumber) }),
          ...(data.issueDate && { issueDate: new Date(data.issueDate) }),
          ...(data.expirationDate && { expirationDate: new Date(data.expirationDate) }),
          ...(buprenorphineWaiver !== undefined && { buprenorphineWaiver }),
          updatedById: req.user?.id,
        },
      });
      res.json({ success: true, data: { ...record, deaNumberEncrypted: undefined, deaNumber: maskLast4(decryptSafe(record.deaNumberEncrypted)) } });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/dea-registrations/:id',
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'dea_registration', resourceId: req.params['id'], action: 'delete' });

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

// Reveal the FULL DEA number for one registration. Lists/details only ever
// return the masked last-4 (see GET above); this is the deliberate, audited
// path for staff who genuinely need the full number to file an application.
// The reveal is logged BEFORE the value is returned — if the audit write
// fails, the request errors and nothing is disclosed (fail-closed).
payerEnrollmentDataRoutes.get(
  '/dea-registrations/:id/reveal',
  authorize(...ALL_AUTHENTICATED_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.deaRegistration.findUnique({
        where: { id: req.params['id'] },
        select: { id: true, providerId: true, deaNumberEncrypted: true },
      });
      if (!record) throw new NotFoundError('DEA registration');
      if (!(await validateProviderPracticeAccess(req, record.providerId))) throw new NotFoundError('DEA registration');

      await logSensitiveFieldReveal(req, { field: 'deaNumber', providerId: record.providerId, recordId: record.id });

      res.json({ success: true, data: { id: record.id, deaNumber: decryptSafe(record.deaNumberEncrypted) } });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// CDS REGISTRATIONS (state-issued, separate from federal DEA)
// HIPAA: cdsNumber is encrypted via encryptSafe() before persistence.
// ==========================================

payerEnrollmentDataRoutes.get(
  '/cds-registrations/:providerId',
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.cdsRegistration.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { state: 'asc' },
      });
      const masked = records.map((r) => ({ ...r, cdsNumberEncrypted: undefined, cdsNumber: maskLast4(decryptSafe(r.cdsNumberEncrypted)) }));
      res.json({ success: true, data: masked });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/cds-registrations/:providerId',
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createCdsRegistrationSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'cds_registration', action: 'create' });

      const { cdsNumber, ...rest } = data;
      const record = await prisma.cdsRegistration.create({
        data: {
          providerId: req.params['providerId']!,
          ...rest,
          cdsNumberEncrypted: encryptSafe(cdsNumber),
          ...(rest.issueDate && { issueDate: new Date(rest.issueDate) }),
          ...(rest.expirationDate && { expirationDate: new Date(rest.expirationDate) }),
          createdById: req.user?.id,
        },
      });
      res.status(201).json({ success: true, data: { ...record, cdsNumberEncrypted: undefined, cdsNumber: maskLast4(decryptSafe(record.cdsNumberEncrypted)) } });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/cds-registrations/:id',
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = nullablePartial(createCdsRegistrationSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'cds_registration', resourceId: req.params['id'], action: 'update' });

      const existing = await prisma.cdsRegistration.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('CDS registration');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('CDS registration');

      const { cdsNumber, ...rest } = data;
      const record = await prisma.cdsRegistration.update({
        where: { id: req.params['id'] },
        data: {
          ...rest,
          ...(isRealSecretUpdate(cdsNumber) && { cdsNumberEncrypted: encryptSafe(cdsNumber) }),
          ...(rest.issueDate && { issueDate: new Date(rest.issueDate) }),
          ...(rest.expirationDate && { expirationDate: new Date(rest.expirationDate) }),
          updatedById: req.user?.id,
        },
      });
      res.json({ success: true, data: { ...record, cdsNumberEncrypted: undefined, cdsNumber: maskLast4(decryptSafe(record.cdsNumberEncrypted)) } });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/cds-registrations/:id',
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'cds_registration', resourceId: req.params['id'], action: 'delete' });

      const existing = await prisma.cdsRegistration.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('CDS registration');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('CDS registration');

      await prisma.cdsRegistration.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'CDS registration deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// Reveal the FULL CDS number for one registration — audited, fail-closed.
// Mirrors the DEA reveal above (see comment there).
payerEnrollmentDataRoutes.get(
  '/cds-registrations/:id/reveal',
  authorize(...ALL_AUTHENTICATED_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.cdsRegistration.findUnique({
        where: { id: req.params['id'] },
        select: { id: true, providerId: true, cdsNumberEncrypted: true },
      });
      if (!record) throw new NotFoundError('CDS registration');
      if (!(await validateProviderPracticeAccess(req, record.providerId))) throw new NotFoundError('CDS registration');

      await logSensitiveFieldReveal(req, { field: 'cdsNumber', providerId: record.providerId, recordId: record.id });

      res.json({ success: true, data: { id: record.id, cdsNumber: decryptSafe(record.cdsNumberEncrypted) } });
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
  authorize(...ALL_AUTHENTICATED_ROLES),
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
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createProviderIdentifierSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'provider_identifier', action: 'create' });

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
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = nullablePartial(createProviderIdentifierSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'provider_identifier', resourceId: req.params['id'], action: 'update' });

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
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'provider_identifier', resourceId: req.params['id'], action: 'delete' });

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
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await prisma.providerBanking.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { isPrimary: 'desc' },
      });

      // Mask sensitive fields — decrypt then show only last 4 digits
      const masked = records.map((r) => {
        const routingPlain = decryptSafe(r.routingNumberEncrypted);
        const taxIdPlain = r.accountHolderTaxIdEncrypted ? decryptSafe(r.accountHolderTaxIdEncrypted) : null;
        return {
          ...r,
          routingNumberEncrypted: '****' + routingPlain.slice(-4),
          accountNumberEncrypted: '****' + r.accountNumberLast4,
          accountHolderTaxId: taxIdPlain ? '****' + taxIdPlain.slice(-4) : null,
        };
      });

      res.json({ success: true, data: masked });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.post(
  '/banking/:providerId',
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createBankingSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'provider_banking', action: 'create' });

      const record = await prisma.providerBanking.create({
        data: {
          providerId: req.params['providerId']!,
          bankName: data.bankName,
          bankAccountType: data.bankAccountType,
          routingNumberEncrypted: encryptSafe(data.routingNumber),
          accountNumberEncrypted: encryptSafe(data.accountNumber),
          accountNumberLast4: data.accountNumber.slice(-4),
          accountHolderName: data.accountHolderName,
          ...(data.accountHolderTaxId && { accountHolderTaxIdEncrypted: encryptSafe(data.accountHolderTaxId) }),
          ...(data.eftAuthorizationDate && { eftAuthorizationDate: new Date(data.eftAuthorizationDate) }),
          w9OnFile: data.w9OnFile ?? false,
          voidedCheckOnFile: data.voidedCheckOnFile ?? false,
          isPrimary: data.isPrimary ?? false,
          ...(data.notes && { notes: data.notes }),
          createdById: req.user?.id,
        },
      });

      // Return masked response — decrypt first, then mask to last 4
      const routingPlain = decryptSafe(record.routingNumberEncrypted);
      const taxIdPlain = record.accountHolderTaxIdEncrypted ? decryptSafe(record.accountHolderTaxIdEncrypted) : null;
      res.status(201).json({
        success: true,
        data: {
          ...record,
          routingNumberEncrypted: '****' + routingPlain.slice(-4),
          accountNumberEncrypted: '****' + record.accountNumberLast4,
          accountHolderTaxId: taxIdPlain ? '****' + taxIdPlain.slice(-4) : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.put(
  '/banking/:id',
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = nullablePartial(createBankingSchema).parse(req.body);

      setAuditContext(req, { resourceType: 'provider_banking', resourceId: req.params['id'], action: 'update' });

      const existing = await prisma.providerBanking.findUnique({ where: { id: req.params['id'] }, select: { providerId: true } });
      if (!existing) throw new NotFoundError('Banking record');
      if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError('Banking record');

      const updateData: Record<string, unknown> = { updatedById: req.user?.id };
      if (data.bankName) updateData['bankName'] = data.bankName;
      if (data.bankAccountType) updateData['bankAccountType'] = data.bankAccountType;
      if (data.routingNumber) updateData['routingNumberEncrypted'] = encryptSafe(data.routingNumber);
      if (data.accountNumber) {
        updateData['accountNumberEncrypted'] = encryptSafe(data.accountNumber);
        updateData['accountNumberLast4'] = data.accountNumber.slice(-4);
      }
      if (data.accountHolderName) updateData['accountHolderName'] = data.accountHolderName;
      if (data.accountHolderTaxId) updateData['accountHolderTaxIdEncrypted'] = encryptSafe(data.accountHolderTaxId);
      if (data.eftAuthorizationDate) updateData['eftAuthorizationDate'] = new Date(data.eftAuthorizationDate);
      if (data.w9OnFile !== undefined) updateData['w9OnFile'] = data.w9OnFile;
      if (data.voidedCheckOnFile !== undefined) updateData['voidedCheckOnFile'] = data.voidedCheckOnFile;
      if (data.isPrimary !== undefined) updateData['isPrimary'] = data.isPrimary;
      if (data.notes !== undefined) updateData['notes'] = data.notes;

      const record = await prisma.providerBanking.update({
        where: { id: req.params['id'] },
        data: updateData,
      });

      const routingPlainUpd = decryptSafe(record.routingNumberEncrypted);
      const taxIdPlainUpd = record.accountHolderTaxIdEncrypted ? decryptSafe(record.accountHolderTaxIdEncrypted) : null;
      res.json({
        success: true,
        data: {
          ...record,
          routingNumberEncrypted: '****' + routingPlainUpd.slice(-4),
          accountNumberEncrypted: '****' + record.accountNumberLast4,
          accountHolderTaxId: taxIdPlainUpd ? '****' + taxIdPlainUpd.slice(-4) : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

payerEnrollmentDataRoutes.delete(
  '/banking/:id',
  authorize(...STAFF_ROLES),
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'provider_banking', resourceId: req.params['id'], action: 'delete' });

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
  authorize(...ALL_AUTHENTICATED_ROLES),
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
  authorize(...ALL_AUTHENTICATED_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = upsertDemographicsSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'provider_demographics', action: 'update' });

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
