import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { generateTerminationLetter } from '../services/terminationLetter.service.js';
import { logger } from '../utils/logger.js';

// Helper: staff/admin can access all letters, providers only their own
async function assertLetterAccess(req: Request, letterId: string): Promise<void> {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin' || role === 'credentialing_staff') return;

  const letter = await prisma.terminationLetter.findUnique({
    where: { id: letterId },
    select: { providerId: true },
  });
  if (!letter) return; // Let 404 be handled by the route
  if (role === 'provider' && userProviderId === letter.providerId) return;
  throw new ForbiddenError('Access denied to this termination letter');
}

const router = Router();

// Validation schemas
const generateLetterSchema = z.object({
  enrollmentId: z.string().uuid(),
});

const updateLetterSchema = z.object({
  letterContent: z.string().min(1).max(50000).optional(),
  status: z.enum(['REVIEWED']).optional(),
});

// ==========================================
// PROVIDER-SCOPED ROUTES
// ==========================================

// Generate a draft termination letter for an enrollment
router.post(
  '/providers/:providerId/termination-letters/generate',
  authenticate,
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const validated = generateLetterSchema.parse(req.body);

      // Verify provider exists
      const provider = await prisma.provider.findUnique({
        where: { id: providerId },
        select: { id: true },
      });
      if (!provider) {
        return res.status(404).json({
          success: false,
          error: { message: 'Provider not found' },
        });
      }

      // Verify enrollment belongs to this provider
      const enrollment = await prisma.payerEnrollment.findFirst({
        where: { id: validated.enrollmentId, providerId },
        select: { id: true },
      });
      if (!enrollment) {
        return res.status(404).json({
          success: false,
          error: { message: 'Enrollment not found for this provider' },
        });
      }

      // Find or create the DRAFT_TERM_LETTER task for this enrollment
      let task = await prisma.task.findFirst({
        where: {
          providerId,
          enrollmentId: validated.enrollmentId,
          type: 'DRAFT_TERM_LETTER',
        },
        select: { id: true },
      });

      if (!task) {
        // Create the task if it doesn't exist yet (manual generation flow)
        const enrollmentWithPayer = await prisma.payerEnrollment.findUnique({
          where: { id: validated.enrollmentId },
          include: { payer: { select: { name: true } } },
        });

        task = await prisma.task.create({
          data: {
            providerId,
            enrollmentId: validated.enrollmentId,
            title: `Draft termination letter for ${enrollmentWithPayer!.payer.name}`,
            description: `Prepare and send a formal termination letter to ${enrollmentWithPayer!.payer.name}.`,
            type: 'DRAFT_TERM_LETTER',
          },
          select: { id: true },
        });
      }

      // Check if a letter already exists for this task
      const existingLetter = await prisma.terminationLetter.findFirst({
        where: { taskId: task.id },
      });
      if (existingLetter) {
        return res.status(409).json({
          success: false,
          error: { message: 'A termination letter already exists for this enrollment. Use the PATCH endpoint to edit it.' },
        });
      }

      const letter = await generateTerminationLetter(
        providerId,
        validated.enrollmentId,
        task.id
      );

      res.status(201).json({ success: true, data: letter });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', details: error.errors },
        });
      }
      next(error);
    }
  }
);

// List all termination letters for a provider
router.get(
  '/providers/:providerId/termination-letters',
  authenticate,
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      const letters = await prisma.terminationLetter.findMany({
        where: { providerId },
        select: {
          id: true,
          payerName: true,
          providerName: true,
          npi: true,
          status: true,
          reviewedAt: true,
          sentAt: true,
          createdAt: true,
          updatedAt: true,
          task: {
            select: { id: true, status: true, enrollmentId: true },
          },
          reviewedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: letters });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// INDIVIDUAL LETTER ROUTES
// ==========================================

// Get a single termination letter with full content
router.get(
  '/termination-letters/:letterId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const letterId = req.params['letterId']!;
      await assertLetterAccess(req, letterId);

      const letter = await prisma.terminationLetter.findUnique({
        where: { id: letterId },
        include: {
          task: {
            select: { id: true, status: true, enrollmentId: true, title: true },
          },
          reviewedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      if (!letter) {
        return res.status(404).json({
          success: false,
          error: { message: 'Termination letter not found' },
        });
      }

      res.json({ success: true, data: letter });
    } catch (error) {
      next(error);
    }
  }
);

// Update letter content or mark as REVIEWED
router.patch(
  '/termination-letters/:letterId',
  authenticate,
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const letterId = req.params['letterId']!;
      const validated = updateLetterSchema.parse(req.body);

      const existing = await prisma.terminationLetter.findUnique({
        where: { id: letterId },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Termination letter not found' },
        });
      }

      if (existing.status === 'SENT') {
        return res.status(400).json({
          success: false,
          error: { message: 'Cannot edit a letter that has already been sent' },
        });
      }

      const updateData: Record<string, unknown> = {};

      if (validated.letterContent !== undefined) {
        updateData['letterContent'] = validated.letterContent;
      }

      if (validated.status === 'REVIEWED') {
        updateData['status'] = 'REVIEWED';
        updateData['reviewedById'] = req.user!.id;
        updateData['reviewedAt'] = new Date();
      }

      const letter = await prisma.terminationLetter.update({
        where: { id: letterId },
        data: updateData,
        include: {
          reviewedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      res.json({ success: true, data: letter });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', details: error.errors },
        });
      }
      next(error);
    }
  }
);

// Mark letter as SENT
router.post(
  '/termination-letters/:letterId/send',
  authenticate,
  authorize('admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const letterId = req.params['letterId']!;

      const existing = await prisma.terminationLetter.findUnique({
        where: { id: letterId },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Termination letter not found' },
        });
      }

      if (existing.status === 'SENT') {
        return res.status(400).json({
          success: false,
          error: { message: 'This letter has already been sent' },
        });
      }

      const letter = await prisma.terminationLetter.update({
        where: { id: letterId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      // Also mark the associated DRAFT_TERM_LETTER task as COMPLETED
      await prisma.task.update({
        where: { id: existing.taskId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedById: req.user!.id,
        },
      });

      logger.info(
        `Termination letter ${letterId} marked as SENT by user ${req.user!.id} for payer "${existing.payerName}"`
      );

      res.json({ success: true, data: letter });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
