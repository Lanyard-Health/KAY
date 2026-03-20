import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import {
  submitApplication,
  getApplicationStatusByNpi,
  getApplications,
  getApplicationById,
  approveApplication,
  rejectApplication,
  getPendingApplicationCount,
  getUnreadNotificationCount,
  getAdminNotifications,
  markNotificationsAsRead,
  ProviderApplicationInput,
  selfServeSignup,
  SelfServeSignupInput,
} from '../services/portal.service.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { portalRegistrationSchema, markNotificationsReadSchema, selfServeSignupSchema } from '@credential-management/shared';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const portalRegistrationLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many registration attempts. Please try again later.' },
});

const portalLookupLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many lookup requests. Please try again later.' },
});

const router = Router();

// ==========================================
// PUBLIC ENDPOINTS (No Auth Required)
// ==========================================

/**
 * POST /api/v1/portal/register
 * Submit a new provider application
 */
router.post('/register', portalRegistrationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = portalRegistrationSchema.parse(req.body);
    const data: ProviderApplicationInput = {
      ...parsed,
      previousApplicationId: req.body.previousApplicationId,
    } as ProviderApplicationInput;

    // Validate practiceId exists and is active in DB
    if (data.practiceId) {
      const practice = await prisma.practice.findUnique({
        where: { id: data.practiceId },
        select: { id: true, status: true },
      });
      if (!practice || practice.status !== 'ACTIVE') {
        return res.status(400).json({ success: false, error: 'Practice not found or inactive' });
      }
    }

    const application = await submitApplication(data);

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: {
        id: application.id,
        status: application.status,
        submittedAt: application.submittedAt,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') return next(error);
    logger.error('Error submitting application:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('already pending') ||
        error.message.includes('already exists')
      ) {
        return res.status(409).json({
          success: false,
          error: 'An application with this information already exists',
        });
      }
    }

    next(error);
  }
});

/**
 * POST /api/v1/portal/self-serve-signup
 * Self-serve provider registration with instant access
 */
router.post('/self-serve-signup', portalRegistrationLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = selfServeSignupSchema.parse(req.body);
    // Strip confirmPassword before passing to service
    const { confirmPassword: _, ...signupData } = parsed;
    const data: SelfServeSignupInput = signupData as SelfServeSignupInput;

    const result = await selfServeSignup(data);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        userId: result.userId,
        providerId: result.providerId,
        email: result.email,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') return next(error);
    logger.error('Error in self-serve signup:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('already pending') ||
        error.message.includes('already exists')
      ) {
        return res.status(409).json({
          success: false,
          error: 'An account with this email address already exists',
        });
      }
    }

    next(error);
  }
});

/**
 * GET /api/v1/portal/status/:npi
 * Check application status by NPI
 */
router.get('/status/:npi', portalLookupLimit, async (req: Request, res: Response) => {
  try {
    const npi = req.params['npi']!;

    if (!/^\d{10}$/.test(npi)) {
      return res.status(400).json({
        success: false,
        error: 'NPI must be exactly 10 digits',
      });
    }

    const status = await getApplicationStatusByNpi(npi);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'No application found for this NPI',
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error('Error fetching application status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch application status',
    });
  }
});

/**
 * GET /api/v1/portal/practice/:practiceId/info
 * Get practice name for registration link (public, no auth)
 */
router.get('/practice/:practiceId/info', portalLookupLimit, async (req: Request, res: Response) => {
  try {
    const { practiceId } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!practiceId || !uuidRegex.test(practiceId)) {
      return res.status(400).json({ success: false, error: 'Invalid practice ID format' });
    }

    const practice = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: { name: true, status: true },
    });

    if (!practice || practice.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, error: 'Practice not found' });
    }

    res.json({ success: true, data: { name: practice.name, status: practice.status } });
  } catch (error) {
    logger.error('Error fetching practice info:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch practice info' });
  }
});

// ==========================================
// ADMIN ENDPOINTS (Auth Required)
// ==========================================

/**
 * GET /api/v1/portal/admin/applications
 * List all applications
 */
router.get('/admin/applications', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
  try {
    const statusParam = req.query['status'] as string | undefined;
    let status: 'pending' | 'approved' | 'rejected' | undefined;

    if (statusParam) {
      const lower = statusParam.toLowerCase();
      if (!['pending', 'approved', 'rejected'].includes(lower)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Must be pending, approved, or rejected',
        });
      }
      status = lower as 'pending' | 'approved' | 'rejected';
    }

    const applications = await getApplications(status);
    const pendingCount = await getPendingApplicationCount();

    res.json({
      success: true,
      data: {
        applications,
        pendingCount,
        total: applications.length,
      },
    });
  } catch (error) {
    logger.error('Error fetching applications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch applications',
    });
  }
});

/**
 * GET /api/v1/portal/admin/applications/:id
 * Get single application
 */
router.get('/admin/applications/:id', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
  try {
    const id = req.params['id']!;
    const application = await getApplicationById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Application not found',
      });
    }

    res.json({
      success: true,
      data: application,
    });
  } catch (error) {
    logger.error('Error fetching application:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch application',
    });
  }
});

/**
 * POST /api/v1/portal/admin/applications/:id/approve
 * Approve an application
 */
router.post('/admin/applications/:id/approve', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const { notes } = req.body;
    const reviewedBy = (req as any).user?.email || 'admin';

    const application = await approveApplication(id, reviewedBy, notes);

    res.json({
      success: true,
      message: 'Application approved',
      data: application,
    });
  } catch (error) {
    logger.error('Error approving application:', error);

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (error.message.includes('already been reviewed') || error.message.includes('already exists')) {
        return res.status(409).json({ success: false, error: 'This application has already been reviewed' });
      }
    }

    next(error);
  }
});

