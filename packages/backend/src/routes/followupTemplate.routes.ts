import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { z } from 'zod';
import { nullablePartial } from '@credential-management/shared';

export const followupTemplateRoutes = Router();
followupTemplateRoutes.use(authenticate);
followupTemplateRoutes.use(authorize('admin'));

// ─── Zod Schemas ───────────────────────────────────────────

const stepSchema = z.object({
  stepOrder: z.number().int(),
  name: z.string().min(1),
  channel: z.enum(['email', 'phone_call']),
  triggerDaysAfterPrev: z.number().int(),
  escalationLevel: z.number().int().optional(),
  emailSubject: z.string().nullable().optional(),
  emailBodyTemplate: z.string().nullable().optional(),
  emailTone: z.string().nullable().optional(),
  retellScriptTemplate: z.string().nullable().optional(),
  retellAgentId: z.string().nullable().optional(),
  requiresApproval: z.boolean().optional(),
});

const createTemplateSchema = z.object({
  payerTrackId: z.string().min(1),
  name: z.string().min(1),
  status: z.string().optional(),
  description: z.string().nullable().optional(),
  steps: z.array(stepSchema).optional(),
});

const reorderSchema = z.object({
  order: z.array(z.object({
    id: z.string().min(1),
    stepOrder: z.number().int(),
  })),
});

// ─── Template Routes ───────────────────────────────────────

// List all templates
followupTemplateRoutes.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query['status'] as string | undefined;
      const payerTrackId = req.query['payerTrackId'] as string | undefined;

      const where: Record<string, unknown> = {};
      if (status) where['status'] = status;
      if (payerTrackId) where['payerTrackId'] = payerTrackId;

      const data = await prisma.followUpTemplate.findMany({
        where,
        include: {
          payerTrack: {
            select: { payerName: true, track: true, stateRegion: true },
          },
          _count: {
            select: { steps: true, runs: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Get single template
followupTemplateRoutes.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await prisma.followUpTemplate.findUnique({
        where: { id: req.params['id'] },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          payerTrack: {
            select: { payerName: true, track: true, stateRegion: true },
          },
        },
      });

      if (!data) {
        res.status(404).json({ success: false, error: { message: 'FollowUpTemplate not found' } });
        return;
      }

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Create template
followupTemplateRoutes.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createTemplateSchema.parse(req.body);
      const { steps, ...templateData } = body;

      const data = await prisma.followUpTemplate.create({
        data: {
          ...templateData,
          status: templateData.status ?? 'draft',
          createdBy: req.user!.id,
          steps: steps ? { create: steps as any[] } : undefined,
        },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          payerTrack: {
            select: { payerName: true, track: true, stateRegion: true },
          },
        },
      });

      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Update template
followupTemplateRoutes.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = nullablePartial(createTemplateSchema).omit({ steps: true }).parse(req.body);

      const updateData: Record<string, unknown> = { ...body };
      if (body.status === 'active') {
        updateData['publishedAt'] = new Date();
      }

      const data = await prisma.followUpTemplate.update({
        where: { id: req.params['id'] },
        data: updateData,
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          payerTrack: {
            select: { payerName: true, track: true, stateRegion: true },
          },
        },
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Delete template
followupTemplateRoutes.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.followUpTemplate.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'FollowUpTemplate deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Step Routes ───────────────────────────────────────────

// Create step
followupTemplateRoutes.post(
  '/:templateId/steps',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = stepSchema.parse(req.body);
      const data = await prisma.followUpTemplateStep.create({
        data: {
          ...body,
          template: { connect: { id: req.params['templateId']! } },
        },
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Update step
followupTemplateRoutes.patch(
  '/steps/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = nullablePartial(stepSchema).parse(req.body);
      const data = await prisma.followUpTemplateStep.update({
        where: { id: req.params['id'] },
        data: body,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Delete step
followupTemplateRoutes.delete(
  '/steps/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.followUpTemplateStep.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Step deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// Bulk reorder steps
followupTemplateRoutes.put(
  '/:templateId/steps/reorder',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { order } = reorderSchema.parse(req.body);

      await prisma.$transaction(
        order.map((item) =>
          prisma.followUpTemplateStep.update({
            where: { id: item.id },
            data: { stepOrder: item.stepOrder },
          })
        )
      );

      res.json({ success: true, message: 'Steps reordered' });
    } catch (error) {
      next(error);
    }
  }
);
