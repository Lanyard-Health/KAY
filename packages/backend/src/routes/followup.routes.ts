import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { emailService } from '../services/email.service';
import { followUpService } from '../services/followup.service';
import { schedulerService } from '../services/scheduler.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const followUpRoutes = Router();

// Configure multer for file uploads (memory storage for email attachments)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// Get email service status and config
followUpRoutes.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
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
followUpRoutes.post('/test-email', async (req: Request, res: Response, next: NextFunction) => {
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
followUpRoutes.get('/enrollment/:id/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
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
followUpRoutes.post('/enrollment/:id/preview-html', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { customMessage } = req.body;

    const data = await followUpService.getEnrollmentEmailData(id);

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
  upload.single('attachment'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { email, customMessage } = req.body;
      const file = req.file;

      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Recipient email address is required',
        });
      }

      const result = await followUpService.sendCustomFollowUp(id, email, {
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
followUpRoutes.post('/enrollment/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    const result = await followUpService.sendCustomFollowUp(id, email || '');

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
followUpRoutes.put('/enrollment/:id/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
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

    const enrollment = await followUpService.configureFollowUp(id, {
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
followUpRoutes.get('/enrollment/:id/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const enrollment = await prisma.payerEnrollment.findUnique({
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
followUpRoutes.get('/enrollments', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const enrollments = await prisma.payerEnrollment.findMany({
      where: {
        followUpEnabled: true,
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
followUpRoutes.get('/due', async (_req: Request, res: Response, next: NextFunction) => {
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
followUpRoutes.post('/run', async (_req: Request, res: Response, next: NextFunction) => {
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
followUpRoutes.get('/enrollment/:id/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // First get the enrollment to find the email
    const enrollment = await prisma.payerEnrollment.findUnique({
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
