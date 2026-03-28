import { Router } from 'express';
import type { Request, Response } from 'express';
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
  message: { success: false, error: 'Too many AI requests. Please wait before trying again.' },
});

const router = Router();

// All routes require auth + admin/staff
router.use(authenticate);
router.use(authorize('admin', 'lanyard_admin', 'credentialing_staff'));

/**
 * GET /api/v1/payer-intelligence/analytics
 * Query: ?payerId=uuid (optional)
 */
router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const { payerId } = parseQuery(req.query, payerIntelligenceQuerySchema);
    const analytics = await getPayerAnalytics(payerId);
    res.json({ success: true, data: analytics });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch analytics';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/v1/payer-intelligence/leaderboard
 */
router.get('/leaderboard', async (_req: Request, res: Response) => {
  try {
    const leaderboard = await getPayerLeaderboard();
    res.json({ success: true, data: leaderboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch leaderboard';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/v1/payer-intelligence/:payerId/analyze
 */
router.post('/:payerId/analyze', aiMutationLimit, async (req: Request, res: Response) => {
  try {
    const { payerId } = req.params;
    if (!payerId) {
      res.status(400).json({ success: false, error: 'payerId is required' });
      return;
    }
    const result = await analyzePayerWithAI(payerId);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to analyze payer';
    const status = message.includes('budget exceeded') ? 429 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * GET /api/v1/payer-intelligence/:payerId/insights
 */
router.get('/:payerId/insights', async (req: Request, res: Response) => {
  try {
    const { payerId } = req.params;
    if (!payerId) {
      res.status(400).json({ success: false, error: 'payerId is required' });
      return;
    }
    const insights = await getPayerInsights(payerId);
    res.json({ success: true, data: insights });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch insights';
    res.status(500).json({ success: false, error: message });
  }
});

export { router as payerIntelligenceRoutes };
