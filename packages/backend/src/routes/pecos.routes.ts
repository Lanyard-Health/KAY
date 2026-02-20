import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { PECOSService } from '../services/pecos.service.js';
import { verifyProvider, verifyProviderBatch } from '../services/medicareVerification.service.js';

export const pecosRoutes = Router();

pecosRoutes.use(authenticate);

const pecosService = new PECOSService();

// GET /api/v1/pecos/lookup/:npiNumber - Detailed Medicare enrollment lookup by NPI
pecosRoutes.get(
  '/lookup/:npiNumber',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { npiNumber } = req.params;

      if (!npiNumber || !/^\d{10}$/.test(npiNumber)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid NPI number. Must be 10 digits.' },
        });
      }

      const result = await pecosService.lookupByNPI(npiNumber);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/pecos/enrolled/:npiNumber - Quick check if enrolled in Medicare
pecosRoutes.get(
  '/enrolled/:npiNumber',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { npiNumber } = req.params;

      if (!npiNumber || !/^\d{10}$/.test(npiNumber)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid NPI number. Must be 10 digits.' },
        });
      }

      const enrolled = await pecosService.isEnrolledInMedicare(npiNumber);

      res.json({
        success: true,
        data: {
          npi: npiNumber,
          enrolled,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/pecos/states/:npiNumber - Get enrollment states for a provider
pecosRoutes.get(
  '/states/:npiNumber',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { npiNumber } = req.params;

      if (!npiNumber || !/^\d{10}$/.test(npiNumber)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid NPI number. Must be 10 digits.' },
        });
      }

      const states = await pecosService.getEnrollmentStates(npiNumber);

      res.json({
        success: true,
        data: {
          npi: npiNumber,
          states,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/pecos/specialties/:npiNumber - Get specialties for a provider
pecosRoutes.get(
  '/specialties/:npiNumber',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { npiNumber } = req.params;

      if (!npiNumber || !/^\d{10}$/.test(npiNumber)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid NPI number. Must be 10 digits.' },
        });
      }

      const specialties = await pecosService.getSpecialties(npiNumber);

      res.json({
        success: true,
        data: {
          npi: npiNumber,
          specialties,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/pecos/batch - Batch lookup for multiple NPIs
pecosRoutes.post(
  '/batch',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { npis } = req.body;

      if (!Array.isArray(npis) || npis.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'npis must be a non-empty array of NPI numbers.' },
        });
      }

      if (npis.length > 50) {
        return res.status(400).json({
          success: false,
          error: { message: 'Maximum 50 NPIs per batch request.' },
        });
      }

      // Validate all NPIs
      const invalidNpis = npis.filter(npi => !/^\d{10}$/.test(npi));
      if (invalidNpis.length > 0) {
        return res.status(400).json({
          success: false,
          error: { message: `Invalid NPI numbers: ${invalidNpis.join(', ')}` },
        });
      }

      const results = await pecosService.batchLookup(npis);

      // Convert Map to object for JSON response
      const resultsObject: Record<string, any> = {};
      results.forEach((value, key) => {
        // eslint-disable-next-line security/detect-object-injection -- key is a validated 10-digit NPI (regex-checked above)
        resultsObject[key] = value;
      });

      res.json({ success: true, data: resultsObject });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/pecos/verify/:providerId
pecosRoutes.post(
  '/verify/:providerId',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = req.params['providerId']!;
      const result = await verifyProvider(providerId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.message === 'Provider not found' || error.message === 'Provider has no NPI') {
        return res.status(400).json({ success: false, error: { message: error.message } });
      }
      next(error);
    }
  }
);

// POST /api/v1/pecos/verify-batch
pecosRoutes.post(
  '/verify-batch',
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { providerIds } = req.body;

      if (!Array.isArray(providerIds) || providerIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'providerIds must be a non-empty array.' },
        });
      }

      if (providerIds.some((id: unknown) => typeof id !== 'string')) {
        return res.status(400).json({
          success: false,
          error: { message: 'All providerIds must be strings.' },
        });
      }

      if (providerIds.length > 50) {
        return res.status(400).json({
          success: false,
          error: { message: 'Maximum 50 providers per batch request.' },
        });
      }

      const summary = await verifyProviderBatch(providerIds);
      res.json({ success: true, data: summary });
    } catch (error) {
      next(error);
    }
  }
);
