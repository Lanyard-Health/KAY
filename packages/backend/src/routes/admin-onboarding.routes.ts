import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { computeOnboardingProgress } from '../services/onboarding.service.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/v1/portal/admin/onboarding/providers
 * List approved providers with onboarding status
 */
router.get('/providers', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
  try {
    const providers = await prisma.provider.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        npi: true,
        providerType: true,
        status: true,
        createdAt: true,
        onboardingCompletedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Compute progress for each provider
    const providersWithProgress = await Promise.all(
      providers.map(async (p) => {
        const progress = await computeOnboardingProgress(p.id);
        return {
          id: p.id,
          name: `${p.firstName} ${p.lastName}`,
          npi: p.npi,
          providerType: p.providerType,
          approvedAt: p.createdAt,
          onboardingCompletedAt: p.onboardingCompletedAt,
          onboardingProgress: progress,
        };
      })
    );

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
    res.status(500).json({ success: false, error: 'Failed to list providers' });
  }
});

/**
 * GET /api/v1/portal/admin/onboarding/providers/:id/documents
 * List provider's portal-uploaded documents for review
 */
router.get('/providers/:id/documents', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
  try {
    const providerId = req.params['id']!;

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
    res.status(500).json({ success: false, error: 'Failed to list documents' });
  }
});

/**
 * PUT /api/v1/portal/admin/onboarding/providers/:id/documents/:docId/review
 * Approve or reject a portal-uploaded document
 */
router.put('/providers/:id/documents/:docId/review', authenticate, authorize('admin', 'credentialing_staff'), async (req: Request, res: Response) => {
  try {
    const { id: providerId, docId } = req.params;
    const { status, notes } = req.body;

    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be "approved" or "rejected"' });
    }

    // Verify document exists and belongs to this provider
    const doc = await prisma.document.findUnique({
      where: { id: docId },
      select: { providerId: true, uploadedViaPortal: true },
    });

    if (!doc || doc.providerId !== providerId) {
      return res.status(404).json({ success: false, error: 'Document not found' });
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
    logger.error('Error reviewing document:', error);
    res.status(500).json({ success: false, error: 'Failed to review document' });
  }
});

export default router;
