import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { STAFF_ROLES } from '../constants/roles.js';
import { isValidNpi } from '../constants/validation.js';
import { PECOSService } from '../services/pecos.service.js';

export const pecosRoutes = Router();

pecosRoutes.use(authenticate);
pecosRoutes.use(authorize(...STAFF_ROLES));

const pecosService = new PECOSService();

// GET /api/v1/pecos/lookup/:npiNumber - Detailed Medicare enrollment lookup by NPI
pecosRoutes.get(
  '/lookup/:npiNumber',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { npiNumber } = req.params;

      if (!npiNumber || !isValidNpi(npiNumber)) {
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

      if (!npiNumber || !isValidNpi(npiNumber)) {
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

      if (!npiNumber || !isValidNpi(npiNumber)) {
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

      if (!npiNumber || !isValidNpi(npiNumber)) {
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
      const invalidNpis = npis.filter(npi => !isValidNpi(npi));
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

// NOTE: /verify/:providerId and /verify-batch routes removed — medicareVerification service was deleted.
