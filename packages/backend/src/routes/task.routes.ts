import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ForbiddenError, NotFoundError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess, getPracticeRelationFilter } from '../middleware/practiceScope.middleware.js';
import { createTask } from '../services/task.service.js';
import { listStaffTasks, getMyTaskCounts, listAssignees } from '../services/staff-task.service.js';
import { ADMIN_ROLES } from '../constants/roles.js';

// Helper to check task access (staff/admin can access all, providers only their own)
async function assertTaskAccess(req: Request, taskId: string): Promise<void> {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin') return;
  if (role === 'credentialing_staff' || role === 'lanyard_staff') {
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { providerId: true } });
    if (!t) return;
    if (!t.providerId) {
      // Provider-less tasks are internal-only (admin/lanyard_staff). Fail closed:
      // 404 (not 403) so a practice-side credentialing_staff can't even confirm
      // the task exists.
      if (role === 'lanyard_staff') return;
      throw new NotFoundError('Task');
    }
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

const n = <T extends z.ZodTypeAny>(s: T) => z.union([s, z.null()]).optional().transform((v: z.input<T> | null | undefined) => v === null ? undefined : v);
const updateTaskSchema = z.object({
  title: n(z.string().min(1).max(500)),
  description: n(z.string().max(2000)),
  status: n(z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'])),
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

      const where: Record<string, unknown> = { providerId, ...getPracticeRelationFilter(req) };
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
  authorize('admin', 'credentialing_staff'), requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const validated = createTaskSchema.parse(req.body);

      const task = await createTask(
        {
          providerId,
          title: validated.title,
          description: validated.description,
          type: validated.type,
          enrollmentId: validated.enrollmentId,
          assignedToId: validated.assignedToId,
          dueDate: validated.dueDate ? new Date(validated.dueDate) : undefined,
        },
        req.user!.id,
      );

      res.status(201).json({ success: true, data: task });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// STAFF TASK ROUTES (internal team only — not practice credentialing_staff)
// ==========================================

const staffOnly = authorize(...ADMIN_ROLES, 'lanyard_staff'); // internal team ONLY — not practice credentialing_staff

const listTasksQuerySchema = z.object({
  view: z.enum(['my', 'pool', 'all']).default('my'),
  status: z.enum(['open', 'completed', 'all']).default('open'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  practiceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/tasks', authenticate, staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listTasksQuerySchema.parse(req.query);
    const { tasks, total } = await listStaffTasks({ ...q, userId: req.user!.id });
    res.json({ success: true, data: tasks, meta: { total } });
  } catch (error) { next(error); }
});

router.get('/tasks/counts', authenticate, staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getMyTaskCounts(req.user!.id) });
  } catch (error) { next(error); }
});

router.get('/tasks/assignees', authenticate, staffOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listAssignees() });
  } catch (error) { next(error); }
});

// ==========================================
// INDIVIDUAL TASK ROUTES
// ==========================================

// Get a single task
router.get(
  '/tasks/:taskId',
  authenticate,
  authorize('admin', 'credentialing_staff'),
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
  authorize('admin', 'credentialing_staff'),
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

      if (!existing.providerId) {
        // Provider-less tasks are internal-only (admin/lanyard_staff). Fail closed:
        // 404 (not 403) so a practice-side credentialing_staff can't even confirm
        // the task exists.
        const internalRole = req.user!.role === 'admin' || req.user!.role === 'lanyard_staff';
        if (!internalRole) {
          return res.status(404).json({
            success: false,
            error: { message: 'Task not found' },
          });
        }
      } else if (!(await validateProviderPracticeAccess(req, existing.providerId))) {
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
      next(error);
    }
  }
);

export default router;
