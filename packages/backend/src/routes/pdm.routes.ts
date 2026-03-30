import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { parseQuery } from '../utils/queryValidation.js';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { STAFF_ROLES } from '../constants/roles.js';
import {
  getAttestationStatuses,
  getEnrollmentsNeedingAttestation,
  recordAttestation,
  getAttestationSummary,
} from '../services/pdm.service.js';

const router = Router();

router.use(authenticate);
router.use(authorize(...STAFF_ROLES));

/**
 * GET /api/v1/pdm/provider/:providerId/status
 * Get all attestation statuses for a provider
 */
router.get('/provider/:providerId/status', requireProviderAccess, async (req: Request, res: Response) => {
  try {
    const providerId = req.params['providerId']!;

    const [statuses, summary] = await Promise.all([
      getAttestationStatuses(providerId!),
      getAttestationSummary(providerId!),
    ]);

    res.json({
      success: true,
      data: {
        statuses,
        summary,
      },
    });
  } catch (error) {
    logger.error('Error fetching PDM status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch PDM attestation status',
    });
  }
});

/**
 * GET /api/v1/pdm/provider/:providerId/alerts
 * Get enrollments needing attention (due soon, overdue, or directory changed)
 */
router.get('/provider/:providerId/alerts', requireProviderAccess, async (req: Request, res: Response) => {
  try {
    const providerId = req.params['providerId']!;
    const { warningDays } = parseQuery(req.query, z.object({
      warningDays: z.coerce.number().int().min(1).max(365).default(14),
    }));

    const alerts = await getEnrollmentsNeedingAttestation(providerId!, warningDays);

    res.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
      },
    });
  } catch (error) {
    logger.error('Error fetching PDM alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch PDM alerts',
    });
  }
});

/**
 * POST /api/v1/pdm/provider/:providerId/attest
 * Record attestation for one or more enrollments
 */
router.post('/provider/:providerId/attest', requireProviderAccess, async (req: Request, res: Response) => {
  try {
    const { enrollmentIds } = req.body;

    if (!enrollmentIds || !Array.isArray(enrollmentIds) || enrollmentIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'enrollmentIds array is required',
      });
    }

    const attestedBy = req.user!.email;

    await recordAttestation(enrollmentIds, attestedBy);

    res.json({
      success: true,
      message: `Successfully recorded attestation for ${enrollmentIds.length} enrollment(s)`,
      data: {
        enrollmentIds,
        attestedAt: new Date(),
        attestedBy,
      },
    });
  } catch (error) {
    logger.error('Error recording attestation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record attestation',
    });
  }
});

export const pdmRoutes = router;
