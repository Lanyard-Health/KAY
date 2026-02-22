import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import {
  assignStaffToPractice,
  assignStaffToProvider,
  assignStaffToEnrollment,
  removeAssignment,
  transferAssignments,
  updateServiceTier,
  getActiveAssignments,
} from '../services/opsAssignment.service.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'ops_staff'));

/** GET /api/v1/ops/assignments */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      staffId: req.query['staffId'] as string | undefined,
      practiceId: req.query['practiceId'] as string | undefined,
    };
    const data = await getActiveAssignments(filters);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/ops/assignments */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { staffId, practiceId, providerId, enrollmentId } = req.body;
    if (!staffId) {
      res.status(400).json({ success: false, error: 'staffId is required' });
      return;
    }
    if (!practiceId && !providerId && !enrollmentId) {
      res.status(400).json({ success: false, error: 'One of practiceId, providerId, or enrollmentId is required' });
      return;
    }

    let assignment;
    if (practiceId) {
      assignment = await assignStaffToPractice(staffId, practiceId, req.user!.id);
    } else if (providerId) {
      assignment = await assignStaffToProvider(staffId, providerId, req.user!.id);
    } else {
      assignment = await assignStaffToEnrollment(staffId, enrollmentId, req.user!.id);
    }

    res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/v1/ops/assignments/:id */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignment = await removeAssignment(req.params['id']!);
    res.json({ success: true, data: assignment });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/ops/assignments/transfer */
router.post('/transfer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fromStaffId, toStaffId } = req.body;
    if (!fromStaffId || !toStaffId) {
      res.status(400).json({ success: false, error: 'fromStaffId and toStaffId are required' });
      return;
    }
    const result = await transferAssignments(fromStaffId, toStaffId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/ops/practices/:id/service-tier */
router.patch('/practices/:id/service-tier', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tier } = req.body;
    if (!tier) {
      res.status(400).json({ success: false, error: 'tier is required' });
      return;
    }
    const practice = await updateServiceTier(req.params['id']!, tier);
    res.json({ success: true, data: practice });
  } catch (error) {
    next(error);
  }
});

export default router;
