import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { computeOnboardingProgress } from '../services/onboarding.service.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const router = Router();

const VALID_LICENSE_TYPES = [
  'state_medical', 'state_psychology', 'state_social_work', 'state_counseling',
  'state_marriage_family', 'dea', 'controlled_substance', 'npi',
];

/**
 * GET /api/v1/portal/onboarding/progress
 * Returns onboarding progress for the current provider
 */
router.get('/progress', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const progress = await computeOnboardingProgress(providerId);
    res.json({ success: true, data: progress });
  } catch (error) {
    logger.error('Error fetching onboarding progress:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch onboarding progress' } });
  }
});

/**
 * POST /api/v1/portal/onboarding/complete
 * Marks onboarding as complete
 */
router.post('/complete', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { onboardingCompletedAt: true },
    });

    if (!provider) {
      return res.status(404).json({ success: false, error: { message: 'Provider not found' } });
    }

    if (provider.onboardingCompletedAt) {
      return res.json({ success: true, message: 'Onboarding already completed' });
    }

    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { onboardingCompletedAt: new Date() },
    });

    res.json({ success: true, message: 'Onboarding marked as complete' });
  } catch (error) {
    logger.error('Error completing onboarding:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to complete onboarding' } });
  }
});

/**
 * POST /api/v1/portal/onboarding/licenses
 * Create a license for the provider's own profile
 */
router.post('/licenses', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const { state, licenseNumber, licenseType, expirationDate, issueDate } = req.body;

    if (!licenseNumber || typeof licenseNumber !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'licenseNumber is required' } });
    }
    if (!licenseType || !VALID_LICENSE_TYPES.includes(licenseType)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid licenseType' } });
    }
    if (!expirationDate) {
      return res.status(400).json({ success: false, error: { message: 'expirationDate is required' } });
    }

    const expDate = new Date(expirationDate);
    if (isNaN(expDate.getTime())) {
      return res.status(400).json({ success: false, error: { message: 'Invalid expirationDate' } });
    }

    const issueDateVal = issueDate ? new Date(issueDate) : new Date();
    if (isNaN(issueDateVal.getTime())) {
      return res.status(400).json({ success: false, error: { message: 'Invalid issueDate' } });
    }

    const license = await prisma.license.create({
      data: {
        providerId,
        state: state || null,
        licenseNumber,
        licenseType: licenseType as any,
        expirationDate: expDate,
        issueDate: issueDateVal,
        source: 'portal_import',
        createdById: req.user!.id,
      },
    });

    res.status(201).json({ success: true, data: license });
  } catch (error) {
    logger.error('Error creating license:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create license' } });
  }
});

/**
 * GET /api/v1/portal/onboarding/licenses
 * List provider's own licenses
 */
router.get('/licenses', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const licenses = await prisma.license.findMany({
      where: { providerId },
      select: {
        id: true,
        state: true,
        licenseNumber: true,
        licenseType: true,
        issueDate: true,
        expirationDate: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: licenses });
  } catch (error) {
    logger.error('Error listing licenses:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list licenses' } });
  }
});

/**
 * PUT /api/v1/portal/onboarding/licenses/:id
 * Update a license owned by the current provider
 */
router.put('/licenses/:id', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const existing = await prisma.license.findUnique({
      where: { id: req.params['id'] },
      select: { providerId: true },
    });

    if (!existing || existing.providerId !== providerId) {
      return res.status(404).json({ success: false, error: { message: 'License not found' } });
    }

    const { state, licenseNumber, licenseType, expirationDate, issueDate } = req.body;

    const updateData: Record<string, unknown> = {};
    if (licenseNumber !== undefined) {
      if (typeof licenseNumber !== 'string' || !licenseNumber.trim()) {
        return res.status(400).json({ success: false, error: { message: 'licenseNumber must be a non-empty string' } });
      }
      updateData['licenseNumber'] = licenseNumber;
    }
    if (licenseType !== undefined) {
      if (!VALID_LICENSE_TYPES.includes(licenseType)) {
        return res.status(400).json({ success: false, error: { message: 'Invalid licenseType' } });
      }
      updateData['licenseType'] = licenseType;
    }
    if (state !== undefined) updateData['state'] = state || null;
    if (expirationDate !== undefined) {
      const expDate = new Date(expirationDate);
      if (isNaN(expDate.getTime())) {
        return res.status(400).json({ success: false, error: { message: 'Invalid expirationDate' } });
      }
      updateData['expirationDate'] = expDate;
    }
    if (issueDate !== undefined) {
      const issueDateVal = new Date(issueDate);
      if (isNaN(issueDateVal.getTime())) {
        return res.status(400).json({ success: false, error: { message: 'Invalid issueDate' } });
      }
      updateData['issueDate'] = issueDateVal;
    }

    updateData['updatedById'] = req.user!.id;

    const license = await prisma.license.update({
      where: { id: req.params['id'] },
      data: updateData,
    });

    res.json({ success: true, data: license });
  } catch (error) {
    logger.error('Error updating license:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update license' } });
  }
});

/**
 * DELETE /api/v1/portal/onboarding/licenses/:id
 * Delete a license owned by the current provider
 */
router.delete('/licenses/:id', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const existing = await prisma.license.findUnique({
      where: { id: req.params['id'] },
      select: { providerId: true },
    });

    if (!existing || existing.providerId !== providerId) {
      return res.status(404).json({ success: false, error: { message: 'License not found' } });
    }

    await prisma.license.delete({ where: { id: req.params['id'] } });

    res.json({ success: true, message: 'License deleted' });
  } catch (error) {
    logger.error('Error deleting license:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete license' } });
  }
});

export default router;
