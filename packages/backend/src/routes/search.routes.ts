import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { globalSearch } from '../services/search.service.js';
import { getCached, setCache } from '../utils/cache.js';

const router = Router();

router.use(authenticate);

// GET /api/v1/search?q=term
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query['q'] as string) ?? '';
    if (q.trim().length < 2) {
      res.json({ success: true, data: [] });
      return;
    }

    const cacheKey = `search:${req.user?.id}:${q.trim().toLowerCase()}`;
    const cached = getCached<unknown[]>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }

    const results = await globalSearch(req, q);
    setCache(cacheKey, results, 10); // 10s TTL
    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});

export default router;
