import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { notificationService } from '../services/notification.service.js';
import { markNotificationsReadSchema } from '@credential-management/shared';
import { parseQuery, limitOffsetSchema } from '../utils/queryValidation.js';

const notificationQuerySchema = limitOffsetSchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});

const router = Router();

// All routes require authentication (any role — intentionally no authorize()).
// All endpoints scope data by req.user!.id so users only see their own notifications.
router.use(authenticate);

/**
 * GET /api/v1/notifications
 * Get current user's notifications
 */
router.get('/', async (req: Request, res: Response) => {
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
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: { message: 'Invalid query parameters', details: error.issues } });
      return;
    }
    res.status(500).json({ success: false, error: { message: 'Failed to fetch notifications' } });
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

export default router;
