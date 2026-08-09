import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateProviderPracticeAccess, getPracticeProviderFilter } from '../middleware/practiceScope.middleware.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { hasDob } from '../services/provider-dob.service.js';

const router = Router();

const reviewDocumentSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  notes: z.string().max(2000).optional(),
});

/**
 * GET /api/v1/portal/admin/onboarding/providers
 * List approved providers with onboarding status (single query with _count)
 */
router.get('/providers', authenticate, authorize('admin', 'credentialing_staff', 'practice_admin'), async (req: Request, res: Response) => {
  try {
    const practiceFilter = getPracticeProviderFilter(req);
    const providers = await prisma.providerProfile.findMany({
      where: { status: 'active', ...practiceFilter },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        npi: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        dateOfBirthEncrypted: true,
        providerType: true,
        status: true,
        createdAt: true,
        onboardingCompletedAt: true,
        _count: {
          select: {
            documents: { where: { uploadedViaPortal: true } },
            licenses: true,
            practiceLocations: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Compute progress inline from _count data
    const providersWithProgress = providers.map((p) => {
      const profileComplete = !!(p.firstName && p.lastName && p.email && p.phone && hasDob(p) && p.providerType);
      const documentsComplete = p._count.documents > 0;
      const licensesComplete = p._count.licenses > 0;
      const locationsComplete = p._count.practiceLocations > 0;
      const reviewComplete = profileComplete && documentsComplete && licensesComplete && locationsComplete;

      const steps = [
        { key: 'profile', label: 'Profile', complete: profileComplete },
        { key: 'documents', label: 'Documents', complete: documentsComplete },
        { key: 'licenses', label: 'Licenses', complete: licensesComplete },
        { key: 'locations', label: 'Locations', complete: locationsComplete },
        { key: 'review', label: 'Review', complete: reviewComplete },
      ];

      const completedCount = steps.filter(s => s.complete).length;
      const percentage = Math.round((completedCount / steps.length) * 100);

      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        npi: p.npi,
        providerType: p.providerType,
        approvedAt: p.createdAt,
        onboardingCompletedAt: p.onboardingCompletedAt,
        onboardingProgress: { percentage, steps, isComplete: reviewComplete },
      };
    });

    const total = providersWithProgress.length;
    const completed = providersWithProgress.filter(p => p.onboardingCompletedAt).length;
    const inProgress = providersWithProgress.filter(
      p => !p.onboardingCompletedAt && p.onboardingProgress.percentage > 0
    ).length;
    const notStarted = total - completed - inProgress;

    res.json({
      success: true,
      data: {
        providers: providersWithProgress,
        summary: { total, completed, inProgress, notStarted },
      },
    });
  } catch (error) {
    logger.error('Error listing onboarding providers:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list providers' } });
  }
});

/**
 * GET /api/v1/portal/admin/onboarding/providers/:id/documents
 * List provider's portal-uploaded documents for review
 */
router.get('/providers/:id/documents', authenticate, authorize('admin', 'credentialing_staff', 'practice_admin'), async (req: Request, res: Response) => {
  try {
    const providerId = req.params['id']!;

    if (!(await validateProviderPracticeAccess(req, providerId))) {
      return res.status(403).json({ success: false, error: { message: 'Access denied — provider not in your practice' } });
    }

    const documents = await prisma.document.findMany({
      where: { providerId, uploadedViaPortal: true },
      select: {
        id: true,
        fileName: true,
        originalFileName: true,
        fileSize: true,
        mimeType: true,
        documentType: true,
        description: true,
        reviewStatus: true,
        reviewNotes: true,
        reviewedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: documents });
  } catch (error) {
    logger.error('Error listing provider documents:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list documents' } });
  }
});

/**
 * PUT /api/v1/portal/admin/onboarding/providers/:id/documents/:docId/review
 * Approve or reject a portal-uploaded document
 */
router.put('/providers/:id/documents/:docId/review', authenticate, authorize('admin', 'credentialing_staff', 'practice_admin'), async (req: Request, res: Response) => {
  try {
    const { id: providerId, docId } = req.params;

    if (!(await validateProviderPracticeAccess(req, providerId!))) {
      return res.status(403).json({ success: false, error: { message: 'Access denied — provider not in your practice' } });
    }

    const { status, notes } = reviewDocumentSchema.parse(req.body);

    // Verify document exists and belongs to this provider
    const doc = await prisma.document.findUnique({
      where: { id: docId },
      select: { providerId: true, uploadedViaPortal: true },
    });

    if (!doc || doc.providerId !== providerId) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        reviewStatus: status,
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
        reviewNotes: notes || null,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    // Cross-package ZodError instanceof can fail; check by name
    if (error && typeof error === 'object' && 'name' in error && (error as any).name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          details: ((error as any).issues ?? []).map((i: any) => ({ field: i.path.join('.'), message: i.message })),
        },
      });
    }
    logger.error('Error reviewing document:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to review document' } });
  }
});

export default router;
