import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { z } from 'zod';
import { nullablePartial } from '@credential-management/shared';

export const workflowTemplateRoutes = Router();
workflowTemplateRoutes.use(authenticate);
workflowTemplateRoutes.use(authorize('admin'));

// ─── Zod Schemas ───────────────────────────────────────────

const stepSchema = z.object({
  stepOrder: z.number().int(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  stepType: z.string().min(1),
  owner: z.string().min(1),
  requiredDocuments: z.array(z.string()).optional(),
  triggerDaysAfterPrev: z.number().int().nullable().optional(),
  isBlocking: z.boolean().optional(),
  reviewerInstructions: z.string().nullable().optional(),
});

const conditionSchema = z.object({
  conditionType: z.string().min(1),
  conditionValue: z.string().min(1),
  action: z.string().min(1),
  targetStepOrder: z.number().int().nullable().optional(),
  stepDefinition: z.any().nullable().optional(),
});

const createTemplateSchema = z.object({
  payerTrackId: z.string().min(1),
  name: z.string().min(1),
  status: z.string().optional(),
  description: z.string().nullable().optional(),
  steps: z.array(stepSchema).optional(),
  conditions: z.array(conditionSchema).optional(),
});

const reorderSchema = z.object({
  order: z.array(z.object({
    id: z.string().min(1),
    stepOrder: z.number().int(),
  })),
});

// ─── Template Routes ───────────────────────────────────────

// List all templates
workflowTemplateRoutes.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query['status'] as string | undefined;
      const payerTrackId = req.query['payerTrackId'] as string | undefined;

      const where: Record<string, unknown> = {};
      if (status) where['status'] = status;
      if (payerTrackId) where['payerTrackId'] = payerTrackId;

      const data = await prisma.workflowTemplate.findMany({
        where,
        include: {
          payerTrack: {
            select: { payerName: true, track: true, stateRegion: true },
          },
          _count: {
            select: { steps: true, conditions: true, enrollments: true },
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
workflowTemplateRoutes.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await prisma.workflowTemplate.findUnique({
        where: { id: req.params['id'] },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          conditions: { orderBy: { createdAt: 'asc' } },
          payerTrack: {
            select: { payerName: true, track: true, stateRegion: true },
          },
        },
      });

      if (!data) {
        res.status(404).json({ success: false, error: { message: 'WorkflowTemplate not found' } });
        return;
      }

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Create template
workflowTemplateRoutes.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createTemplateSchema.parse(req.body);
      const { steps, conditions, ...templateData } = body;

      const data = await prisma.workflowTemplate.create({
        data: {
          ...templateData,
          status: templateData.status ?? 'draft',
          createdBy: req.user!.id,
          steps: steps ? { create: steps as any[] } : undefined,
          conditions: conditions ? { create: conditions as any[] } : undefined,
        },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          conditions: { orderBy: { createdAt: 'asc' } },
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
workflowTemplateRoutes.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = nullablePartial(createTemplateSchema).omit({ steps: true, conditions: true }).parse(req.body);

      // If status is changing to 'active', set publishedAt
      const updateData: Record<string, unknown> = { ...body };
      if (body.status === 'active') {
        updateData['publishedAt'] = new Date();
      }

      const data = await prisma.workflowTemplate.update({
        where: { id: req.params['id'] },
        data: updateData,
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          conditions: { orderBy: { createdAt: 'asc' } },
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
workflowTemplateRoutes.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.workflowTemplate.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'WorkflowTemplate deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Step Routes ───────────────────────────────────────────

// Create step
workflowTemplateRoutes.post(
  '/:templateId/steps',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = stepSchema.parse(req.body);
      const data = await prisma.workflowTemplateStep.create({
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
workflowTemplateRoutes.patch(
  '/steps/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = nullablePartial(stepSchema).parse(req.body);
      const data = await prisma.workflowTemplateStep.update({
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
workflowTemplateRoutes.delete(
  '/steps/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.workflowTemplateStep.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Step deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// Bulk reorder steps
workflowTemplateRoutes.put(
  '/:templateId/steps/reorder',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { order } = reorderSchema.parse(req.body);

      await prisma.$transaction(
        order.map((item) =>
          prisma.workflowTemplateStep.update({
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

// ─── Condition Routes ──────────────────────────────────────

// Create condition
workflowTemplateRoutes.post(
  '/:templateId/conditions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = conditionSchema.parse(req.body);
      const data = await prisma.workflowTemplateCondition.create({
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

// Delete condition
workflowTemplateRoutes.delete(
  '/conditions/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.workflowTemplateCondition.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Condition deleted' });
    } catch (error) {
      next(error);
    }
  }
);
