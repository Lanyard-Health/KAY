import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { emailService } from '../services/email.service.js';

const router = Router();

/**
 * GET /api/v1/email/test?to=address
 * Send a test email to verify SES is working (admin only)
 */
router.get(
  '/test',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const to = req.query['to'] as string;

      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(400).json({
          success: false,
          error: 'Valid email address required as "to" query parameter',
        });
      }

      if (!emailService.isConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'Email service is not configured. Check SES_FROM_EMAIL, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY env vars.',
        });
      }

      const result = await emailService.sendTestEmail(to);

      if (result.success) {
        res.json({
          success: true,
          data: {
            message: `Test email sent to ${to}`,
            messageId: result.messageId,
          },
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error || 'Failed to send test email',
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/email/config
 * Check email service configuration status (admin only)
 */
router.get(
  '/config',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        configured: emailService.isConfigured(),
        config: emailService.getConfig(),
      },
    });
  }
);

export default router;
