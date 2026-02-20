import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ForbiddenError, ValidationError } from '../middleware/error.middleware.js';
import { logger } from '../utils/logger.js';
import {
  getEnrollmentPipeline,
  getExpirationForecast,
  getProviderReadiness,
  getGettingStartedStatus,
} from '../services/reporting.service.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'credentialing_staff', 'practice_admin'));

// ==========================================
// Zod schemas for query parameter validation
// ==========================================

const practiceIdSchema = z.object({
  practiceId: z.string().min(1, 'practiceId is required'),
});

const enrollmentPipelineSchema = practiceIdSchema.extend({
  startDate: z.string().datetime({ offset: true }).optional()
    .or(z.string().date().optional()),
  endDate: z.string().datetime({ offset: true }).optional()
    .or(z.string().date().optional()),
});

const expirationForecastSchema = practiceIdSchema.extend({
  days: z.coerce.number().int().min(1).max(365).optional().default(90),
});

// ==========================================
// Middleware: verify user belongs to the requested practice
// ==========================================

function verifyPracticeAccess(req: Request, practiceId: string): void {
  if (req.practiceScope?.isSuperAdmin) return;

  const userPracticeIds = req.practiceScope?.practiceIds ?? [];
  if (!userPracticeIds.includes(practiceId)) {
    throw new ForbiddenError('You do not have access to this practice.');
  }
}

// ==========================================
// Routes
// ==========================================

/**
 * GET /enrollment-pipeline
 * Query params: practiceId (required), startDate? (ISO), endDate? (ISO)
 */
router.get('/enrollment-pipeline', async (req: Request, res: Response, next: NextFunction) => {
  const endpoint = 'enrollment-pipeline';
  try {
    const parsed = enrollmentPipelineSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', {
        issues: parsed.error.issues,
      });
    }

    const { practiceId, startDate, endDate } = parsed.data;
    verifyPracticeAccess(req, practiceId);

    const data = await getEnrollmentPipeline(
      practiceId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );

    res.set('Cache-Control', 'max-age=300');
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) {
      next(error);
      return;
    }
    logger.error({ event: 'reporting_query_error', endpoint, practiceId: req.query['practiceId'], error });
    res.status(500).json({ success: false, error: 'Failed to load report data' });
  }
});

/**
 * GET /expiration-forecast
 * Query params: practiceId (required), days? (1-365, default 90)
 */
router.get('/expiration-forecast', async (req: Request, res: Response, next: NextFunction) => {
  const endpoint = 'expiration-forecast';
  try {
    const parsed = expirationForecastSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', {
        issues: parsed.error.issues,
      });
    }

    const { practiceId, days } = parsed.data;
    verifyPracticeAccess(req, practiceId);

    const data = await getExpirationForecast(practiceId, days);

    res.set('Cache-Control', 'max-age=300');
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) {
      next(error);
      return;
    }
    logger.error({ event: 'reporting_query_error', endpoint, practiceId: req.query['practiceId'], error });
    res.status(500).json({ success: false, error: 'Failed to load report data' });
  }
});

/**
 * GET /provider-readiness
 * Query params: practiceId (required)
 */
router.get('/provider-readiness', async (req: Request, res: Response, next: NextFunction) => {
  const endpoint = 'provider-readiness';
  try {
    const parsed = practiceIdSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', {
        issues: parsed.error.issues,
      });
    }

    const { practiceId } = parsed.data;
    verifyPracticeAccess(req, practiceId);

    const data = await getProviderReadiness(practiceId);

    res.set('Cache-Control', 'max-age=300');
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) {
      next(error);
      return;
    }
    logger.error({ event: 'reporting_query_error', endpoint, practiceId: req.query['practiceId'], error });
    res.status(500).json({ success: false, error: 'Failed to load report data' });
  }
});

/**
 * GET /getting-started
 * Query params: practiceId (required)
 */
router.get('/getting-started', async (req: Request, res: Response, next: NextFunction) => {
  const endpoint = 'getting-started';
  try {
    const parsed = practiceIdSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', {
        issues: parsed.error.issues,
      });
    }

    const { practiceId } = parsed.data;
    verifyPracticeAccess(req, practiceId);

    const data = await getGettingStartedStatus(practiceId);

    res.set('Cache-Control', 'max-age=300');
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) {
      next(error);
      return;
    }
    logger.error({ event: 'reporting_query_error', endpoint, practiceId: req.query['practiceId'], error });
    res.status(500).json({ success: false, error: 'Failed to load report data' });
  }
});

export default router;
