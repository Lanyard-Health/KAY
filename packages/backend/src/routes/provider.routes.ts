import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { requirePracticeProvider, getPracticeProviderFilter } from '../middleware/practiceScope.middleware.js';
import { NotFoundError, ValidationError } from '../middleware/error.middleware.js';
import { setAuditContext, logSensitiveFieldReveal } from '../middleware/audit.middleware.js';
import { decryptSafe } from '../utils/crypto.js';
import { createProviderSchema, updateProviderSchema } from '@credential-management/shared';
import { providerListQuerySchema, parseQuery } from '../utils/queryValidation.js';
import { invalidateCache } from '../utils/cache.js';
import { z } from 'zod';
import { CaqhService } from '../services/caqh.service.js';
import { ensureDraftEnrollments } from '../services/draft-enrollment.service.js';
import {
  softDeleteProvider,
  restoreProvider,
  findArchivedProviders,
  checkProviderCollision,
  collisionToHttpResponse,
} from '../services/provider.service.js';
import { logger } from '../utils/logger.js';

// Fields to NEVER return in API responses
const SENSITIVE_FIELDS = ['ssnEncrypted', 'caqhPassword', 'caqhUsername'] as const;

function stripSensitiveFields(provider: any): any {
  if (!provider) return provider;
  const cleaned = { ...provider };
  for (const field of SENSITIVE_FIELDS) {
    // eslint-disable-next-line security/detect-object-injection -- field is from a hardcoded const array of literal strings
    delete cleaned[field];
  }
  return cleaned;
}

export const providerRoutes = Router();

// Apply authentication to all routes
providerRoutes.use(authenticate);

// GET /api/v1/providers - List active providers (default) or archived (?status=archived, admin-only)
providerRoutes.get(
  '/',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize, search, status } = parseQuery(req.query, providerListQuerySchema);

      // Archived branch — admin-only, deliberately bypasses the soft-delete query extension
      // to return soft-deleted rows. Tenant scoping is enforced in the service.
      if (status === 'archived') {
        if (req.user?.role !== 'admin' && req.user?.role !== 'practice_admin') {
          res.status(403).json({ success: false, error: { message: 'Admin role required for archived view' } });
          return;
        }
        const archived = await findArchivedProviders({
          isSuperAdmin: !!req.practiceScope?.isSuperAdmin,
          practiceIds: req.practiceScope?.practiceIds ?? [],
          page,
          pageSize,
        });
        res.json({
          success: true,
          data: {
            data: archived.data.map(stripSensitiveFields),
            total: archived.total,
            page,
            pageSize,
            totalPages: Math.ceil(archived.total / pageSize),
          },
        });
        return;
      }

      const where = {
        ...getPracticeProviderFilter(req),
        ...(req.query['practiceId'] === 'null'
          ? { practiceId: null }
          : req.query['practiceId']
          ? { practiceId: req.query['practiceId'] as string }
          : {}),
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { npi: { contains: search } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }),
        ...(status && { status: status as 'active' | 'inactive' | 'pending' }),
      };

      const [providers, total] = await Promise.all([
        prisma.providerProfile.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { lastName: 'asc' },
          select: {
            id: true,
            npi: true,
            firstName: true,
            lastName: true,
            middleName: true,
            suffix: true,
            email: true,
            phone: true,
            providerType: true,
            taxonomy: true,
            specialties: true,
            languages: true,
            status: true,
            practiceId: true,
            practice: { select: { id: true, name: true } },
            createdAt: true,
            updatedAt: true,
            addresses: true,
            _count: {
              select: {
                licenses: true,
                boardCertifications: true,
                documents: true,
              },
            },
          },
        }),
        prisma.providerProfile.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          data: providers,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/providers/:id - Get single provider
