import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { NotFoundError, ValidationError } from '../middleware/error.middleware.js';
import { setAuditContext } from '../middleware/audit.middleware.js';
import { createProviderSchema, updateProviderSchema } from '@credential-management/shared';

export const providerRoutes = Router();

// Apply authentication to all routes
providerRoutes.use(authenticate);

// GET /api/v1/providers - List all providers
providerRoutes.get(
  '/',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query['page'] as string) || 1;
      const pageSize = Math.min(parseInt(req.query['pageSize'] as string) || 20, 100);
      const search = req.query['search'] as string;
      const status = req.query['status'] as string;

      const where = {
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
        prisma.provider.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { lastName: 'asc' },
          include: {
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
        prisma.provider.count({ where }),
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
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = await prisma.provider.findUnique({
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
        },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
      }

      res.json({ success: true, data: provider });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/providers - Create provider
providerRoutes.post(
  '/',
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = createProviderSchema.parse(req.body);

      const provider = await prisma.provider.create({
        data: {
          ...validatedData,
          dateOfBirth: new Date(validatedData.dateOfBirth),
          specialties: validatedData.specialties || [],
          languages: validatedData.languages || [],
          createdById: req.user?.id,
        },
      });

      setAuditContext(req, {
        resourceType: 'providers',
        resourceId: provider.id,
        action: 'create',
      });

      res.status(201).json({ success: true, data: provider });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/providers/:id - Update provider
providerRoutes.put(
  '/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = updateProviderSchema.parse(req.body);

      const existing = await prisma.provider.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!existing) {
        throw new NotFoundError('Provider');
      }

      const provider = await prisma.provider.update({
        where: { id: req.params['providerId'] },
        data: {
          ...validatedData,
          ...(validatedData.dateOfBirth && { dateOfBirth: new Date(validatedData.dateOfBirth) }),
          updatedById: req.user?.id,
        },
      });

      setAuditContext(req, {
        resourceType: 'providers',
        resourceId: provider.id,
        action: 'update',
        changes: { before: existing, after: provider },
      });

      res.json({ success: true, data: provider });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/providers/:id - Soft delete provider
providerRoutes.delete(
  '/:providerId',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.provider.findUnique({
        where: { id: req.params['providerId'] },
      });

      if (!existing) {
        throw new NotFoundError('Provider');
      }

      // Soft delete by setting status to inactive
      await prisma.provider.update({
        where: { id: req.params['providerId'] },
        data: {
          status: 'inactive',
          updatedById: req.user?.id,
        },
      });

      setAuditContext(req, {
        resourceType: 'providers',
        resourceId: req.params['providerId'],
        action: 'delete',
      });

      res.json({ success: true, message: 'Provider deactivated' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/providers/:id/export - Export provider data for forms
providerRoutes.get(
  '/:providerId/export',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const format = req.query['format'] as string || 'caqh';

      const provider = await prisma.provider.findUnique({
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
      const exportData = formatProviderForExport(provider, format);

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
