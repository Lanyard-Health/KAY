import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { NPIService } from '../services/npi.service.js';

export const npiRoutes = Router();

npiRoutes.use(authenticate);

const npiService = new NPIService();

// GET /api/v1/npi/lookup/:npiNumber - Lookup provider by NPI
npiRoutes.get(
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

      const result = await npiService.lookupByNPI(npiNumber);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/npi/search - Search providers by name
npiRoutes.get(
  '/search',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { firstName, lastName, state, city } = req.query;

      if (!firstName && !lastName) {
        return res.status(400).json({
          success: false,
          error: { message: 'At least first name or last name is required.' },
        });
      }

      const results = await npiService.searchByName(
        firstName as string,
        lastName as string,
        state as string,
        city as string
      );

      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  }
);
