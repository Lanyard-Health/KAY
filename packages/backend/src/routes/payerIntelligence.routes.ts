import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { payerIntelligenceQuerySchema, payerIntelligenceAnalyzeSchema } from '@credential-management/shared';
import { parseQuery } from '../utils/queryValidation.js';
import {
  getPayerAnalytics,
  getPayerLeaderboard,
  analyzePayerWithAI,
  getPayerInsights,
} from '../services/payerIntelligence.service.js';

const aiMutationLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: { message: 'Too many AI requests. Please wait before trying again.' } },
});

const router = Router();

// All routes require auth + admin/staff
router.use(authenticate);
router.use(authorize('admin', 'credentialing_staff'));

/**
 * GET /api/v1/payer-intelligence/analytics
 * Query: ?payerId=uuid (optional)
 */
router.get('/analytics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { payerId } = parseQuery(req.query, payerIntelligenceQuerySchema);
    const analytics = await getPayerAnalytics(payerId);
    res.json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/payer-intelligence/leaderboard
 */
router.get('/leaderboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const leaderboard = await getPayerLeaderboard();
    res.json({ success: true, data: leaderboard });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/payer-intelligence/:payerId/analyze
 */
router.post('/:payerId/analyze', aiMutationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { payerId } = req.params;
    if (!payerId) {
      res.status(400).json({ success: false, error: { message: 'payerId is required' } });
      return;
    }
    const result = await analyzePayerWithAI(payerId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/payer-intelligence/:payerId/insights
 */
router.get('/:payerId/insights', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { payerId } = req.params;
    if (!payerId) {
      res.status(400).json({ success: false, error: { message: 'payerId is required' } });
      return;
    }
    const insights = await getPayerInsights(payerId);
    res.json({ success: true, data: insights });
  } catch (error) {
    next(error);
  }
});

export { router as payerIntelligenceRoutes };
