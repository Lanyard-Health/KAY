import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireProviderAccess, authorize } from '../middleware/auth.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import { setAuditContext } from '../middleware/audit.middleware.js';
import {
  createHospitalAffiliationSchema,
  createProfessionalReferenceSchema,
  createDisciplinaryActionSchema,
  createContinuingEducationSchema,
} from '@credential-management/shared';

// ---------------------------------------------------------------------------
// Factory config
// ---------------------------------------------------------------------------

interface CrudConfig {
  slug: string;
  label: string;
  resourceType: string;
  createSchema: z.ZodTypeAny;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any;
  /** Zod field names whose string values should be converted to Date on write */
  dateFields: string[];
  /** Zod field name → Prisma field name (for mismatched names) */
  fieldMap?: Record<string, string>;
  orderBy: Record<string, string>;
}

const WRITE_ROLES = ['admin', 'lanyard_admin', 'credentialing_staff', 'practice_admin'] as const;

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function convertDates(data: Record<string, unknown>, dateFields: string[]): void {
  for (const field of dateFields) {
    if (typeof data[field] === 'string') {
      data[field] = new Date(data[field] as string);
    }
  }
}

function applyFieldMap(data: Record<string, unknown>, fieldMap?: Record<string, string>): Record<string, unknown> {
  if (!fieldMap) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[fieldMap[key] ?? key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CRUD factory
// ---------------------------------------------------------------------------

function registerCrud(router: Router, config: CrudConfig): void {
  const { slug, label, resourceType, createSchema, delegate, dateFields, fieldMap, orderBy } = config;

  // GET /:slug/provider/:providerId
  router.get(
    `/${slug}/provider/:providerId`,
    requireProviderAccess, requirePracticeProvider,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const records = await delegate.findMany({
          where: { providerId: req.params['providerId'] },
          orderBy,
        });
        res.json({ success: true, data: records });
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /:slug/provider/:providerId
  router.post(
    `/${slug}/provider/:providerId`,
    requireProviderAccess, requirePracticeProvider,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = createSchema.parse(req.body) as Record<string, unknown>;
        convertDates(parsed, dateFields);
        const mapped = applyFieldMap(parsed, fieldMap);

        setAuditContext(req, { resourceType, action: 'create' });

        const record = await delegate.create({
          data: {
            ...mapped,
            providerId: req.params['providerId']!,
            createdById: req.user?.id,
          },
        });

        res.status(201).json({ success: true, data: record });
      } catch (error) {
        next(error);
      }
    },
  );

  // PUT /:slug/:id
  router.put(
    `/${slug}/:id`,
    authorize(...WRITE_ROLES),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = (createSchema as z.ZodObject<z.ZodRawShape>).partial().parse(req.body) as Record<string, unknown>;
        convertDates(parsed, dateFields);
        const mapped = applyFieldMap(parsed, fieldMap);

        setAuditContext(req, { resourceType, resourceId: req.params['id'], action: 'update' });

        const existing = await delegate.findUnique({
          where: { id: req.params['id'] },
          select: { providerId: true },
        });
        if (!existing) throw new NotFoundError(label);
        if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError(label);

        const record = await delegate.update({
          where: { id: req.params['id'] },
          data: {
            ...mapped,
            updatedById: req.user?.id,
          },
        });

        res.json({ success: true, data: record });
      } catch (error) {
        next(error);
      }
    },
  );

  // DELETE /:slug/:id
  router.delete(
    `/${slug}/:id`,
    authorize(...WRITE_ROLES),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        setAuditContext(req, { resourceType, resourceId: req.params['id'], action: 'delete' });

        const existing = await delegate.findUnique({
          where: { id: req.params['id'] },
          select: { providerId: true },
        });
        if (!existing) throw new NotFoundError(label);
        if (!(await validateProviderPracticeAccess(req, existing.providerId))) throw new NotFoundError(label);

        await delegate.delete({ where: { id: req.params['id'] } });

        res.json({ success: true, message: `${label} deleted` });
      } catch (error) {
        next(error);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Router + registration
// ---------------------------------------------------------------------------

export const credentialExtendedRoutes = Router();
credentialExtendedRoutes.use(authenticate);

registerCrud(credentialExtendedRoutes, {
  slug: 'hospital-affiliations',
  label: 'Hospital affiliation',
  resourceType: 'hospital_affiliation',
  createSchema: createHospitalAffiliationSchema,
  delegate: prisma.hospitalAffiliation,
  dateFields: ['appointmentDate', 'reappointmentDate'],
  orderBy: { facilityName: 'asc' },
});

registerCrud(credentialExtendedRoutes, {
  slug: 'professional-references',
  label: 'Professional reference',
  resourceType: 'professional_reference',
  createSchema: createProfessionalReferenceSchema,
  delegate: prisma.professionalReference,
  dateFields: [],
  orderBy: { name: 'asc' },
});

registerCrud(credentialExtendedRoutes, {
  slug: 'disciplinary-actions',
  label: 'Disciplinary action',
  resourceType: 'disciplinary_action',
  createSchema: createDisciplinaryActionSchema,
  delegate: prisma.disciplinaryAction,
  dateFields: ['dateOfAction', 'resolutionDate'],
  orderBy: { dateOfAction: 'desc' },
});

registerCrud(credentialExtendedRoutes, {
  slug: 'continuing-education',
  label: 'Continuing education',
  resourceType: 'continuing_education',
  createSchema: createContinuingEducationSchema,
  delegate: prisma.continuingEducation,
  dateFields: ['completionDate'],
  fieldMap: { provider: 'courseProvider' },
  orderBy: { completionDate: 'desc' },
});
