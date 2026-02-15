import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ValidationError, NotFoundError } from '../middleware/error.middleware.js';
import {
  validateFile,
  parseAndValidateRows,
  executeImport,
  getImportStatus,
} from '../services/providerImport.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// ==========================================
// Multer config — memory storage, 2MB limit
// ==========================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ==========================================
// Rate limiters
// ==========================================

const validateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env['NODE_ENV'] === 'test' ? 100 : 5,
  message: { error: 'Too many validation requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const executeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env['NODE_ENV'] === 'test' ? 100 : 2,
  message: { error: 'Too many import requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==========================================
// Zod schemas for request validation
// ==========================================

const executeBodySchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number(),
    status: z.enum(['valid', 'warning']),
    data: z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      npi: z.string().regex(/^\d{10}$/),
      email: z.string().email(),
      providerType: z.string().min(1),
    }).catchall(z.string()),
    errors: z.array(z.any()),
    warnings: z.array(z.any()),
  })).min(1, 'At least one row is required'),
});

// ==========================================
// CSV template
// ==========================================

const TEMPLATE_HEADERS = [
  'firstName', 'lastName', 'npi', 'email', 'providerType',
  'phone', 'dateOfBirth', 'licenseNumber', 'licenseState',
  'licenseExpiration', 'taxonomyCode', 'caqhProviderId',
];

const TEMPLATE_EXAMPLE = [
  'Jane', 'Doe', '1234567893', 'jane.doe@example.com', 'psychiatrist',
  '(555) 123-4567', '1985-06-15', 'MD-12345', 'CA',
  '2027-12-31', '207Q00000X', '',
];

// ==========================================
// Routes
// ==========================================

// GET /template — download CSV template
router.get(
  '/template',
  authorize('practice_admin'),
  (_req: Request, res: Response) => {
    const csv = [
      TEMPLATE_HEADERS.join(','),
      TEMPLATE_EXAMPLE.join(','),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="lanyard-provider-import-template.csv"');
    res.send(csv);
  },
);

// POST /validate — validate uploaded CSV
router.post(
  '/validate',
  authorize('practice_admin'),
  validateLimiter,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new ValidationError('No file uploaded. Attach a CSV file in the "file" field.');
      }

      const practiceId = req.practiceScope?.practiceIds[0];
      if (!practiceId) {
        throw new ValidationError('No practice associated with your account.');
      }

      // File-level validation (extension, content type, size)
      const fileError = validateFile({
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer,
      });

      if (fileError) {
        res.status(400).json({ success: false, error: fileError });
        return;
      }

      // Parse and validate rows
      const csvContent = req.file.buffer.toString('utf-8');
      const result = await parseAndValidateRows(csvContent, practiceId);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

// POST /execute — create providers from validated rows
router.post(
  '/execute',
  authorize('practice_admin'),
  executeLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.practiceScope?.practiceIds[0];
      if (!practiceId) {
        throw new ValidationError('No practice associated with your account.');
      }

      const parsed = executeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        });
        return;
      }

      const result = await executeImport(practiceId, req.user!.id, parsed.data.rows);

      if (result.error) {
        res.status(422).json({ success: false, data: result });
        return;
      }

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

// GET /:importId/status — check import status
router.get(
  '/:importId/status',
  authorize('practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.practiceScope?.practiceIds[0];
      if (!practiceId) {
        throw new ValidationError('No practice associated with your account.');
      }

      const importRecord = await getImportStatus(req.params['importId']!, practiceId);

      if (!importRecord) {
        throw new NotFoundError('Import');
      }

      res.json({ success: true, data: importRecord });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
