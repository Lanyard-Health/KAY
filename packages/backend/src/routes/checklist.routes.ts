import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

// Validation schemas
const updateChecklistSchema = z.object({
  w9Status: z.enum(['not_started', 'pending_upload', 'pending_review', 'approved', 'rejected']).optional(),
  w9DocumentId: z.string().uuid().optional().nullable(),
  w9Notes: z.string().optional().nullable(),
  coiStatus: z.enum(['not_started', 'pending_upload', 'pending_review', 'approved', 'rejected']).optional(),
  coiDocumentId: z.string().uuid().optional().nullable(),
  coiNotes: z.string().optional().nullable(),
  cp575Status: z.enum(['not_started', 'pending_upload', 'pending_review', 'approved', 'rejected']).optional(),
  cp575DocumentId: z.string().uuid().optional().nullable(),
  cp575Notes: z.string().optional().nullable(),
  licenseVerified: z.boolean().optional(),
  credentialsComplete: z.boolean().optional(),
  backgroundCheckComplete: z.boolean().optional(),
});

// Get checklist for a provider
router.get(
  '/provider/:providerId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = req.params;

      // Get or create checklist for this provider
      let checklist = await prisma.providerChecklist.findUnique({
        where: { providerId },
      });

      if (!checklist) {
        checklist = await prisma.providerChecklist.create({
          data: { providerId: providerId! },
        });
      }

      // Get associated documents
      const documents = await prisma.document.findMany({
        where: {
          providerId,
          documentType: { in: ['w9', 'coi', 'cp575'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        data: {
          ...checklist,
          documents,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update checklist
router.put(
  '/provider/:providerId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = req.params;
      const validated = updateChecklistSchema.parse(req.body);

      // Check if provider exists
      const provider = await prisma.provider.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        return res.status(404).json({
          success: false,
          error: { message: 'Provider not found' },
        });
      }

      // Get or create checklist
      let checklist = await prisma.providerChecklist.findUnique({
        where: { providerId },
      });

      const updateData: Record<string, unknown> = { ...validated };

      // Add reviewer info for status changes
      if (validated.w9Status === 'approved' || validated.w9Status === 'rejected') {
        updateData['w9ReviewedAt'] = new Date();
        updateData['w9ReviewedBy'] = req.user?.id;
      }
      if (validated.coiStatus === 'approved' || validated.coiStatus === 'rejected') {
        updateData['coiReviewedAt'] = new Date();
        updateData['coiReviewedBy'] = req.user?.id;
      }
      if (validated.cp575Status === 'approved' || validated.cp575Status === 'rejected') {
        updateData['cp575ReviewedAt'] = new Date();
        updateData['cp575ReviewedBy'] = req.user?.id;
      }

      if (checklist) {
        checklist = await prisma.providerChecklist.update({
          where: { providerId },
          data: updateData,
        });
      } else {
        checklist = await prisma.providerChecklist.create({
          data: {
            providerId: providerId!,
            ...updateData,
          },
        });
      }

      // Check if all required items are approved
      const allApproved =
        checklist.w9Status === 'approved' &&
        checklist.coiStatus === 'approved' &&
        checklist.cp575Status === 'approved';

      if (allApproved && !checklist.overallComplete) {
        checklist = await prisma.providerChecklist.update({
          where: { providerId },
          data: {
            overallComplete: true,
            completedAt: new Date(),
          },
        });
      }

      res.json({ success: true, data: checklist });
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

// Link document to checklist item
router.post(
  '/provider/:providerId/link-document',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerId } = req.params;
      const { documentId, checklistItem } = req.body;

      if (!['w9', 'coi', 'cp575'].includes(checklistItem)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid checklist item. Must be w9, coi, or cp575.' },
        });
      }

      // Verify document exists and belongs to provider
      const document = await prisma.document.findFirst({
        where: { id: documentId, providerId },
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          error: { message: 'Document not found' },
        });
      }

      // Update checklist with document link
      const updateData: Record<string, unknown> = {};
      updateData[`${checklistItem}DocumentId`] = documentId;
      updateData[`${checklistItem}Status`] = 'pending_review';

      const checklist = await prisma.providerChecklist.upsert({
        where: { providerId: providerId! },
        update: updateData,
        create: {
          providerId: providerId!,
          ...updateData,
        },
      });

      res.json({ success: true, data: checklist });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
