import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import {
  createWorkItem,
  getWorkQueue,
  getMyWorkItems,
  updateWorkItemStatus,
  assignWorkItem,
  bulkAssignWorkItems,
  addComment,
  getComments,
} from '../services/opsWorkQueue.service.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'ops_staff'));

const workQueueQuerySchema = z.object({
  assigneeId: z.string().uuid().optional(),
  practiceId: z.string().uuid().optional(),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  priority: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  slaStatus: z.enum(['on_track', 'at_risk', 'breached']).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const createWorkItemSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  category: z.enum(['initial_enrollment', 're_credentialing', 'follow_up', 'document_collection', 'payer_outreach', 'data_entry', 'verification', 'termination', 'general']),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).default('normal'),
  practiceId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  slaDeadline: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(0).max(10000).optional(),
});

const updateWorkItemSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'waiting_external', 'review', 'done', 'cancelled']).optional(),
  notes: z.string().max(5000).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  dueDate: z.string().datetime().optional(),
  blockerNotes: z.string().max(2000).optional().nullable(),
  actualMinutes: z.number().int().min(0).max(10000).optional(),
});

const assignSchema = z.object({
  staffId: z.string().uuid(),
});

const commentSchema = z.object({
  content: z.string().min(1).max(5000),
});

const bulkAssignSchema = z.object({
  workItemIds: z.array(z.string().uuid()).min(1).max(100),
  staffId: z.string().uuid(),
});

/** GET /api/v1/ops/work-items */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = workQueueQuerySchema.parse(req.query);
    const filters = {
      ...parsed,
      status: parsed.status ? (Array.isArray(parsed.status) ? parsed.status : [parsed.status]) : undefined,
      priority: parsed.priority ? (Array.isArray(parsed.priority) ? parsed.priority : [parsed.priority]) : undefined,
      category: parsed.category ? (Array.isArray(parsed.category) ? parsed.category : [parsed.category]) : undefined,
    };
    const data = await getWorkQueue(filters);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/work-items/my */
router.get('/my', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getMyWorkItems(req.user!.id);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/ops/work-items */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createWorkItemSchema.parse(req.body);
    const item = await createWorkItem({
      ...parsed,
      dueDate: parsed.dueDate ? new Date(parsed.dueDate) : undefined,
      slaDeadline: parsed.slaDeadline ? new Date(parsed.slaDeadline) : undefined,
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/work-items/:id */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../utils/prisma.js');
    const item = await prisma.opsWorkItem.findUnique({
      where: { id: req.params['id'] },
      include: {
        practice: { select: { id: true, name: true } },
        provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
        enrollment: { include: { payer: { select: { id: true, name: true } } } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!item) {
      res.status(404).json({ success: false, error: 'Work item not found' });
      return;
    }
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/ops/work-items/:id */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateWorkItemSchema.parse(req.body);
    if (parsed.status) {
      const item = await updateWorkItemStatus(req.params['id']!, parsed.status, parsed.notes);
      res.json({ success: true, data: item });
      return;
    }
    // General field updates
    const { prisma } = await import('../utils/prisma.js');
    const updateData: Record<string, unknown> = {};
    if (parsed.priority) updateData['priority'] = parsed.priority;
    if (parsed.dueDate) updateData['dueDate'] = new Date(parsed.dueDate);
    if (parsed.blockerNotes !== undefined) updateData['blockerNotes'] = parsed.blockerNotes;
    if (parsed.actualMinutes !== undefined) updateData['actualMinutes'] = parsed.actualMinutes;
    const item = await prisma.opsWorkItem.update({
      where: { id: req.params['id'] },
      data: updateData,
    });
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/ops/work-items/:id/assign */
router.post('/:id/assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { staffId } = assignSchema.parse(req.body);
    const item = await assignWorkItem(req.params['id']!, staffId);
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/ops/work-items/:id/comments */
router.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = commentSchema.parse(req.body);
    const comment = await addComment(req.params['id']!, req.user!.id, content);
    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/work-items/:id/comments */
router.get('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const comments = await getComments(req.params['id']!);
    res.json({ success: true, data: comments });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/ops/work-items/bulk-assign */
router.post('/bulk-assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workItemIds, staffId } = bulkAssignSchema.parse(req.body);
    const count = await bulkAssignWorkItems(workItemIds, staffId);
    res.json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
});

export default router;