/**
 * POST /api/v1/portal/admin/applications/:id/reject
 * Reject an application
 */
router.post('/admin/applications/:id/reject', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const { notes } = req.body;

    if (!notes || notes.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Rejection notes are required',
      });
    }

    const reviewedBy = (req as any).user?.email || 'admin';
    const application = await rejectApplication(id, reviewedBy, notes);

    res.json({
      success: true,
      message: 'Application rejected',
      data: application,
    });
  } catch (error) {
    logger.error('Error rejecting application:', error);

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }
      if (error.message.includes('already been reviewed')) {
        return res.status(409).json({ success: false, error: 'This application has already been reviewed' });
      }
    }

    next(error);
  }
});

/**
 * GET /api/v1/portal/admin/notifications
 * Get admin notifications
 */
router.get('/admin/notifications', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
  try {
    const unreadOnly = req.query['unreadOnly'] === 'true';

    const [notifications, unreadCount] = await Promise.all([
      getAdminNotifications(unreadOnly),
      getUnreadNotificationCount(),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
    });
  } catch (error) {
    logger.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications',
    });
  }
});

/**
 * POST /api/v1/portal/admin/notifications/mark-read
 * Mark notifications as read
 */
router.post('/admin/notifications/mark-read', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { notificationIds } = markNotificationsReadSchema.parse(req.body);
    await markNotificationsAsRead(notificationIds);

    res.json({
      success: true,
      message: 'Notifications marked as read',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') return next(error);
    logger.error('Error marking notifications as read:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notifications as read',
    });
  }
});

// ==========================================
// PUBLIC ENDPOINTS - NPI Lookup
// ==========================================

/**
 * GET /api/v1/portal/npi-lookup/:npi
 * Lookup provider info from the NPPES NPI Registry (public, no auth required)
 */
router.get('/npi-lookup/:npi', portalLookupLimit, async (req: Request, res: Response) => {
  try {
    const npi = req.params['npi']!;

    if (!/^\d{10}$/.test(npi)) {
      return res.status(400).json({ success: false, error: 'NPI must be exactly 10 digits' });
    }

    const nppes = await fetch(
      `https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`
    );
    const data: any = await nppes.json();

    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ success: false, error: 'NPI not found in NPPES registry' });
    }

    const result: any = data.results[0];
    const basic = result.basic || {};
    const taxonomies = result.taxonomies || [];
    const addresses = result.addresses || [];

    const primaryTaxonomy = taxonomies.find((t: any) => t.primary) || taxonomies[0];
    const practiceAddress = addresses.find((a: any) => a.address_purpose === 'LOCATION') || addresses[0];

    res.json({
      success: true,
      data: {
        npi,
        firstName: basic.first_name || '',
        lastName: basic.last_name || '',
        middleName: basic.middle_name || '',
        suffix: basic.credential || '',
        gender: basic.gender === 'M' ? 'Male' : basic.gender === 'F' ? 'Female' : '',
        taxonomy: primaryTaxonomy?.code || '',
        taxonomyDescription: primaryTaxonomy?.desc || '',
        specialization: primaryTaxonomy?.desc || '',
        phone: practiceAddress?.telephone_number || '',
        state: practiceAddress?.state || '',
        enumeration_type: result.enumeration_type,
      },
    });
  } catch (error) {
    logger.error('NPI lookup error:', error);
    res.status(500).json({ success: false, error: 'Failed to lookup NPI' });
  }
});

// ==========================================
// AUTHENTICATED PROVIDER ENDPOINTS
// ==========================================

/**
 * GET /api/v1/portal/me
 * Get current provider's dashboard summary
 */
router.get('/me', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;

    if (!providerId) {
      return res.status(404).json({
        success: false,
        error: 'No provider profile linked to this account',
      });
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: {
        payerEnrollments: {
          include: {
            payer: true,
          },
        },
        practiceLocations: true,
      },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        error: 'Provider not found',
      });
    }

    // Map to the shape the frontend expects
    const providerData = {
      ...provider,
      enrollments: provider.payerEnrollments,
      locations: provider.practiceLocations,
    };

    res.json({
      success: true,
      data: {
        provider: providerData,
        enrollmentCount: provider.payerEnrollments.length,
        locationCount: provider.practiceLocations.length,
      },
    });
  } catch (error) {
    logger.error('Error fetching provider dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch provider dashboard',
    });
  }
});

/**
 * GET /api/v1/portal/me/completeness
 * Get profile completeness calculation
 */
router.get('/me/completeness', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;

    if (!providerId) {
      return res.status(404).json({
        success: false,
        error: 'No provider profile linked to this account',
      });
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: {
        practiceLocations: true,
        payerEnrollments: true,
      },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        error: 'Provider not found',
      });
    }

    const sections = [
      { name: 'Personal Info', complete: !!(provider.firstName && provider.lastName && provider.email && provider.phone) },
      { name: 'NPI', complete: !!provider.npi },
      { name: 'Specialties', complete: provider.specialties.length > 0 },
      { name: 'Date of Birth', complete: !!provider.dateOfBirth },
      { name: 'Provider Type', complete: !!provider.providerType },
      { name: 'Practice Locations', complete: provider.practiceLocations.length > 0 },
    ];

    const completedCount = sections.filter(s => s.complete).length;
    const percentage = Math.round((completedCount / sections.length) * 100);

    res.json({
      success: true,
      data: {
        percentage,
        sections,
        completedCount,
        totalCount: sections.length,
      },
    });
  } catch (error) {
    logger.error('Error calculating completeness:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate profile completeness',
    });
  }
});

export default router;
