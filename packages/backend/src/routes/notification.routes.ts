import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ALL_AUTHENTICATED_ROLES, STAFF_ROLES } from '../constants/roles.js';
import { prisma } from '../utils/prisma.js';
import { notificationService } from '../services/notification.service.js';
import { verifyUnsubscribeToken } from '../services/enrollment-alerts.service.js';
import { markNotificationsReadSchema, notificationPreferencesSchema } from '@credential-management/shared';
import { parseQuery, limitOffsetSchema } from '../utils/queryValidation.js';

const notificationQuerySchema = limitOffsetSchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});

const router = Router();

/**
 * GET /api/v1/notifications/unsubscribe?token=...
 * One-click email opt-out from an email footer link. PUBLIC — registered
 * before the auth middleware because it's clicked from an email, not the app.
 * The signed token only authorizes flipping ONE preference to false.
 */
router.get('/unsubscribe', async (req: Request, res: Response) => {
  const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
  const verified = token ? verifyUnsubscribeToken(token) : null;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!verified) {
    res.status(400).send(unsubscribePage(
      'This unsubscribe link is invalid or has expired.',
      'You can manage all email notifications from Settings in the portal.',
    ));
    return;
  }

  try {
    const current = await notificationService.getPreferences(verified.userId);
    await notificationService.updatePreferences(verified.userId, {
      ...current,
      [verified.prefKey]: false,
    });
    const label = {
      enrollmentStatusChanges: 'enrollment status emails',
      denialAlerts: 'denial alert emails',
      weeklySummary: 'the weekly summary email',
    }[verified.prefKey];
    res.send(unsubscribePage(
      `You're unsubscribed from ${label}.`,
      'You can turn them back on anytime from Settings in the portal.',
    ));
  } catch {
    res.status(500).send(unsubscribePage(
      'Something went wrong.',
      'Please try the link again, or manage notifications from Settings in the portal.',
    ));
  }
});

function unsubscribePage(headline: string, sub: string): string {
  const settingsUrl = `${process.env['FRONTEND_URL'] || 'https://portal.lanyardhealth.com'}/settings`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lanyard Health</title></head>
<body style="margin:0;background:#F4F7F5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:480px;margin:64px auto;padding:32px;background:#FDFEFD;border:1px solid #E2EAE5;border-radius:12px;text-align:center;">
<h1 style="margin:0 0 12px 0;font-size:20px;color:#14241E;">${headline}</h1>
<p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#3A4A43;">${sub}</p>
<a href="${settingsUrl}" style="display:inline-block;padding:10px 20px;background:#0A3D2E;color:#F4F9F6;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Open notification settings</a>
</div></body></html>`;
}

// All routes below require authentication (any role)
router.use(authenticate);
router.use(authorize(...ALL_AUTHENTICATED_ROLES));

/**
 * GET /api/v1/notifications
 * Get current user's notifications
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { unreadOnly, limit, offset } = parseQuery(req.query as Record<string, unknown>, notificationQuerySchema);

    const result = await notificationService.getNotifications(userId, {
      unreadOnly,
      limit,
      offset,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/notifications/sent-history?practiceId=...&limit=...
 * Read-only history of everything a practice has been sent (email + in-app).
 * Staff pass ?practiceId; practice admins are always scoped to their own
 * practice regardless of what they pass. Providers are excluded by the
 * route-level role gate.
 */
const sentHistoryQuerySchema = z.object({
  practiceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get('/sent-history', authorize(...STAFF_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { practiceId: queryPracticeId, limit } = parseQuery(
      req.query as Record<string, unknown>,
      sentHistoryQuerySchema,
    );

    let practiceId = queryPracticeId;
    if (req.user!.role === 'practice_admin') {
      const membership = await prisma.userPractice.findFirst({
        where: { userId: req.user!.id },
        select: { practiceId: true },
      });
      if (!membership) {
        res.status(404).json({ success: false, error: { message: 'No practice found for this user' } });
        return;
      }
      practiceId = membership.practiceId;
    }
    if (!practiceId) {
      res.status(400).json({ success: false, error: { message: 'practiceId is required' } });
      return;
    }

    const items = await notificationService.getPracticeSentHistory(practiceId, limit);
    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/notifications/unread-count
 * Lightweight badge count
 */
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const unreadCount = await notificationService.getUnreadCount(userId);
    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch unread count' } });
  }
});

/**
 * POST /api/v1/notifications/mark-read
 * Mark specific or all notifications as read
 */
router.post('/mark-read', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const parsed = markNotificationsReadSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: 'Invalid request body', details: parsed.error.issues } });
      return;
    }

    await notificationService.markAsRead(userId, parsed.data.notificationIds);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to mark notifications as read' } });
  }
});

/**
 * GET /api/v1/notifications/preferences
 * Current user's email notification preferences (defaults if never saved)
 */
router.get('/preferences', async (req: Request, res: Response) => {
  try {
    const prefs = await notificationService.getPreferences(req.user!.id);
    res.json({ success: true, data: prefs });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch notification preferences' } });
  }
});

/**
 * PUT /api/v1/notifications/preferences
 * Replace current user's email notification preferences
 */
router.put('/preferences', async (req: Request, res: Response) => {
  try {
    const parsed = notificationPreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: 'Invalid request body', details: parsed.error.issues } });
      return;
    }
    const prefs = await notificationService.updatePreferences(req.user!.id, parsed.data);
    res.json({ success: true, data: prefs });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to update notification preferences' } });
  }
});

/**
 * POST /api/v1/notifications/digest/run
 * Manual weekly-digest trigger for verification (admin + lanyard_staff only —
 * lanyard_staff passes via credentialing_staff inheritance then the explicit
 * check below).
 */
router.post('/digest/run', async (req: Request, res: Response) => {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'lanyard_staff') {
      res.status(403).json({ success: false, error: { message: 'Not authorized' } });
      return;
    }
    const { runWeeklyDigest } = await import('../services/weekly-digest.service.js');
    const result = await runWeeklyDigest();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to run weekly digest' } });
  }
});

export default router;
