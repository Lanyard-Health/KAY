import { Router } from 'express';
import type { Request, Response } from 'express';
import { signupLimiter, lookupLimiter } from '../middleware/rate-limit.js';
import * as Sentry from '@sentry/node';
import { practiceSignupSchema } from '@credential-management/shared';
import { registerPractice } from '../services/practiceSignup.service.js';
import { NPIService } from '../services/npi.service.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const router = Router();

// POST /api/v1/practices/register — public, rate-limited (signupLimiter: 5/15min/IP)
router.post('/register', signupLimiter(), async (req: Request, res: Response) => {
  try {
    const parsed = practiceSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { message: 'Validation failed', details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
      });
      return;
    }

    const result = await registerPractice(parsed.data);
    res.status(201).json({ data: result });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
      res.status(409).json({ success: false, error: { message: 'An account with this email already exists' } });
      return;
    }

    // ZodError from shared package (cross-package instanceof may fail)
    if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'ZodError') {
      res.status(400).json({ success: false, error: { message: 'Validation failed' } });
      return;
    }

    logger.error('Practice signup failed:', err);
    res.status(500).json({ success: false, error: { message: 'Registration failed. Please try again.' } });
  }
});

// GET /api/v1/practices/payers — public, rate-limited (lookupLimiter: 10/min/IP)
router.get('/payers', lookupLimiter(), async (_req: Request, res: Response) => {
  try {
    const payers = await prisma.payer.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ data: payers });
  } catch (err) {
    // Explicit Sentry capture — this route swallows errors in its own try/catch
    // so they never reach Sentry.setupExpressErrorHandler. Without this, prod
    // failures show only as a generic 500 envelope with no trace.
    Sentry.captureException(err, { tags: { route: 'GET /api/v1/practices/payers' } });
    logger.error('Failed to fetch public payer list', {
      message: (err as Error)?.message,
      stack: (err as Error)?.stack,
      name: (err as Error)?.name,
    });
    res.status(500).json({ success: false, error: { message: 'Failed to load payers.' } });
  }
});

const npiService = new NPIService();

// GET /api/v1/practices/npi-lookup/:npi — public, rate-limited (lookupLimiter: 10/min/IP)
router.get('/npi-lookup/:npi', lookupLimiter(), async (req: Request, res: Response) => {
  try {
    const { npi } = req.params;
    if (!npi || !/^\d{10}$/.test(npi)) {
      res.status(400).json({ success: false, error: { message: 'Invalid NPI number. Must be exactly 10 digits.' } });
      return;
    }

    const result = await npiService.lookupByNPI(npi);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Public NPI lookup failed:', err);
    res.status(500).json({ success: false, error: { message: 'NPI lookup failed. Please try again.' } });
  }
});

export default router;
