import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  isConfigured,
  getModelInfo,
  getTodayTokenUsage,
  checkTokenBudget,
  generateFollowUpEmail,
  analyzeEnrollment,
  analyzePortfolio,
  getRecommendations,
  updateRecommendationStatus,
} from '../services/ai.service.js';

const router = Router();

// All AI routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/ai/status
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const modelInfo = getModelInfo();
    const usage = await getTodayTokenUsage();
    res.json({ success: true, data: { ...modelInfo, todayUsage: usage } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch AI status' });
  }
});

/**
 * POST /api/v1/ai/enrollment/:id/generate-email
 */
router.post('/enrollment/:id/generate-email', async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
    }
    const { id } = req.params;
    const { tone, additionalContext } = req.body || {};
    const result = await generateFollowUpEmail(id!, { tone, additionalContext });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate email';
    const status = message.includes('not found') ? 404 : message.includes('budget') ? 429 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * POST /api/v1/ai/enrollment/:id/analyze
 */
router.post('/enrollment/:id/analyze', async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
    }
    const { id } = req.params;
    const result = await analyzeEnrollment(id!);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to analyze enrollment';
    const status = message.includes('not found') ? 404 : message.includes('budget') ? 429 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * POST /api/v1/ai/portfolio/analyze
 */
router.post('/portfolio/analyze', async (_req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
    }
    const result = await analyzePortfolio();
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to analyze portfolio';
    const status = message.includes('budget') ? 429 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * GET /api/v1/ai/recommendations
 */
router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const { type, status, enrollmentId } = req.query;
    const recommendations = await getRecommendations({
      type: type as any,
      status: status as any,
      enrollmentId: enrollmentId as string | undefined,
    });
    res.json({ success: true, data: recommendations });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch recommendations' });
  }
});

/**
 * PATCH /api/v1/ai/recommendations/:id
 */
router.patch('/recommendations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !['accepted', 'dismissed'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be "accepted" or "dismissed"' });
    }
    const actedOnBy = req.user?.email;
    const updated = await updateRecommendationStatus(id!, status, actedOnBy);
    res.json({ success: true, data: updated });
  } catch (error: unknown) {
    const isNotFound = error instanceof Error && 'code' in error && (error as any).code === 'P2025';
    res.status(isNotFound ? 404 : 500).json({
      success: false,
      error: isNotFound ? 'Recommendation not found' : 'Failed to update recommendation',
    });
  }
});

/**
 * GET /api/v1/ai/usage
 */
router.get('/usage', async (_req: Request, res: Response) => {
  try {
    const usage = await getTodayTokenUsage();
    const budget = await checkTokenBudget();
    res.json({
      success: true,
      data: {
        today: usage,
        budget: {
          daily: budget.budget,
          used: budget.used,
          remaining: budget.remaining,
          allowed: budget.allowed,
          percentUsed: budget.budget > 0 ? Math.round((budget.used / budget.budget) * 100) : 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch usage stats' });
  }
});

export { router as aiRoutes };
