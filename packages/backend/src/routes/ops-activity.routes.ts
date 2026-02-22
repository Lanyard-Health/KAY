import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getCached, setCache } from '../utils/cache.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'ops_staff'));

const activityQuerySchema = z.object({
  staffId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  actionType: z.string().optional(),
  practiceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /api/v1/ops/activity */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = activityQuerySchema.parse(req.query);
    const { staffId, startDate, endDate, actionType, practiceId, page, limit } = parsed;

    // Build cache key from filters
    const cacheKey = `ops-activity:${JSON.stringify(parsed)}`;
    const cached = getCached<{ items: unknown[]; total: number; page: number; limit: number }>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }

    // Build where clause
    const where: Record<string, unknown> = {};

    if (staffId) {
      where['userId'] = staffId;
    }

    if (actionType) {
      where['action'] = actionType;
    }

    if (startDate || endDate) {
      const ts: Record<string, Date> = {};
      if (startDate) {
        ts['gte'] = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        ts['lte'] = end;
      }
      where['timestamp'] = ts;
    }

    if (practiceId) {
      where['OR'] = [
        { resourceId: practiceId },
        { changes: { path: ['practiceId'], equals: practiceId } },
      ];
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }],
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    const result = { items, total, page, limit };

    setCache(cacheKey, result, 30_000); // 30s TTL

    logger.info(`Ops activity log queried: ${total} total records, page ${page}`);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
