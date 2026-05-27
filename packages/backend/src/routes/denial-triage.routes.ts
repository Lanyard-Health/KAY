/**
 * Denial Triage Routes
 *
 * GET    /denials           — list denial triages (filter by status)
 * GET    /denials/:id       — get single denial triage with enrollment context
 * PATCH  /denials/:id       — mark as reviewed or actioned
 *
 * Practice scoping: DenialTriage has no direct practiceId column. Scope is
 * enforced through the relation chain DenialTriage → Enrollment → Provider →
 * practiceId. Super admins bypass. Pre-fix (Tier 1 #2 audit), staff at one
 * practice could see and modify denials belonging to other practices.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';

const router = Router();

/**
 * Returns the practice-scope WHERE fragment for DenialTriage queries.
 * Super admins: `{}` (no filter). Staff: traverses enrollment → provider →
 * practiceId. Users with no practice assignments match nothing.
 */
function denialScopeFilter(req: Request): Record<string, unknown> {
  if (req.practiceScope?.isSuperAdmin) return {};
  const ids = req.practiceScope?.practiceIds ?? [];
  if (ids.length === 0) {
    return { enrollment: { provider: { id: '__no_access__' } } };
  }
  return { enrollment: { provider: { practiceId: { in: ids } } } };
}

// ─── List denial triages ────────────────────────────────

router.get(
  '/',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query['status'] as string | undefined;

      const where: any = { ...denialScopeFilter(req) };
      if (status) where.status = status;

      const triages = await prisma.denialTriage.findMany({
        where,
        include: {
          enrollment: {
            include: {
              provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
              payer: { select: { id: true, name: true } },
              payerTrack: { select: { id: true, track: true, stateRegion: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: triages });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Get single denial triage ───────────────────────────

router.get(
  '/:id',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const triage = await prisma.denialTriage.findFirst({
        where: { id, ...denialScopeFilter(req) },
        include: {
          enrollment: {
            include: {
              provider: { select: { id: true, firstName: true, lastName: true, npi: true, entityType: true } },
              payer: { select: { id: true, name: true } },
              payerTrack: {
                select: {
                  id: true, payerName: true, track: true, stateRegion: true,
                  submissionMethod: true, enrollmentLink: true,
                },
              },
            },
          },
        },
      });

      if (!triage) {
        return res.status(404).json({
          success: false,
          error: { message: 'Denial triage not found' },
        });
      }

      res.json({ success: true, data: triage });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Update denial triage (review / action) ─────────────

const updateSchema = z.object({
  status: z.enum(['reviewed', 'actioned']),
  reviewNotes: z.union([z.string(), z.null()]).optional().transform((v) => v === null ? undefined : v),
});

router.patch(
  '/:id',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const validated = updateSchema.parse(req.body);

      const existing = await prisma.denialTriage.findFirst({
        where: { id, ...denialScopeFilter(req) },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Denial triage not found' },
        });
      }

      const triage = await prisma.denialTriage.update({
        where: { id },
        data: {
          status: validated.status,
          reviewedBy: req.user!.id,
          reviewedAt: new Date(),
          reviewNotes: validated.reviewNotes || null,
        },
      });

      res.json({ success: true, data: triage });
    } catch (error) {
      next(error);
    }
  }
);

export { router as denialTriageRoutes };
