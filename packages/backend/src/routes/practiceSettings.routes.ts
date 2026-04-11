import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { prisma } from '../utils/prisma.js';
import { getOrCreateSettings, upsertSettings } from '../services/practiceSettings.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.use(authenticate);
router.use(authorize(...ADMIN_ROLES));

const settingsSchema = z.object({
  enrollmentCap: z.union([z.null(), z.number().int().positive()]).optional(),
  followUpSubmissions: z.boolean(),
  followUpDenialTriage: z.boolean(),
  multipleLocations: z.boolean(),
});

// GET /api/v1/admin/practices/:practiceId/settings
router.get('/:practiceId/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { practiceId } = req.params;

    const practice = await prisma.practice.findUnique({ where: { id: practiceId }, select: { id: true } });
    if (!practice) {
      return res.status(404).json({ success: false, error: { message: 'Practice not found' } });
    }

    const settings = await getOrCreateSettings(practiceId!);
    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error('Failed to get practice settings:', error);
    next(error);
  }
});

// PUT /api/v1/admin/practices/:practiceId/settings
router.put('/:practiceId/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { practiceId } = req.params;

    const practice = await prisma.practice.findUnique({ where: { id: practiceId }, select: { id: true } });
    if (!practice) {
      return res.status(404).json({ success: false, error: { message: 'Practice not found' } });
    }

    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { message: 'Validation failed', details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
      });
    }

    const settings = await upsertSettings(practiceId!, parsed.data);
    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error('Failed to update practice settings:', error);
    next(error);
  }
});

export default router;
