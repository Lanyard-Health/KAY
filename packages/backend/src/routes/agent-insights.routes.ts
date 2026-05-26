import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { generateInsightsReport } from '../services/agent-insights-report.service.js';
import { collectInsights } from '../services/agent-insights.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

const generateBodySchema = z.object({
  daysBack: z.coerce.number().int().min(1).max(90).optional(),
});

/**
 * POST /api/v1/admin/insights/generate
 * Admin-only. Runs the weekly insights aggregation + Haiku summarization
 * and returns the markdown report + raw snapshot.
 *
 * Default window is 7 days; override via `daysBack` (1-90).
 */
router.post('/generate', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  const parsed = generateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
  }

  try {
    const report = await generateInsightsReport(parsed.data.daysBack ?? 7);
    logger.info('Insights report generated', {
      window: report.snapshot.window,
      orchestratorTurns: report.snapshot.orchestratorTurns,
      reportTokens: report.reportTokens,
    });
    return res.json(report);
  } catch (err) {
    logger.error('Insights report generation failed', { error: err });
    return res.status(500).json({ error: 'Report generation failed' });
  }
});

/**
 * GET /api/v1/admin/insights/snapshot
 * Admin-only. Returns just the structured snapshot (no LLM call), useful for
 * dashboards or sanity checks before paying for a full report.
 */
router.get('/snapshot', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  const daysParam = req.query['daysBack'];
  const daysBack = daysParam ? Number(daysParam) : 7;
  if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 90) {
    return res.status(400).json({ error: 'daysBack must be an integer 1-90' });
  }

  try {
    const snapshot = await collectInsights(daysBack);
    return res.json(snapshot);
  } catch (err) {
    logger.error('Insights snapshot failed', { error: err });
    return res.status(500).json({ error: 'Snapshot generation failed' });
  }
});

export default router;
