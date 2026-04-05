import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { getEnrollmentMatrix } from '../services/command-center.service.js';
import { getPracticeProviderFilter } from '../middleware/practiceScope.middleware.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'credentialing_staff', 'practice_admin'));

/**
 * GET /api/v1/command-center/matrix
 * Returns provider × payer enrollment matrix. Cached 30s.
 */
router.get('/matrix', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const practiceFilter = getPracticeProviderFilter(req);
    const matrix = await getEnrollmentMatrix(practiceFilter);
    res.json({ success: true, data: matrix });
  } catch (error) {
    next(error);
  }
});

export default router;
