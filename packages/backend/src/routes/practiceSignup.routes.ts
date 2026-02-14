import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { practiceSignupSchema } from '@credential-management/shared';
import { registerPractice } from '../services/practiceSignup.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Rate limit: 5 requests per 15 minutes per IP (disabled in dev for E2E testing)
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env['NODE_ENV'] === 'development' ? 100 : 5,
  message: { error: 'Too many signup attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/v1/practices/register — public, rate-limited
router.post('/register', signupLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = practiceSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const result = await registerPractice(parsed.data);
    res.status(201).json({ data: result });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    // ZodError from shared package (cross-package instanceof may fail)
    if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'ZodError') {
      res.status(400).json({ error: 'Validation failed' });
      return;
    }

    logger.error('Practice signup failed:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

export default router;
