import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { notificationService } from '../services/notification.service.js';
import { markNotificationsReadSchema } from '@credential-management/shared';

const router = Router();

// All routes require authentication (any role)
router.use(authenticate);

/**
 * GET /api/v1/notifications
 * Get current user's notifications
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const unreadOnly = req.query['unreadOnly'] === 'true';
    const limit = Math.min(Math.max(parseInt(req.query['limit'] as string) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query['offset'] as string) || 0, 0);

    const result = await notificationService.getNotifications(userId, {
      unreadOnly,
      limit,
      offset,
    });

    res.json({ success: true, data: result });
  } catch (error) {
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