providerRoutes.get(
  '/:providerId',
  authorize('admin', 'credentialing_staff', 'practice_admin'), requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.providerProfile.findUnique({
        where: { id: req.params['providerId'] },
        include: {
          addresses: true,
          practiceLocations: {
            orderBy: [{ isPrimary: 'desc' }, { locationName: 'asc' }],
          },
          licenses: true,
          boardCertifications: true,
          malpracticeInsurances: true,
          educations: true,
          workHistories: true,
          hospitalAffiliations: true,
          professionalReferences: true,
          disciplinaryActions: true,
          continuingEducations: true,
          documents: {
            select: {
              id: true,
              fileName: true,
              documentType: true,
              createdAt: true,
            },
          },
          practice: { select: { id: true, name: true, status: true } },
        },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
      }

      const cleaned = stripSensitiveFields(provider);

      // Non-sensitive signal so the UI can show a "Reveal SSN" control only when
      // an SSN is actually on file. The encrypted value + last-4 are never sent;
      // staff fetch the full number via the dedicated audited reveal endpoint.
      cleaned.hasSsn = !!provider.ssnEncrypted;

      // Only include dateOfBirth for admin/staff or the provider themselves
      const isAdminOrStaff = req.user?.role === 'admin' || req.user?.role === 'lanyard_staff' || req.user?.role === 'credentialing_staff' || req.user?.role === 'practice_admin';
      const isSelf = req.user?.providerId === provider.id;
      if (!isAdminOrStaff && !isSelf) {
        delete cleaned.dateOfBirth;
      }

      res.json({ success: true, data: cleaned });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/providers/:providerId/ssn/reveal — return the FULL SSN.
// SSN is otherwise stripped from every provider response (see SENSITIVE_FIELDS).
// This is the only path that returns it, and only to staff scoped to the
// provider's practice. The reveal is logged BEFORE the value is returned — if
// the audit write fails, the request errors and nothing is disclosed
// (fail-closed). requirePracticeProvider enforces tenant isolation on :providerId.
providerRoutes.get(
  '/:providerId/ssn/reveal',
  authorize('admin', 'credentialing_staff', 'practice_admin'), requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
        select: { id: true, ssnEncrypted: true },
      });
      if (!provider) throw new NotFoundError('Provider');
      if (!provider.ssnEncrypted) {
        throw new NotFoundError('SSN');
      }

      await logSensitiveFieldReveal(req, { field: 'ssn', providerId });

      res.json({ success: true, data: { ssn: decryptSafe(provider.ssnEncrypted) } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/providers - Create provider
providerRoutes.post(
  '/',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = createProviderSchema.parse(req.body);

      // groupNpi and taxId belong on PracticeLocation, not ProviderProfile.
      // They are echoed in the response so the frontend can forward them
      // to the POST /practice-locations/provider/:id call that follows.
      const { groupNpi, taxId, ...providerData } = validatedData;

      // Auto-set practiceId for practice_admin
      const practiceId = req.user?.role === 'practice_admin'
        ? req.practiceScope?.practiceIds[0]
        : undefined;

      // Pre-flight collision check on the unique fields (npi, caqhProviderId).
      // Catches the case where the admin is re-keying a soft-deleted provider; surfaces
      // "restore instead?" instead of the bare 409. Out-of-scope collisions get a
      // leak-free message — no name, no practice.
      const collision = await checkProviderCollision({
        npi: providerData.npi ?? null,
        caqhProviderId: (providerData as { caqhProviderId?: string | null }).caqhProviderId ?? null,
        isSuperAdmin: !!req.practiceScope?.isSuperAdmin,
        practiceIds: req.practiceScope?.practiceIds ?? [],
      });
      if (collision.kind !== 'none') {
        const { statusCode, body } = collisionToHttpResponse(collision);
        res.status(statusCode).json(body);
        return;
      }

      const provider = await prisma.providerProfile.create({
        data: {
          ...providerData,
          dateOfBirth: new Date(providerData.dateOfBirth),
          specialties: providerData.specialties || [],
          languages: providerData.languages || [],
          createdById: req.user?.id,
          ...(practiceId && { practiceId }),
        },
      });

      setAuditContext(req, {
        resourceType: 'providers',
        resourceId: provider.id,
        action: 'create',
      });

      invalidateCache('dashboard');

      // Auto-create draft enrollments for the practice's target payers.
      // Non-blocking: provider creation must not fail on draft errors.
      if (provider.practiceId) {
        ensureDraftEnrollments({
          practiceId: provider.practiceId,
          providerId: provider.id,
          createdById: req.user?.id,
        }).catch((err) => {
          logger.warn(
            `ensureDraftEnrollments failed for provider ${provider.id}`,
            err
          );
        });
      }

      const data: Record<string, unknown> = { ...stripSensitiveFields(provider) };
      if (groupNpi) data['groupNpi'] = groupNpi;
      if (taxId) data['taxId'] = taxId;
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/providers/:id - Update provider
providerRoutes.put(
  '/:providerId',
  authorize('admin', 'credentialing_staff', 'practice_admin'), requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = updateProviderSchema.parse(req.body);

      // groupNpi and taxId belong on PracticeLocation, not ProviderProfile
      // (mirror the create handler). Strip them before the update — passing
      // them to providerProfile.update throws PrismaClientValidationError — and
      // echo them back so the frontend forwards them to the practice-location call.
      const { groupNpi, taxId, ...providerData } = validatedData;

      const existing = await prisma.providerProfile.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!existing) {
        throw new NotFoundError('Provider');
      }

      const provider = await prisma.providerProfile.update({
        where: { id: req.params['providerId'] },
        data: {
          ...providerData,
          ...(providerData.dateOfBirth && { dateOfBirth: new Date(providerData.dateOfBirth) }),
          updatedById: req.user?.id,
        },
      });

      setAuditContext(req, {
        resourceType: 'providers',
        resourceId: provider.id,
        action: 'update',
        changes: { before: existing, after: provider },
      });

      invalidateCache('dashboard');
      const responseData: Record<string, unknown> = { ...stripSensitiveFields(provider) };
      if (groupNpi) responseData['groupNpi'] = groupNpi;
      if (taxId) responseData['taxId'] = taxId;
      res.json({ success: true, data: responseData });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/providers/:id?reason=<urlencoded> - Soft-delete provider (admin only)
// The reason is a query param (NOT a body) because some proxies strip DELETE bodies and
// since reason is optional the silent-null case would not error. Cap enforced in service.
providerRoutes.delete(
  '/:providerId',
  authorize(...ADMIN_ROLES), requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId'];
      if (!providerId) {
        throw new ValidationError('providerId is required');
      }

      // Hard cap on raw URL length to avoid a runaway query param.
      const rawReason = typeof req.query['reason'] === 'string' ? req.query['reason'] : null;
      if (rawReason && rawReason.length > 2000) {
        throw new ValidationError('reason too long');
      }

      try {
        const { provider, wasAlreadyDeleted } = await softDeleteProvider({
          providerId,
          actorId: req.user?.id,
          reason: rawReason,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.get('user-agent'),
        });
        invalidateCache('dashboard');
        res.json({
          success: true,
          data: {
            provider: stripSensitiveFields(provider),
            alreadyDeleted: wasAlreadyDeleted,
          },
        });
      } catch (e) {
        if ((e as Error).message === 'PROVIDER_NOT_FOUND') {
          throw new NotFoundError('Provider');
        }
        throw e;
      }
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/providers/:id/restore - Restore a soft-deleted provider (admin only)
providerRoutes.post(
  '/:providerId/restore',
  authorize(...ADMIN_ROLES), requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId'];
      if (!providerId) {
        throw new ValidationError('providerId is required');
      }

      try {
        const { provider, wasAlreadyActive } = await restoreProvider({
          providerId,
          actorId: req.user?.id,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.get('user-agent'),
        });
        invalidateCache('dashboard');
        res.json({
          success: true,
          data: {
            provider: stripSensitiveFields(provider),
            alreadyActive: wasAlreadyActive,
          },
        });
      } catch (e) {
        if ((e as Error).message === 'PROVIDER_NOT_FOUND') {
          throw new NotFoundError('Provider');
        }
        throw e;
      }
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/providers/:providerId/caqh-pull - Pull credentials from CAQH (practice_admin accessible)
const caqhPullSchema = z.object({
  caqhProviderId: z.string().optional(),
  npi: z.string().optional(),
}).refine((data) => data.caqhProviderId || data.npi, {
  message: 'At least one of caqhProviderId or npi is required',
});

providerRoutes.post(
  '/:providerId/caqh-pull',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  requireProviderAccess,
  requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = caqhPullSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
        });
      }

      const providerId = req.params['providerId']!;
      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
      }

      // Determine the CAQH provider ID to use
      let caqhId = parsed.data.caqhProviderId || provider.caqhProviderId;

      // If caqhProviderId was provided in the request, update the profile for future syncs
      if (parsed.data.caqhProviderId && parsed.data.caqhProviderId !== provider.caqhProviderId) {
        await prisma.providerProfile.update({
          where: { id: providerId },
          data: { caqhProviderId: parsed.data.caqhProviderId },
        });
        caqhId = parsed.data.caqhProviderId;
      }

      // Fall back to NPI if no CAQH provider ID
      if (!caqhId && parsed.data.npi) {
        caqhId = parsed.data.npi;
      }

      if (!caqhId) {
        return res.status(400).json({
          success: false,
          error: { message: 'Provider has no CAQH ID and none was provided' },
        });
      }

      const caqhService = new CaqhService();
      if (!caqhService.isConfigured()) {
        return res.status(503).json({
          success: false,
          error: { message: 'CAQH integration is not configured' },
        });
      }

      const result = await caqhService.syncProvider(providerId, caqhId);

      // Fetch updated profile for response
      const updatedProvider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          npi: true,
          caqhProviderId: true,
          caqhLastSync: true,
        },
      });

      res.json({
        success: true,
        data: {
          provider: updatedProvider,
          syncId: result.syncId,
          summary: result.changes,
        },
      });
    } catch (error) {
      logger.error('CAQH pull failed:', error);
      next(error);
    }
  }
);

