/**
 * Defacto network participation routes (Phase 1 — internal admin only).
 * Mounted at /api/v1/admin/providers. Practice-facing exposure is explicitly
 * out of scope until Defacto's terms are confirmed.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as Sentry from '@sentry/node';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import {
  DefactoService,
  DefactoNotConfiguredError,
} from '../services/defacto.service.js';

export const defactoRoutes = Router();

defactoRoutes.use(authenticate);
// admin + lanyard_staff only. Both are cross-practice by design, which is what
// makes the unfiltered ID lookups below safe. credentialing_staff is
// practice-scoped and was previously admitted here, so it could read another
// practice's provider NPI and network participation. lanyard_staff must be
// named explicitly — the inheritance rule in auth.middleware.ts only admits it
// when credentialing_staff is in the list.
defactoRoutes.use(authorize('admin', 'lanyard_staff'));

const defactoService = new DefactoService();

const paramsSchema = z.object({ id: z.string().uuid() });

// rawResponse stays in the database only — never returned by the API.
const snapshotSelect = {
  id: true,
  npi: true,
  fetchedAt: true,
  status: true,
  errorMessage: true,
  planRecords: {
    select: {
      id: true,
      carrierName: true,
      carrierOrPlanName: true,
      lob: true,
      organizationName: true,
      organizationNpi: true,
      locationCity: true,
      locationState: true,
    },
  },
} as const;

/** GET /:id/defacto — latest snapshot with its plan records (null if never checked). */
defactoRoutes.get('/:id/defacto', async (req: Request, res: Response) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ success: false, error: { message: 'Invalid provider id' } });
    return;
  }
  try {
    const snapshot = await prisma.defactoSnapshot.findFirst({
      where: { providerId: params.data.id },
      orderBy: { fetchedAt: 'desc' },
      select: snapshotSelect,
    });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    logger.error({
      event: 'defacto_get_failed',
      providerId: params.data.id,
      message: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, { tags: { service: 'defacto', route: 'GET /:id/defacto' } });
    res.status(500).json({ success: false, error: { message: 'Could not load network participation data.' } });
  }
});

/** POST /:id/defacto-check — fresh lookup, stores a new snapshot (history kept). */
defactoRoutes.post('/:id/defacto-check', async (req: Request, res: Response) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ success: false, error: { message: 'Invalid provider id' } });
    return;
  }
  const providerId = params.data.id;

  try {
    const provider = await prisma.providerProfile.findFirst({
      where: { id: providerId, deletedAt: null },
      select: { id: true, npi: true },
    });
    if (!provider) {
      res.status(404).json({ success: false, error: { message: 'Provider not found' } });
      return;
    }
    if (!provider.npi) {
      res.status(400).json({
        success: false,
        error: { message: 'This provider has no NPI on file yet — add one before checking network participation.' },
      });
      return;
    }

    let lookup;
    try {
      lookup = await defactoService.lookupByNpi(provider.npi);
    } catch (error) {
      if (error instanceof DefactoNotConfiguredError) {
        res.status(503).json({ success: false, error: { message: error.message } });
        return;
      }
      const message = error instanceof Error ? error.message : 'Defacto lookup failed.';
      // Failed lookups are part of the history too (status: error).
      await prisma.defactoSnapshot.create({
        data: { providerId, npi: provider.npi, status: 'error', errorMessage: message },
      });
      logger.error({ event: 'defacto_check_failed', providerId, message });
      Sentry.captureException(error, { tags: { service: 'defacto', route: 'POST /:id/defacto-check' } });
      res.status(502).json({ success: false, error: { message } });
      return;
    }

    // createMany instead of nested create — a real practitioner can produce
    // thousands of (plan × relationship) rows (4,763 observed on the first
    // live NPI tested), and per-row nested inserts would crawl.
    const snapshotId = await prisma.$transaction(async (tx) => {
      const created = await tx.defactoSnapshot.create({
        data: {
          providerId,
          npi: provider.npi!,
          status: lookup.status,
          rawResponse: lookup.rawResponse === null ? undefined : (lookup.rawResponse as object),
        },
        select: { id: true },
      });
      if (lookup.planRows.length > 0) {
        await tx.defactoPlanRecord.createMany({
          data: lookup.planRows.map((row) => ({ ...row, snapshotId: created.id })),
        });
      }
      return created.id;
    });

    const snapshot = await prisma.defactoSnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
      select: snapshotSelect,
    });

    res.json({ success: true, data: snapshot });
  } catch (error) {
    logger.error({
      event: 'defacto_check_unhandled',
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, { tags: { service: 'defacto', route: 'POST /:id/defacto-check' } });
    res.status(500).json({ success: false, error: { message: 'Could not save the network participation check.' } });
  }
});
