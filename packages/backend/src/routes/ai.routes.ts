import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { prisma } from '../utils/prisma.js';
import { validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import {
  generateEmailSchema,
  expirationAlertSchema,
  updateRecommendationSchema,
  chatMessageSchema,
  chatConversationsQuerySchema,
  recommendationsQuerySchema,
} from '@credential-management/shared';
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
  generateExpirationAlerts,
  getContextualRecommendations,
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
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { providerId: true } });
    if (!enrollment) return;
    if (!(await validateProviderPracticeAccess(req, enrollment.providerId))) throw new ForbiddenError('Access denied to this enrollment');
    return;
  }

  const enrollment = await prisma.enrollment.findUnique({
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
  message: { success: false, error: { message: 'Too many AI requests. Please wait before trying again.' } },
});

const router = Router();

// All AI routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/ai/status
 */
router.get('/status', authorize('admin', 'credentialing_staff', 'practice_admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const modelInfo = getModelInfo();
    const usage = await getTodayTokenUsage();
    res.json({ success: true, data: { ...modelInfo, todayUsage: usage } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/ai/enrollment/:id/generate-email
 */
router.post('/enrollment/:id/generate-email', authorize('admin', 'credentialing_staff', 'practice_admin'), aiMutationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: { message: 'AI service is not available.' } });
    }
    const { id } = req.params;
    await assertEnrollmentAccess(req, id!);
    const { tone, additionalContext } = generateEmailSchema.parse(req.body || {});
    const result = await generateFollowUpEmail(id!, { tone, additionalContext });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/ai/enrollment/:id/analyze
 */
router.post('/enrollment/:id/analyze', authorize('admin', 'credentialing_staff', 'practice_admin'), aiMutationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: { message: 'AI service is not available.' } });
    }
    const { id } = req.params;
    await assertEnrollmentAccess(req, id!);
    const result = await analyzeEnrollment(id!);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/ai/portfolio/analyze (admin/staff only - analyzes all enrollments)
 */
router.post('/portfolio/analyze', authorize('admin', 'credentialing_staff', 'practice_admin'), aiMutationLimit, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: { message: 'AI service is not available.' } });
    }
    const result = await analyzePortfolio();
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/ai/expiration-alerts/generate (admin/staff only)
 */
router.post('/expiration-alerts/generate', authorize('admin', 'credentialing_staff', 'practice_admin'), aiMutationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: { message: 'AI service is not available.' } });
    }
    const { days } = expirationAlertSchema.parse(req.body || {});
    const result = await generateExpirationAlerts(days);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/ai/recommendations (admin/staff only)
 */
router.get('/recommendations', authorize('admin', 'credentialing_staff', 'practice_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, status, enrollmentId } = recommendationsQuerySchema.parse(req.query);
    const providerId = typeof req.query['providerId'] === 'string' ? req.query['providerId'] : undefined;
    const recommendations = await getRecommendations({
      ...(type && { type: type as 'follow_up_email' | 'strategy' | 'priority_alert' }),
      ...(status && { status: status as 'pending' | 'accepted' | 'dismissed' }),
      enrollmentId,
      providerId,
    });
    res.json({ success: true, data: recommendations });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/ai/recommendations/:id (admin/staff only)
 */
router.patch('/recommendations/:id', authorize('admin', 'credentialing_staff', 'practice_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = updateRecommendationSchema.parse(req.body);
    const actedOnBy = req.user?.email;
    const updated = await updateRecommendationStatus(id!, status, actedOnBy);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/ai/usage
 */
router.get('/usage', authorize('admin', 'credentialing_staff', 'practice_admin'), async (_req: Request, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

/**
 * GET /api/v1/ai/contextual-recommendations — Data-driven recommendations for a provider or enrollment
 */
router.get('/contextual-recommendations', authorize('admin', 'credentialing_staff', 'practice_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entityType = req.query['entityType'];
    const entityId = req.query['entityId'];

    if (entityType !== 'provider' && entityType !== 'enrollment') {
      return res.status(400).json({ success: false, error: { message: 'entityType must be "provider" or "enrollment"' } });
    }
    if (typeof entityId !== 'string' || !entityId) {
      return res.status(400).json({ success: false, error: { message: 'entityId is required' } });
    }

    const recommendations = await getContextualRecommendations(entityType, entityId);
    res.json({ success: true, data: recommendations });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/ai/chat — Send a chat message
 */
router.post('/chat', authorize('admin', 'credentialing_staff', 'practice_admin'), aiMutationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: { message: 'AI service is not available.' } });
    }
    const { message, conversationId } = chatMessageSchema.parse(req.body || {});
    const result = await sendChatMessage({
      userId: req.user!.id,
      conversationId: conversationId || undefined,
      message,
      req,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/ai/chat/conversations — List user's conversations
 */
router.get('/chat/conversations', authorize('admin', 'credentialing_staff', 'practice_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset } = chatConversationsQuerySchema.parse(req.query);
    const conversations = await getUserConversations(req.user!.id, limit, offset);
    res.json({ success: true, data: conversations });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/ai/chat/conversations/:id/messages — Get conversation messages
 */
router.get('/chat/conversations/:id/messages', authorize('admin', 'credentialing_staff', 'practice_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await getConversationMessages(id!, req.user!.id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export { router as aiRoutes };
