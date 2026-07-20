import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { ForbiddenError, NotFoundError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess, getPracticeRelationFilter } from '../middleware/practiceScope.middleware.js';
import { createTask } from '../services/task.service.js';
import {
  listStaffTasks, getMyTaskCounts, listAssignees,
  createStaffTask, claimTask, assertAssignableUser, notifyAssignee,
} from '../services/staff-task.service.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { HUMAN_TASK_GROUPS, type HumanTaskGroup } from '@credential-management/shared';

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
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
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

      if (validated.assignedToId) {
        try {
          await assertAssignableUser(validated.assignedToId);
        } catch (err) {
          if (err instanceof Error && err.message === 'ASSIGNEE_NOT_ALLOWED') {
            res.status(400).json({
              success: false,
              error: { message: 'Tasks can only be assigned to Lanyard admin or credentialing staff' },
            });
            return;
          }
          throw err;
        }
      }

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
  taskGroup: z.enum(['FOLLOW_UP', 'CALL_BACK', 'SUBMIT_APPLICATION', 'REQUEST_DOCUMENTS', 'CAQH_UPDATE', 'VERIFY_INFORMATION', 'ESCALATION', 'OTHER', 'CHECK_IN']).optional(),
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

// Guided create (Tasks v2). NOT .strict(): a stray `title` from a
// not-yet-refreshed client is silently dropped (deploy-skew tolerance).
const guidedCreateTaskSchema = z.object({
  taskGroup: z.enum(HUMAN_TASK_GROUPS as unknown as [HumanTaskGroup, ...HumanTaskGroup[]]),
  note: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  dueDate: z.string().datetime().optional(),
  assignedToId: z.string().uuid().optional(),
  payerId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  practiceId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
});

const CREATE_ERROR_MESSAGES: Record<string, string> = {
  ENROLLMENT_LINK_EXCLUSIVE: 'A task can link to an enrollment or to a provider/practice, not both',
  PROVIDER_PRACTICE_MISMATCH: "That provider isn't at the selected practice",
  PAYER_NOT_FOUND: 'Payer not found',
  PRACTICE_NOT_FOUND: 'Practice not found',
  PROVIDER_NOT_FOUND: 'Provider not found',
  ASSIGNEE_NOT_ALLOWED: 'Tasks can only be assigned to Lanyard admin or credentialing staff',
};

router.post('/tasks', authenticate, staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // CHECK_IN is system-only (D17): explicit 400 before Zod so the message is human, not a schema error.
    if (req.body?.taskGroup === 'CHECK_IN') {
      res.status(400).json({ success: false, error: { message: 'Check-in tasks are created automatically by the system — pick another task group' } });
      return;
    }
    const v = guidedCreateTaskSchema.parse(req.body);
    const task = await createStaffTask(
      { ...v, dueDate: v.dueDate ? new Date(v.dueDate) : undefined },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: task });
  } catch (error) {
    if (error instanceof Error && error.message in CREATE_ERROR_MESSAGES) {
      res.status(400).json({ success: false, error: { message: CREATE_ERROR_MESSAGES[error.message] } });
      return;
    }
    next(error);
  }
});

router.post('/tasks/:taskId/claim', authenticate, staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params['taskId']!;
    const claimed = await claimTask(taskId, req.user!.id);
    if (!claimed) {
      res.status(409).json({ success: false, error: { code: 'ALREADY_CLAIMED', message: 'Someone else claimed this task first' } });
      return;
    }
    res.json({ success: true, data: { taskId, assignedToId: req.user!.id } });
  } catch (error) { next(error); }
});

router.delete('/tasks/:taskId', authenticate, staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params['taskId']!;
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, createdById: true } });
    if (!task) {
      res.status(404).json({ success: false, error: { message: 'Task not found' } });
      return;
    }
    if (req.user!.role !== 'admin' && task.createdById !== req.user!.id) {
      throw new ForbiddenError('Only the creator or an admin can delete a task');
    }
    await prisma.task.delete({ where: { id: task.id } });
    res.status(204).send();
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

      // Staff-only fields: priority (new — internal triage concept) and
      // assignedToId (reassignment — role-validated below for ALL tasks).
      // title/description/dueDate stay open to practice-side
      // credentialing_staff, unchanged from prior behavior.
      const staffFields = ['priority', 'assignedToId'] as const;
      const touchesStaffFields = staffFields.some((f) => f in req.body);
      if (touchesStaffFields && req.user!.role !== 'admin' && req.user!.role !== 'lanyard_staff') {
        throw new ForbiddenError('Insufficient permissions');
      }

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

      // Assignee-role validation applies to ALL tasks (provider-linked or not):
      // a task may only be assigned to a user with role admin or lanyard_staff,
      // enforced server-side on create, reassign, and claim.
      if (typeof validated.assignedToId === 'string') {
        try {
          await assertAssignableUser(validated.assignedToId);
        } catch (err) {
          if (err instanceof Error && err.message === 'ASSIGNEE_NOT_ALLOWED') {
            return res.status(400).json({
              success: false,
              error: { message: 'Tasks can only be assigned to Lanyard admin or credentialing staff' },
            });
          }
          throw err;
        }
      }

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (validated.title !== undefined) updateData['title'] = validated.title;
      if (validated.description !== undefined) updateData['description'] = validated.description;
      if (validated.priority !== undefined) updateData['priority'] = validated.priority;
      if (validated.assignedToId !== undefined) updateData['assignedToId'] = validated.assignedToId;
      if (validated.dueDate !== undefined) {
        updateData['dueDate'] = validated.dueDate ? new Date(validated.dueDate) : null;
      }

      // Handle status transitions — explicit, or auto-derived from a
      // reassignment (spec: newly assigned + still PENDING -> IN_PROGRESS;
      // unassigned back to the pool -> PENDING). Applies to ALL tasks.
      let statusToSet = validated.status;
      if (statusToSet === undefined && 'assignedToId' in req.body) {
        if (validated.assignedToId && existing.status === 'PENDING') {
          statusToSet = 'IN_PROGRESS';
        } else if (validated.assignedToId === null) {
          statusToSet = 'PENDING';
        }
      }

      if (statusToSet !== undefined) {
        updateData['status'] = statusToSet;

        if (statusToSet === 'COMPLETED') {
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

      // Notify on reassignment to someone other than the actor (any task) —
      // fires only after the update has actually persisted.
      if (
        'assignedToId' in req.body &&
        validated.assignedToId &&
        validated.assignedToId !== existing.assignedToId &&
        validated.assignedToId !== req.user!.id
      ) {
        notifyAssignee(validated.assignedToId, taskId, existing.title);
      }

      res.json({ success: true, data: task });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
