import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';

// Helper to check task access (staff/admin can access all, providers only their own)
async function assertTaskAccess(req: Request, taskId: string): Promise<void> {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin') return;
  if (role === 'credentialing_staff') {
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { providerId: true } });
    if (!t) return;
    if (!(await validateProviderPracticeAccess(req, t.providerId))) throw new ForbiddenError('Access denied to this task');
    return;
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { providerId: true },
  });
  if (!task) return; // Let the 404 be handled by the route
  if (role === 'provider' && userProviderId === task.providerId) return;
  throw new ForbiddenError('Access denied to this task');
}

const router = Router();

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  type: z.enum(['TERMINATE_ENROLLMENT', 'CHECK_AVAILITY', 'UPDATE_CAQH', 'DRAFT_TERM_LETTER', 'CUSTOM']).default('CUSTOM'),
  enrollmentId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

// ==========================================
// PROVIDER-SCOPED TASK ROUTES
// ==========================================

// List tasks for a provider
router.get(
  '/providers/:providerId/tasks',
  authenticate,
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;

      // Optional query filters
      const statusFilter = req.query['status'] as string | undefined;
      const typeFilter = req.query['type'] as string | undefined;

      const where: Record<string, unknown> = { providerId };
      if (statusFilter) {
        where['status'] = statusFilter;
      }
      if (typeFilter) {
        where['type'] = typeFilter;
      }

      const tasks = await prisma.task.findMany({
        where,
        include: {
          enrollment: {
            include: { payer: { select: { name: true } } },
          },
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          completedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      });

      res.json({ success: true, data: tasks });
    } catch (error) {
      next(error);
    }
  }
);

// Create a custom task for a provider
router.post(
  '/providers/:providerId/tasks',
  authenticate,
  authorize('admin', 'lanyard_admin', 'credentialing_staff'), requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const validated = createTaskSchema.parse(req.body);

      // Verify provider exists
      const provider = await prisma.providerProfile.findUnique({
        where: { id: providerId },
        select: { id: true },
      });
      if (!provider) {
        return res.status(404).json({
          success: false,
          error: { message: 'Provider not found' },
        });
      }

      // If enrollmentId provided, verify it belongs to this provider
      if (validated.enrollmentId) {
        const enrollment = await prisma.enrollment.findFirst({
          where: { id: validated.enrollmentId, providerId },
          select: { id: true },
        });
        if (!enrollment) {
          return res.status(404).json({
            success: false,
            error: { message: 'Enrollment not found for this provider' },
          });
        }
      }

      const task = await prisma.task.create({
        data: {
          providerId,
          enrollmentId: validated.enrollmentId ?? null,
          title: validated.title,
          description: validated.description,
          type: validated.type,
          assignedToId: validated.assignedToId,
          dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
        },
        include: {
          enrollment: {
            include: { payer: { select: { name: true } } },
          },
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });

      res.status(201).json({ success: true, data: task });
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

// ==========================================
// INDIVIDUAL TASK ROUTES
// ==========================================

// Get a single task
router.get(
  '/tasks/:taskId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = req.params['taskId']!;
      await assertTaskAccess(req, taskId);

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
          enrollment: {
            include: { payer: { select: { name: true } } },
          },
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          completedBy: { select: { id: true, firstName: true, lastName: true } },
          terminationLetters: true,
        },
      });

      if (!task) {
        return res.status(404).json({
          success: false,
          error: { message: 'Task not found' },
        });
      }

      res.json({ success: true, data: task });
    } catch (error) {
      next(error);
    }
  }
);

// Update a task (admin/staff only — providers get read-only access)
router.patch(
  '/tasks/:taskId',
  authenticate,
  authorize('admin', 'lanyard_admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = req.params['taskId']!;
      const validated = updateTaskSchema.parse(req.body);

      const existing = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { message: 'Task not found' },
        });
      }

      if (!(await validateProviderPracticeAccess(req, existing.providerId))) {
        return res.status(404).json({
          success: false,
          error: { message: 'Task not found' },
        });
      }

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (validated.title !== undefined) updateData['title'] = validated.title;
      if (validated.description !== undefined) updateData['description'] = validated.description;
      if (validated.assignedToId !== undefined) updateData['assignedToId'] = validated.assignedToId;
      if (validated.dueDate !== undefined) {
        updateData['dueDate'] = validated.dueDate ? new Date(validated.dueDate) : null;
      }

      // Handle status transitions
      if (validated.status !== undefined) {
        updateData['status'] = validated.status;

        if (validated.status === 'COMPLETED') {
          updateData['completedAt'] = new Date();
          updateData['completedById'] = req.user!.id;
        } else if (existing.status === 'COMPLETED') {
          // Reverting from COMPLETED — clear completion fields
          updateData['completedAt'] = null;
          updateData['completedById'] = null;
        }
      }

      const task = await prisma.task.update({
        where: { id: taskId },
        data: updateData,
        include: {
          enrollment: {
            include: { payer: { select: { name: true } } },
          },
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          completedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      res.json({ success: true, data: task });
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

export default router;
