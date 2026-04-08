import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { STAFF_ROLES } from '../constants/roles.js';
import * as clinicalProfileService from '../services/clinicalProfile.service.js';

const router = Router();

// ── Zod schemas ─────────────────────────────────────────────────────

const saveClinicalProfileSchema = z.object({
  organizationTypeId: z.string().uuid(),
  specialtyIds: z.array(z.string().uuid()).min(1),
  subSpecialtyIds: z.array(z.string().uuid()).default([]),
  serviceOfferingIds: z.array(z.string().uuid()).default([]),
  customServices: z.array(z.string().min(1).max(200)).default([]),
  patientAgeGroupIds: z.array(z.string().uuid()).default([]),
  patientGenderIdentityIds: z.array(z.string().uuid()).default([]),
  patientSexualOrientationIds: z.array(z.string().uuid()).default([]),
  specialPopulationIds: z.array(z.string().uuid()).default([]),
});

const createCustomServiceSchema = z.object({
  name: z.string().min(1).max(200),
});

// ── Practice scope helper ───────────────────────────────────────────

function hasPracticeAccess(req: Request, practiceId: string): boolean {
  if (!req.user) return false;
  // Admin (isSuperAdmin) can access any practice
  if (req.practiceScope?.isSuperAdmin) return true;
  // Others can only access practices they are assigned to
  return req.practiceScope?.practiceIds?.includes(practiceId) ?? false;
}

// ── Reference data routes (authenticate only) ───────────────────────

router.get(
  '/organization-types',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await clinicalProfileService.getOrganizationTypes();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/specialties',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const section = req.query['section'] as string | undefined;
      if (section && section !== 'INDIVIDUAL' && section !== 'NON_INDIVIDUAL') {
        res.status(400).json({
          success: false,
          error: { message: 'section must be INDIVIDUAL or NON_INDIVIDUAL' },
        });
        return;
      }
      const data = await clinicalProfileService.getSpecialties(
        section as 'INDIVIDUAL' | 'NON_INDIVIDUAL' | undefined
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/sub-specialties',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.query['specialtyIds'] as string | undefined;
      if (!raw) {
        res.status(400).json({
          success: false,
          error: { message: 'specialtyIds query parameter is required' },
        });
        return;
      }
      const ids = raw.split(',').map((s) => s.trim());
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (ids.some((id) => !uuidRegex.test(id))) {
        res.status(400).json({
          success: false,
          error: { message: 'Each specialtyId must be a valid UUID' },
        });
        return;
      }
      const data = await clinicalProfileService.getSubSpecialties(ids);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/services',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await clinicalProfileService.getServices();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/age-groups',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await clinicalProfileService.getAgeGroups();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/gender-identities',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await clinicalProfileService.getGenderIdentities();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/sexual-orientations',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await clinicalProfileService.getSexualOrientations();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/special-populations',
  authenticate,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await clinicalProfileService.getSpecialPopulations();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

// ── Practice-specific routes (authenticate + authorize STAFF_ROLES) ─

router.get(
  '/practices/:practiceId',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(practiceId)) {
        res.status(400).json({
          success: false,
          error: { message: 'practiceId must be a valid UUID' },
        });
        return;
      }

      if (!hasPracticeAccess(req, practiceId)) {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied to this practice' },
        });
        return;
      }

      const data = await clinicalProfileService.getPracticeClinicalProfile(practiceId);
      if (!data) {
        res.status(404).json({
          success: false,
          error: { message: 'Practice not found' },
        });
        return;
      }

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/practices/:practiceId',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(practiceId)) {
        res.status(400).json({
          success: false,
          error: { message: 'practiceId must be a valid UUID' },
        });
        return;
      }

      if (!hasPracticeAccess(req, practiceId)) {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied to this practice' },
        });
        return;
      }

      const validated = saveClinicalProfileSchema.parse(req.body);
      await clinicalProfileService.savePracticeClinicalProfile(practiceId, validated);

      res.json({ success: true, data: { message: 'Clinical profile saved' } });
    } catch (err) {
      if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'ZodError') {
        res.status(400).json({ success: false, error: { message: 'Validation failed' } });
        return;
      }
      next(err);
    }
  }
);

router.post(
  '/practices/:practiceId/custom-services',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId']!;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(practiceId)) {
        res.status(400).json({
          success: false,
          error: { message: 'practiceId must be a valid UUID' },
        });
        return;
      }

      if (!hasPracticeAccess(req, practiceId)) {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied to this practice' },
        });
        return;
      }

      const validated = createCustomServiceSchema.parse(req.body);
      const data = await clinicalProfileService.createCustomService(practiceId, validated.name);

      res.status(201).json({ success: true, data });
    } catch (err) {
      if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'ZodError') {
        res.status(400).json({ success: false, error: { message: 'Validation failed' } });
        return;
      }
      next(err);
    }
  }
);

export default router;
