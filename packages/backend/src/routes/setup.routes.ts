import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { invalidateCache } from '../utils/cache.js';
import { NPIService } from '../services/npi.service.js';
import { autoCreateWorkItems } from '../services/opsWorkQueue.service.js';
import { checkProviderLimit, incrementProviderCount } from '../services/billing.service.js';

const router = Router();
const npiService = new NPIService();

// Rate limit batch-enroll: 10 req/min per practice
const batchEnrollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env['NODE_ENV'] === 'development' ? 100 : 10,
  message: { error: 'Too many enrollment requests, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.practiceScope?.practiceIds?.[0] || req.ip || 'unknown',
});

// ── Schemas ────────────────────────────────────────

const practiceProfileSchema = z.object({
  addressLine1: z.string().min(1).max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().length(2).optional(),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/).optional(),
  phone: z.string().max(20).optional(),
  groupNpi: z.string().regex(/^\d{10}$/).optional().nullable(),
  taxId: z.string().regex(/^\d{2}-\d{7}$/).optional().nullable(),
  specialtyFocus: z.string().max(100).optional(),
});

const quickProviderSchema = z.object({
  npi: z.string().regex(/^\d{10}$/),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  providerType: z.string().min(1),
  primaryState: z.string().length(2).optional(),
});

const batchEnrollSchema = z.object({
  providerId: z.string().uuid(),
  payerIds: z.array(z.string().uuid()).min(1).max(20),
});

// ── POST /practice-profile ─────────────────────────

router.post(
  '/practice-profile',
  authenticate,
  authorize('admin', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.practiceScope?.practiceIds?.[0];
      if (!practiceId) {
        res.status(400).json({ error: 'Practice context required' });
        return;
      }

      const validated = practiceProfileSchema.parse(req.body);

      // Build update data — never log taxId
      const updateData: Record<string, unknown> = {};
      if (validated.addressLine1 !== undefined) updateData['addressLine1'] = validated.addressLine1;
      if (validated.addressLine2 !== undefined) updateData['addressLine2'] = validated.addressLine2;
      if (validated.city !== undefined) updateData['city'] = validated.city;
      if (validated.state !== undefined) updateData['state'] = validated.state;
      if (validated.zipCode !== undefined) updateData['zipCode'] = validated.zipCode;
      if (validated.phone !== undefined) updateData['phone'] = validated.phone;
      if (validated.groupNpi !== undefined) updateData['groupNpi'] = validated.groupNpi;
      if (validated.taxId !== undefined) updateData['taxId'] = validated.taxId;
      if (validated.specialtyFocus !== undefined) updateData['specialtyFocus'] = validated.specialtyFocus;

      const practice = await prisma.practice.update({
        where: { id: practiceId },
        data: updateData,
        select: {
          id: true,
          name: true,
          addressLine1: true,
          city: true,
          state: true,
          zipCode: true,
          phone: true,
          groupNpi: true,
          specialtyFocus: true,
          setupComplete: true,
        },
      });

      logger.info(`[Setup] Practice profile updated for practice ${practiceId}`);
      invalidateCache('dashboard:');

      res.json({ success: true, data: practice });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      next(error);
    }
  }
);

// ── POST /quick-provider ───────────────────────────

router.post(
  '/quick-provider',
  authenticate,
  authorize('admin', 'practice_admin', 'credentialing_staff'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.practiceScope?.practiceIds?.[0];
      if (!practiceId) {
        res.status(400).json({ error: 'Practice context required' });
        return;
      }

      const validated = quickProviderSchema.parse(req.body);

      // Check subscription provider limit (race-safe)
      const limitCheck = await checkProviderLimit(practiceId);
      if (!limitCheck.allowed) {
        res.status(402).json({
          error: 'Provider limit reached — please upgrade your plan',
          current: limitCheck.current,
          limit: limitCheck.limit,
          billingUrl: '/settings/billing',
        });
        return;
      }

      // Check NPI uniqueness
      const existingProvider = await prisma.provider.findUnique({
        where: { npi: validated.npi },
      });
      if (existingProvider) {
        res.status(409).json({ error: 'A provider with this NPI already exists' });
        return;
      }

      // Create provider in transaction with count increment
      const provider = await prisma.$transaction(async (tx) => {
        const newProvider = await tx.provider.create({
          data: {
            npi: validated.npi,
            firstName: validated.firstName,
            lastName: validated.lastName,
            email: validated.email,
            phone: '',
            dateOfBirth: new Date('1990-01-01'),
            gender: 'prefer_not_to_say',
            providerType: validated.providerType as any,
            primaryState: validated.primaryState,
            practiceId,
            status: 'active',
            createdById: req.user?.id,
          },
        });

        // Increment provider count on subscription
        await incrementProviderCount(practiceId);

        return newProvider;
      });

      logger.info(`[Setup] Quick provider created: ${provider.id} for practice ${practiceId}`);
      invalidateCache('dashboard:');

      res.status(201).json({ success: true, data: provider });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      next(error);
    }
  }
);

