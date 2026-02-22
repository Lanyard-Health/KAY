import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
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

const createAssignmentSchema = z.object({
  staffId: z.string().uuid(),
  practiceId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
}).refine(
  (data) => data.practiceId || data.providerId || data.enrollmentId,
  { message: 'One of practiceId, providerId, or enrollmentId is required' }
);

const transferSchema = z.object({
  fromStaffId: z.string().uuid(),
  toStaffId: z.string().uuid(),
});

const serviceTierSchema = z.object({
  tier: z.enum(['full_service', 'white_glove', 'self_serve']),
});

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
    const { staffId, practiceId, providerId, enrollmentId } = createAssignmentSchema.parse(req.body);

    let assignment;
    if (practiceId) {
      assignment = await assignStaffToPractice(staffId, practiceId, req.user!.id);
    } else if (providerId) {
      assignment = await assignStaffToProvider(staffId, providerId, req.user!.id);
    } else {
      assignment = await assignStaffToEnrollment(staffId, enrollmentId!, req.user!.id);
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
    const { fromStaffId, toStaffId } = transferSchema.parse(req.body);
    const result = await transferAssignments(fromStaffId, toStaffId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/ops/practices/:id/service-tier */
router.patch('/practices/:id/service-tier', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tier } = serviceTierSchema.parse(req.body);
    const practice = await updateServiceTier(req.params['id']!, tier);
    res.json({ success: true, data: practice });
  } catch (error) {
    next(error);
  }
});

export default router;
