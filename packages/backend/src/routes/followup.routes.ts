import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { emailService } from '../services/email.service.js';
import { followUpService } from '../services/followup.service.js';
import { schedulerService } from '../services/scheduler.service.js';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateProviderPracticeAccess, getPracticeRelationFilter } from '../middleware/practiceScope.middleware.js';

// Rate limit email-sending endpoints to prevent abuse
const emailSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many email requests, please try again later.',
});

const followUpRoutes = Router();

followUpRoutes.use(authenticate);

// Configure multer for file uploads (memory storage for email attachments)
const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_ATTACHMENT_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

// Practice-scope check for enrollment :id routes
async function checkEnrollmentPracticeAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = req.params['id'];
  if (!id) return next();
  const enrollment = await prisma.enrollment.findUnique({ where: { id }, select: { providerId: true } });
  if (!enrollment) return next(); // Let route handle 404
  if (!(await validateProviderPracticeAccess(req, enrollment.providerId))) {
    res.status(404).json({ success: false, error: { message: 'Enrollment not found' } });
    return;
  }
  next();
}

// Get email service status and config
followUpRoutes.get('/status', authorize('admin', 'lanyard_admin', 'credentialing_staff'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const emailConfig = emailService.getConfig();
    const schedulerStatus = schedulerService.getStatus();
    const connectionResult = await emailService.verifyConnection();

    res.json({
      success: true,
      data: {
        email: {
          configured: emailService.isConfigured(),
          config: emailConfig ? {
            host: emailConfig.host,
            port: emailConfig.port,
            user: emailConfig.user.substring(0, 3) + '***',
          } : null,
          connectionVerified: connectionResult.success,
          connectionError: connectionResult.error,
        },
        scheduler: schedulerStatus,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Send test email to verify SMTP configuration
followUpRoutes.post('/test-email', emailSendLimiter, authorize('admin', 'lanyard_admin', 'credentialing_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required',
      });
    }

    const result = await emailService.sendTestEmail(email);

    if (result.success) {
      res.json({
        success: true,
        data: {
          message: 'Test email sent successfully',
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
});

// Get enrollment data for email preview
followUpRoutes.get('/enrollment/:id/preview', authorize('admin', 'lanyard_admin', 'credentialing_staff'), checkEnrollmentPracticeAccess, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const data = await followUpService.getEnrollmentEmailData(id);

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found',
      });
    }

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
});

// Generate email HTML preview
followUpRoutes.post('/enrollment/:id/preview-html', authorize('admin', 'lanyard_admin', 'credentialing_staff'), checkEnrollmentPracticeAccess, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const { customMessage } = req.body;

    const data = await followUpService.getEnrollmentEmailData(id!);

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found',
      });
    }

    const html = followUpService.generateProfessionalEmail(data, customMessage);

    res.json({
      success: true,
      data: {
        subject: `Credentialing Status Inquiry - ${data.providerName} - ${data.payerName}`,
        html,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Send follow-up email with optional attachment
followUpRoutes.post(
  '/enrollment/:id/send',
  emailSendLimiter,
  authorize('admin', 'lanyard_admin', 'credentialing_staff'),
  checkEnrollmentPracticeAccess,
  upload.single('attachment'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;
      const { email, customMessage } = req.body;
      const file = req.file;

      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Recipient email address is required',
        });
      }

      const result = await followUpService.sendCustomFollowUp(id!, email, {
        customMessage,
        attachment: file ? {
          filename: file.originalname,
          content: file.buffer,
          contentType: file.mimetype,
        } : undefined,
      });

      if (result.success) {
        res.json({
          success: true,
          data: {
            message: 'Follow-up email sent successfully',
            ...result,
          },
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          data: result,
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

// Legacy: Send test follow-up for a specific enrollment
followUpRoutes.post('/enrollment/:id/test', authorize('admin', 'lanyard_admin', 'credentialing_staff'), checkEnrollmentPracticeAccess, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const { email } = req.body;

    const result = await followUpService.sendCustomFollowUp(id!, email || '');

    if (result.success) {
      res.json({
        success: true,
        data: {
          message: 'Follow-up email sent successfully',
          ...result,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        data: result,
      });
    }
  } catch (error) {
    next(error);
  }
});

// Configure follow-up settings for an enrollment
followUpRoutes.put('/enrollment/:id/settings', authorize('admin', 'lanyard_admin', 'credentialing_staff'), checkEnrollmentPracticeAccess, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const { enabled, email, frequencyDays } = req.body;

    if (enabled && !email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required when enabling follow-ups',
      });
    }

    if (frequencyDays !== undefined && (frequencyDays < 1 || frequencyDays > 90)) {
      return res.status(400).json({
        success: false,
        error: 'Frequency must be between 1 and 90 days',
      });
    }

    const enrollment = await followUpService.configureFollowUp(id!, {
      enabled,
      email,
      frequencyDays,
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found',
      });
    }

    res.json({
      success: true,
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
});

// Get follow-up settings for an enrollment
followUpRoutes.get('/enrollment/:id/settings', authorize('admin', 'lanyard_admin', 'credentialing_staff'), checkEnrollmentPracticeAccess, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      select: {
        id: true,
        followUpEnabled: true,
        followUpEmail: true,
        followUpFrequencyDays: true,
        lastFollowUpSentAt: true,
        nextFollowUpDate: true,
        lastFollowUpDate: true,
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found',
      });
    }

    res.json({
      success: true,
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
});

// Get all enrollments with follow-up enabled
followUpRoutes.get('/enrollments', authorize('admin', 'lanyard_admin', 'credentialing_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        followUpEnabled: true,
        ...getPracticeRelationFilter(req),
      },
      include: {
        provider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            npi: true,
          },
        },
        payer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        nextFollowUpDate: 'asc',
      },
    });

    res.json({
      success: true,
      data: enrollments,
    });
  } catch (error) {
    next(error);
  }
});

// Get enrollments due for follow-up
followUpRoutes.get('/due', authorize('admin', 'lanyard_admin', 'credentialing_staff'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const enrollments = await followUpService.getEnrollmentsDueForFollowUp();

    res.json({
      success: true,
      data: enrollments,
      count: enrollments.length,
    });
  } catch (error) {
    next(error);
  }
});

// Manually trigger follow-up processing (for testing or manual runs)
followUpRoutes.post('/run', authorize('admin', 'lanyard_admin', 'credentialing_staff'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await schedulerService.runFollowUpJob();

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// Get follow-up history (notifications) for an enrollment
followUpRoutes.get('/enrollment/:id/history', authorize('admin', 'lanyard_admin', 'credentialing_staff'), checkEnrollmentPracticeAccess, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;

    // First get the enrollment to find the email
    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      include: {
        provider: true,
        payer: true,
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found',
      });
    }

    // Get notifications for this enrollment
    const notifications = await prisma.notification.findMany({
      where: {
        type: 'enrollment_follow_up',
        subject: {
          contains: enrollment.payer.name,
        },
        recipientEmail: enrollment.followUpEmail || undefined,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    });

    res.json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    next(error);
  }
});

export default followUpRoutes;
