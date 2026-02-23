import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { bugMonitor } from '../services/bug-monitor/index.js';
import type { BugReport } from '../services/bug-monitor/types.js';

const router = Router();

// --- Zod validation schema ---

const bugReportSchema = z.object({
  source: z.enum(['backend-runtime', 'frontend-crash', 'ci-failure', 'security']),
  title: z.string().max(200),
  errorMessage: z.string().max(5000),
  errorClass: z.string().max(100).optional(),
  stackTrace: z.string().max(10000).optional(),
  metadata: z.record(z.string()).optional().default({}),
  environment: z.enum(['production', 'development']).optional().default('production'),
});

// --- In-memory rate limiter for unauthenticated requests ---

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// --- Try standard auth as a promise (resolves true if authed, false if not) ---

function tryAuthenticate(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    authenticate(req, res, ((err?: unknown) => {
      // If authenticate calls next() with no error, user is authed
      // If it calls next(error), auth failed — we resolve false
      resolve(!err);
    }) as NextFunction);
  });
}

// --- POST /api/v1/bugs ---

router.post('/', async (req: Request, res: Response) => {
  // Path 1: Try standard user auth
  const isUserAuthed = await tryAuthenticate(req, res);
  if (isUserAuthed) {
    handleBugReport(req, res);
    return;
  }

  const authHeader = req.headers['authorization'];
  const bugMonitorSecret = process.env['BUG_MONITOR_SECRET'];

  // Path 2: Bearer token matches BUG_MONITOR_SECRET
  if (authHeader && bugMonitorSecret && authHeader === `Bearer ${bugMonitorSecret}`) {
    handleBugReport(req, res);
    return;
  }

  // Path 3: Frontend CORS origin with rate limiting
  const origin = req.headers['origin'] || req.headers['referer'] || '';
  const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:5190';

  if (origin && origin.startsWith(frontendUrl)) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    handleBugReport(req, res);
    return;
  }

  // Path 4: None of the above — reject
  res.status(401).json({ error: 'Unauthorized' });
});

function handleBugReport(req: Request, res: Response): void {
  const parsed = bugReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid bug report', details: parsed.error.issues });
    return;
  }

  const bugReport: BugReport = {
    ...parsed.data,
    occurredAt: new Date(),
  };

  // Fire-and-forget — do NOT await
  bugMonitor.report(bugReport);

  res.status(201).json({ status: 'accepted' });
}

// --- POST /api/v1/bugs/maintenance ---

router.post('/maintenance', (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const bugMonitorSecret = process.env['BUG_MONITOR_SECRET'];

  if (!bugMonitorSecret || !authHeader || authHeader !== `Bearer ${bugMonitorSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  bugMonitor.retryPendingSyncs()
    .then(() => {
      res.status(200).json({ status: 'ok' });
    })
    .catch((error) => {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    });
});

export const bugReportRoutes = router;
