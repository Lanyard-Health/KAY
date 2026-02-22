import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { getOpsDashboardStats, getPracticesOverview, getStaffWorkload, getSlaSummary } from '../services/ops.service.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'ops_staff'));

/** GET /api/v1/ops/dashboard */
router.get('/dashboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getOpsDashboardStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/practices */
router.get('/practices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      search: req.query['search'] as string | undefined,
      serviceTier: req.query['serviceTier'] as string | undefined,
      page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
    };
    const data = await getPracticesOverview(filters);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/practices/:id */
router.get('/practices/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../utils/prisma.js');
    const practice = await prisma.practice.findUnique({
      where: { id: req.params['id'] },
      include: {
        providers: { select: { id: true, firstName: true, lastName: true, npi: true, status: true } },
        opsAssignments: {
          where: { unassignedAt: null },
          include: { staff: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
        opsWorkItems: {
          where: { status: { notIn: ['done', 'cancelled'] } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            assignedTo: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!practice) {
      res.status(404).json({ success: false, error: 'Practice not found' });
      return;
    }
    res.json({ success: true, data: practice });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/staff */
router.get('/staff', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getStaffWorkload();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/staff/:id/workload */
router.get('/staff/:id/workload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getStaffWorkload(req.params['id']);
    if (!data || (Array.isArray(data) && data.length === 0)) {
      res.status(404).json({ success: false, error: 'Staff member not found' });
      return;
    }
    res.json({ success: true, data: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/sla */
router.get('/sla', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      practiceId: req.query['practiceId'] as string | undefined,
      payerId: req.query['payerId'] as string | undefined,
    };
    const data = await getSlaSummary(filters);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/ops/sla/breaches */
router.get('/sla/breaches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      practiceId: req.query['practiceId'] as string | undefined,
      payerId: req.query['payerId'] as string | undefined,
    };
    const summary = await getSlaSummary(filters);
    res.json({ success: true, data: summary.breachedEnrollments });
  } catch (error) {
    next(error);
  }
});

export default router;
