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

  // Path 2: Bearer token matches BUG_MONITOR_SECRET (used by CI, frontend error boundary)
  if (authHeader && bugMonitorSecret && authHeader === `Bearer ${bugMonitorSecret}`) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      res.status(429).json({ success: false, error: { message: 'Too many requests' } });
      return;
    }
    handleBugReport(req, res);
    return;
  }

  // No valid auth — reject
  res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
});

function handleBugReport(req: Request, res: Response): void {
  const parsed = bugReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { message: 'Invalid bug report', details: parsed.error.issues } });
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

// --- POST /api/v1/bugs/user-report ---
// Beta-tester bug submission from the in-app widget. Unlike the crash endpoint,
// this REQUIRES a real logged-in user (no BUG_MONITOR_SECRET path) and carries
// the tester's plain-English description + captured context. The pipeline runs
// the PII sanitizer, has an AI writer structure it, files to Linear under the
// "Beta feedback" label, and pings Slack. Severity is the tester's own read.

const userReportSchema = z.object({
  description: z.string().min(1).max(5000),
  severity: z.enum(['fyi', 'annoying', 'blocked']).optional().default('annoying'),
  // Free-form captured context (route, userAgent, appCommit, recentErrors, …).
  context: z.record(z.string()).optional().default({}),
  // R2 object key for an uploaded screenshot (upload handled separately).
  screenshotKey: z.string().max(300).optional(),
});

router.post('/user-report', async (req: Request, res: Response) => {
  const isUserAuthed = await tryAuthenticate(req, res);
  if (!isUserAuthed) {
    res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    return;
  }

  const parsed = userReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { message: 'Invalid report', details: parsed.error.issues } });
    return;
  }

  const { description, severity, context, screenshotKey } = parsed.data;
  const metadata: Record<string, string> = {
    ...context,
    userSeverity: severity,
    reporterUserId: req.user?.id ?? 'unknown',
    reporterEmail: req.user?.email ?? '',
    ...(req.practiceScope?.practiceIds?.[0] ? { practiceId: req.practiceScope.practiceIds[0] } : {}),
    ...(screenshotKey ? { screenshotKey } : {}),
  };

  const bugReport: BugReport = {
    source: 'user-report',
    title: description.slice(0, 120),
    errorMessage: description,
    metadata,
    occurredAt: new Date(),
    environment: process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
  };

  // Fire-and-forget — the tester just needs a fast "thanks".
  bugMonitor.reportUserFeedback(bugReport);

  res.status(201).json({ status: 'accepted' });
});

// --- POST /api/v1/bugs/maintenance ---
// NOTE: retryPendingSyncs was removed from BugMonitorService.
// This endpoint is kept as a no-op placeholder for future maintenance tasks.

router.post('/maintenance', (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const bugMonitorSecret = process.env['BUG_MONITOR_SECRET'];

  if (!bugMonitorSecret || !authHeader || authHeader !== `Bearer ${bugMonitorSecret}`) {
    res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    return;
  }

  res.status(200).json({ status: 'ok', message: 'No maintenance tasks configured' });
});

export const bugReportRoutes = router;