// GET /api/v1/providers/:id/export - Export provider data for forms
providerRoutes.get(
  '/:providerId/export',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const format = req.query['format'] as string || 'caqh';

      const provider = await prisma.providerProfile.findUnique({
        where: { id: req.params['providerId'] },
        include: {
          addresses: true,
          licenses: true,
          boardCertifications: true,
          malpracticeInsurances: true,
          educations: true,
          workHistories: true,
          hospitalAffiliations: true,
          professionalReferences: true,
        },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
      }

      // Format data based on requested format
      const cleaned = stripSensitiveFields(provider);

      // Only include dateOfBirth for admin/staff or the provider themselves
      const isAdminOrStaff = req.user?.role === 'admin' || req.user?.role === 'lanyard_staff' || req.user?.role === 'credentialing_staff' || req.user?.role === 'practice_admin';
      const isSelf = req.user?.providerId === provider.id;
      if (!isAdminOrStaff && !isSelf) {
        delete cleaned.dateOfBirth;
      }

      const exportData = formatProviderForExport(cleaned, format);

      setAuditContext(req, {
        resourceType: 'providers',
        resourceId: provider.id,
        action: 'export',
        changes: { format },
      });

      res.json({ success: true, data: exportData });
    } catch (error) {
      next(error);
    }
  }
);

// Helper function to format provider data for different form types
function formatProviderForExport(provider: any, format: string) {
  const baseData = {
    personalInfo: {
      firstName: provider.firstName,
      lastName: provider.lastName,
      middleName: provider.middleName,
      suffix: provider.suffix,
      npi: provider.npi,
      dateOfBirth: provider.dateOfBirth,
      gender: provider.gender,
      email: provider.email,
      phone: provider.phone,
    },
    addresses: provider.addresses,
    licenses: provider.licenses,
    certifications: provider.boardCertifications,
    malpracticeInsurance: provider.malpracticeInsurances?.[0],
    education: provider.educations,
    workHistory: provider.workHistories,
    hospitalAffiliations: provider.hospitalAffiliations,
    references: provider.professionalReferences,
  };

  if (format === 'caqh') {
    // CAQH-specific field mapping would go here
    return {
      ...baseData,
      caqhProviderId: provider.caqhProviderId,
      taxonomy: provider.taxonomy,
    };
  }

  return baseData;
}