// ── POST /batch-enroll ─────────────────────────────

router.post(
  '/batch-enroll',
  authenticate,
  authorize('admin', 'practice_admin', 'credentialing_staff'),
  batchEnrollLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.practiceScope?.practiceIds?.[0];
      if (!practiceId) {
        res.status(400).json({ error: 'Practice context required' });
        return;
      }

      const validated = batchEnrollSchema.parse(req.body);

      // Verify provider belongs to this practice
      const provider = await prisma.provider.findFirst({
        where: { id: validated.providerId, practiceId },
        select: { id: true, practiceId: true, practice: { select: { slaTargetDays: true } } },
      });
      if (!provider) {
        res.status(404).json({ error: 'Provider not found in your practice' });
        return;
      }

      // Verify all payer IDs exist
      const payers = await prisma.payer.findMany({
        where: { id: { in: validated.payerIds } },
        select: { id: true, name: true },
      });
      if (payers.length !== validated.payerIds.length) {
        res.status(400).json({ error: 'One or more payer IDs are invalid' });
        return;
      }

      const slaTargetDays = provider.practice?.slaTargetDays ?? 90;

      // Create enrollments, skipping duplicates
      const results: { created: string[]; skipped: string[] } = { created: [], skipped: [] };

      for (const payerId of validated.payerIds) {
        const slaTargetDate = new Date(Date.now() + slaTargetDays * 86_400_000);
        try {
          const enrollment = await prisma.payerEnrollment.create({
            data: {
              providerId: validated.providerId,
              payerId,
              status: 'not_started',
              createdById: req.user?.id,
              slaTargetDate,
            },
          });

          results.created.push(payerId);

          // Fire-and-forget: auto-create work items
          autoCreateWorkItems(enrollment.id).catch((err) => {
            logger.error(`[Setup] Failed to auto-create work items for enrollment ${enrollment.id}: ${err instanceof Error ? err.message : 'unknown'}`);
          });
        } catch (err: any) {
          if (err?.code === 'P2002') {
            results.skipped.push(payerId);
          } else {
            throw err;
          }
        }
      }

      logger.info(`[Setup] Batch enroll for provider ${validated.providerId}: ${results.created.length} created, ${results.skipped.length} skipped`);
      invalidateCache('dashboard:');
      invalidateCache('ops:');

      res.status(201).json({
        success: true,
        data: {
          created: results.created.length,
          skipped: results.skipped.length,
          total: validated.payerIds.length,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      next(error);
    }
  }
);

// ── GET /recommended-payers ────────────────────────

router.get(
  '/recommended-payers',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = req.query['state'] as string | undefined;
      const providerType = req.query['providerType'] as string | undefined;

      const where: Record<string, unknown> = {};

      if (state) {
        // Payers that operate in the given state
        where['state'] = state;
      }

      if (providerType) {
        // Payers with matching vertical tags
        where['verticalTags'] = { has: providerType };
      }

      // Always return payers, fall back to all payers if no filters match well
      const payers = await prisma.payer.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        select: {
          id: true,
          name: true,
          payerId: true,
          payerType: true,
          verticalTags: true,
          averageProcessingDays: true,
        },
        orderBy: { name: 'asc' },
        take: 50,
      });

      res.json({ success: true, data: payers });
    } catch (error) {
      next(error);
    }
  }
);

// ── GET /npi-lookup/:npi ───────────────────────────

router.get(
  '/npi-lookup/:npi',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const npi = req.params['npi']!;
      if (!/^\d{10}$/.test(npi)) {
        res.status(400).json({ error: 'NPI must be a 10-digit number' });
        return;
      }

      const result = await npiService.lookupByNPI(npi);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
