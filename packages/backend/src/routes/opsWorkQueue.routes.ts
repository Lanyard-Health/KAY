import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
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

/** GET /api/v1/ops/work-items */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      assigneeId: req.query['assigneeId'] as string | undefined,
      practiceId: req.query['practiceId'] as string | undefined,
      status: req.query['status'] ? (Array.isArray(req.query['status']) ? req.query['status'] as string[] : [req.query['status'] as string]) : undefined,
      priority: req.query['priority'] ? (Array.isArray(req.query['priority']) ? req.query['priority'] as string[] : [req.query['priority'] as string]) : undefined,
      category: req.query['category'] ? (Array.isArray(req.query['category']) ? req.query['category'] as string[] : [req.query['category'] as string]) : undefined,
      slaStatus: req.query['slaStatus'] as 'on_track' | 'at_risk' | 'breached' | undefined,
      search: req.query['search'] as string | undefined,
      page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
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
    const { title, description, category, priority, practiceId, providerId, enrollmentId, assignedToId, dueDate, slaDeadline, estimatedMinutes } = req.body;
    if (!title || !category) {
      res.status(400).json({ success: false, error: 'title and category are required' });
      return;
    }
    const item = await createWorkItem({
      title,
      description,
      category,
      priority,
      practiceId,
      providerId,
      enrollmentId,
      assignedToId,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      slaDeadline: slaDeadline ? new Date(slaDeadline) : undefined,
      estimatedMinutes,
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
    const { status, notes, priority, dueDate, blockerNotes, actualMinutes } = req.body;
    if (status) {
      const item = await updateWorkItemStatus(req.params['id']!, status, notes);
      res.json({ success: true, data: item });
      return;
    }
    // General field updates
    const { prisma } = await import('../utils/prisma.js');
    const updateData: Record<string, unknown> = {};
    if (priority) updateData['priority'] = priority;
    if (dueDate) updateData['dueDate'] = new Date(dueDate);
    if (blockerNotes !== undefined) updateData['blockerNotes'] = blockerNotes;
    if (actualMinutes !== undefined) updateData['actualMinutes'] = actualMinutes;
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
    const { staffId } = req.body;
    if (!staffId) {
      res.status(400).json({ success: false, error: 'staffId is required' });
      return;
    }
    const item = await assignWorkItem(req.params['id']!, staffId);
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/ops/work-items/:id/comments */
router.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ success: false, error: 'content is required' });
      return;
    }
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
    const { workItemIds, staffId } = req.body;
    if (!Array.isArray(workItemIds) || !staffId) {
      res.status(400).json({ success: false, error: 'workItemIds (array) and staffId are required' });
      return;
    }
    const count = await bulkAssignWorkItems(workItemIds, staffId);
    res.json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
});

export default router;
