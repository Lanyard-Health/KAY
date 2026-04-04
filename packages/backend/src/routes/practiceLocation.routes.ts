import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import { encryptSafe, decryptSafe } from '../utils/crypto.js';
import { STAFF_ROLES, ALL_AUTHENTICATED_ROLES } from '../constants/roles.js';
import { NPI_REGEX } from '../constants/validation.js';
import { setAuditContext } from '../middleware/audit.middleware.js';

function maskLocation(location: any) {
  if (!location) return location;
  const { taxIdEncrypted, ...rest } = location;
  const plain = taxIdEncrypted ? decryptSafe(taxIdEncrypted) : null;
  return {
    ...rest,
    taxId: plain ? '****' + plain.slice(-4) : null,
  };
}

// Helper to check location access
async function assertLocationAccess(req: Request, locationId: string): Promise<{ providerId: string } | null> {
  const { role, providerId: userProviderId } = req.user!;
  const location = await prisma.practiceLocation.findUnique({
    where: { id: locationId },
    select: { providerId: true },
  });
  if (!location) return null;
  if (role === 'admin') return location;
  if (role === 'credentialing_staff') {
    if (!(await validateProviderPracticeAccess(req, location.providerId))) throw new ForbiddenError('Access denied to this practice location');
    return location;
  }
  if (role === 'provider' && userProviderId === location.providerId) return location;
  throw new ForbiddenError('Access denied to this practice location');
}

const router = Router();

// Validation schemas
const createPracticeLocationSchema = z.object({
  locationName: z.string().min(1).max(200),
  locationType: z.string().min(1).max(50),
  isPrimary: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(2),
  // eslint-disable-next-line security/detect-unsafe-regex -- safe pattern: no nested quantifiers or backtracking ambiguity
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
  county: z.string().max(100).optional(),
  country: z.string().max(2).optional().default('US'),
  phone: z.string().min(1).max(20),
  fax: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  taxId: z.string().max(20).optional(),
  npi: z.string().regex(NPI_REGEX).optional().or(z.literal('')),
  groupNpi: z.string().regex(NPI_REGEX).optional().or(z.literal('')),
  officeHours: z.record(z.object({
    open: z.string(),
    close: z.string(),
    closed: z.boolean().optional(),
  })).optional(),
  wheelchairAccessible: z.boolean().optional().default(false),
  publicTransitAccess: z.boolean().optional().default(false),
  parkingAvailable: z.boolean().optional().default(true),
  acceptingNewPatients: z.boolean().optional().default(true),
  languagesSpoken: z.array(z.string()).optional().default([]),
  specialServices: z.array(z.string()).optional().default([]),
  notes: z.string().optional(),
});

const updatePracticeLocationSchema = createPracticeLocationSchema.partial();

// Get all practice locations for a provider
router.get(
  '/provider/:providerId',
  authenticate,
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const locations = await prisma.practiceLocation.findMany({
        where: { providerId },
        orderBy: [{ isPrimary: 'desc' }, { locationName: 'asc' }],
      });

      res.json({ success: true, data: locations.map(maskLocation) });
    } catch (error) {
      next(error);
    }
  }
);

// Get a single practice location
router.get(
  '/:id',
  authenticate,
  authorize(...ALL_AUTHENTICATED_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;

      const location = await assertLocationAccess(req, id!);
      if (!location) {
        return res.status(404).json({
          success: false,
          error: { message: 'Practice location not found' },
        });
      }

      const fullLocation = await prisma.practiceLocation.findUnique({
        where: { id },
      });

      res.json({ success: true, data: maskLocation(fullLocation) });
    } catch (error) {
      next(error);
    }
  }
);

// Create a new practice location
router.post(
  '/provider/:providerId',
  authenticate,
  authorize(...STAFF_ROLES),
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const validated = createPracticeLocationSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'practice_location', action: 'create' });

      // If this is set as primary, unset other primary locations
      if (validated.isPrimary) {
        await prisma.practiceLocation.updateMany({
          where: { providerId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const { taxId, ...rest } = validated;
      const location = await prisma.practiceLocation.create({
        data: {
          ...rest,
          taxIdEncrypted: taxId ? encryptSafe(taxId) : null,
          providerId: providerId!,
          email: rest.email || null,
          npi: rest.npi || null,
          createdById: req.user?.id,
        },
      });

      res.status(201).json({ success: true, data: maskLocation(location) });
    } catch (error) {
      next(error);
    }
  }
);

// Update a practice location
router.put(
  '/:id',
  authenticate,
  authorize(...ALL_AUTHENTICATED_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;
      const validated = updatePracticeLocationSchema.parse(req.body);

      setAuditContext(req, { resourceType: 'practice_location', resourceId: req.params['id'], action: 'update' });

      const existing = await assertLocationAccess(req, id!);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Practice location not found' },
        });
      }

      const fullExisting = await prisma.practiceLocation.findUnique({
        where: { id },
      });

      // If this is being set as primary, unset other primary locations
      if (validated.isPrimary && !fullExisting!.isPrimary) {
        await prisma.practiceLocation.updateMany({
          where: { providerId: existing.providerId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const { taxId: updateTaxId, ...updateRest } = validated;
      const location = await prisma.practiceLocation.update({
        where: { id },
        data: {
          ...updateRest,
          ...(updateTaxId !== undefined ? { taxIdEncrypted: updateTaxId ? encryptSafe(updateTaxId) : null } : {}),
          email: updateRest.email || null,
          npi: updateRest.npi || null,
          updatedById: req.user?.id,
        },
      });

      res.json({ success: true, data: maskLocation(location) });
    } catch (error) {
      next(error);
    }
  }
);

// Delete a practice location (admin/staff only)
router.delete(
  '/:id',
  authenticate,
  authorize(...STAFF_ROLES),
  authorize('admin', 'lanyard_admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;

      setAuditContext(req, { resourceType: 'practice_location', resourceId: req.params['id'], action: 'delete' });

      const existing = await prisma.practiceLocation.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Practice location not found' },
        });
      }

      if (!(await validateProviderPracticeAccess(req, existing.providerId))) {
        return res.status(404).json({
          success: false,
          error: { message: 'Practice location not found' },
        });
      }

      await prisma.practiceLocation.delete({ where: { id } });

      res.json({ success: true, data: { message: 'Practice location deleted' } });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
