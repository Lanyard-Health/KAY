import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { prisma } from '../utils/prisma.js';
import { validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
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
import {
  sendChatMessage,
  getUserConversations,
  getConversationMessages,
} from '../services/chat.service.js';

// Helper to check enrollment access for AI operations
async function assertEnrollmentAccess(req: Request, enrollmentId: string): Promise<void> {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin') return;
  if (role === 'credentialing_staff') {
    const enrollment = await prisma.payerEnrollment.findUnique({ where: { id: enrollmentId }, select: { providerId: true } });
    if (!enrollment) return;
    if (!(await validateProviderPracticeAccess(req, enrollment.providerId))) throw new ForbiddenError('Access denied to this enrollment');
    return;
  }

  const enrollment = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { providerId: true },
  });
  if (!enrollment) return; // Let service handle not found
  if (role === 'provider' && userProviderId === enrollment.providerId) return;
  throw new ForbiddenError('Access denied to this enrollment');
}

const aiMutationLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many AI requests. Please wait before trying again.' },
});

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
router.post('/enrollment/:id/generate-email', aiMutationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
    }
    const { id } = req.params;
    await assertEnrollmentAccess(req, id!);
    const { tone, additionalContext } = req.body || {};
    const validTones = ['polite', 'assertive', 'urgent'];
    const validatedTone = tone && validTones.includes(tone) ? tone : undefined;
    const result = await generateFollowUpEmail(id!, { tone: validatedTone, additionalContext });
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
router.post('/enrollment/:id/analyze', aiMutationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
    }
    const { id } = req.params;
    await assertEnrollmentAccess(req, id!);
    const result = await analyzeEnrollment(id!);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to analyze enrollment';
    const status = message.includes('not found') ? 404 : message.includes('budget') ? 429 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * POST /api/v1/ai/portfolio/analyze (admin/staff only - analyzes all enrollments)
 */
router.post('/portfolio/analyze', authorize('admin', 'credentialing_staff'), aiMutationLimit, async (_req: Request, res: Response) => {
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
 * GET /api/v1/ai/recommendations (admin/staff only)
 */
router.get('/recommendations', authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
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
 * PATCH /api/v1/ai/recommendations/:id (admin/staff only)
 */
router.patch('/recommendations/:id', authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
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

/**
 * POST /api/v1/ai/chat — Send a chat message
 */
router.post('/chat', authorize('admin', 'credentialing_staff'), aiMutationLimit, async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'AI is not configured. Set ANTHROPIC_API_KEY.' });
    }
    const { conversationId, message } = req.body || {};
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, error: 'Message must be 2000 characters or fewer' });
    }
    if (conversationId && typeof conversationId !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid conversationId' });
    }
    const result = await sendChatMessage({
      userId: req.user!.id,
      conversationId: conversationId || undefined,
      message: message.trim(),
      req,
    });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to process chat message';
    const status = message.includes('not found') ? 404 : message.includes('budget') ? 429 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * GET /api/v1/ai/chat/conversations — List user's conversations
 */
router.get('/chat/conversations', authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 50);
    const offset = Math.max(parseInt(req.query['offset'] as string) || 0, 0);
    const conversations = await getUserConversations(req.user!.id, limit, offset);
    res.json({ success: true, data: conversations });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
  }
});

/**
 * GET /api/v1/ai/chat/conversations/:id/messages — Get conversation messages
 */
router.get('/chat/conversations/:id/messages', authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await getConversationMessages(id!, req.user!.id);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch messages';
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

export { router as aiRoutes };
