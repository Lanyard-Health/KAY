import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { z } from 'zod';
import {
  upsertEmbedding,
  deleteEmbeddings,
  isConfigured as isEmbeddingConfigured,
  searchSimilarWithSources,
} from '../services/knowledgeBase.embedding.service.js';
import { logger } from '../utils/logger.js';
import rateLimit from 'express-rate-limit';

export const knowledgeBaseRoutes = Router();
knowledgeBaseRoutes.use(authenticate);

// ─── Search (broader role access — must be before lanyard_admin-only guard) ──

const searchQuerySchema = z.object({
  q: z.string().min(3).max(500),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: { message: 'Too many search requests. Please wait before trying again.' } },
});

knowledgeBaseRoutes.get(
  '/search',
  authorize('admin', 'lanyard_admin', 'credentialing_staff', 'practice_admin'),
  searchRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: { message: 'Validation failed', details: parsed.error.flatten() } });
        return;
      }

      const results = await searchSimilarWithSources(parsed.data.q, parsed.data.limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.use(authorize('lanyard_admin'));

// ─── Zod Schemas ───────────────────────────────────────────

const payerTrackSchema = z.object({
  payerName: z.string().min(1),
  parentOrg: z.string().nullable().optional(),
  payerType: z.string().min(1),
  stateRegion: z.string().min(1),
  track: z.string().min(1),
  submissionMethod: z.string().min(1),
  enrollmentLink: z.string().nullable().optional(),
  portalUrl: z.string().nullable().optional(),
  productLines: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const payerContactSchema = z.object({
  contactType: z.string().min(1),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  fax: z.string().nullable().optional(),
  portalUrl: z.string().nullable().optional(),
  hours: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const payerTimelineSchema = z.object({
  processType: z.string().min(1),
  minDays: z.number().int().nullable().optional(),
  maxDays: z.number().int().nullable().optional(),
  stateOverrides: z.any().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const payerStateRuleSchema = z.object({
  state: z.string().min(1),
  ruleType: z.string().min(1),
  description: z.string().min(1),
  effectiveDate: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
});

const payerFormSchema = z.object({
  formName: z.string().min(1),
  format: z.string().min(1),
  url: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  isRequired: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const payerRequirementSchema = z.object({
  name: z.string().min(1),
  overrideType: z.string().min(1),
  rule: z.string().min(1),
  appliesTo: z.string().nullable().optional(),
  isBlocking: z.boolean(),
  source: z.string().nullable().optional(),
});

const requirementUniversalSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  appliesTo: z.string().min(1),
  isBlocking: z.boolean(),
  standardMinimum: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ─── Helper: build embedding text for a PayerTrack ─────────

function buildPayerTrackEmbeddingText(track: {
  payerName: string;
  track: string;
  stateRegion: string;
  payerType: string;
  submissionMethod: string;
  notes?: string | null;
}): string {
  return [
    `Payer: ${track.payerName}`,
    `Track: ${track.track}`,
    `Region: ${track.stateRegion}`,
    `Type: ${track.payerType}`,
    `Submission: ${track.submissionMethod}`,
    track.notes ? `Notes: ${track.notes}` : null,
  ].filter(Boolean).join('. ');
}

// Helper: fire-and-forget embedding (don't block the response)
function triggerEmbedding(
  sourceType: Parameters<typeof upsertEmbedding>[0],
  sourceId: string,
  contentText: string
): void {
  if (!isEmbeddingConfigured()) return;
  upsertEmbedding(sourceType, sourceId, contentText).catch((err) =>
    logger.error(`Embedding upsert failed for ${sourceType}:${sourceId}`, err)
  );
}

// ─── PayerTrack Routes ─────────────────────────────────────

// List all PayerTracks with child counts
knowledgeBaseRoutes.get(
  '/payer-tracks',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const search = (_req.query['search'] as string) || '';
      const payerType = _req.query['payerType'] as string | undefined;
      const stateRegion = _req.query['stateRegion'] as string | undefined;
      const isActive = _req.query['isActive'];

      const where: any = {};
      if (search) {
        where.OR = [
          { payerName: { contains: search, mode: 'insensitive' } },
          { track: { contains: search, mode: 'insensitive' } },
          { stateRegion: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (payerType) where.payerType = payerType;
      if (stateRegion) where.stateRegion = stateRegion;
      if (isActive !== undefined) where.isActive = isActive === 'true';

      const data = await prisma.payerTrack.findMany({
        where,
        include: {
          _count: {
            select: {
              contacts: true,
              timelines: true,
              stateRules: true,
              forms: true,
              requirements: true,
              workflowTemplates: true,
              followUpTemplates: true,
            },
          },
        },
        orderBy: [{ payerName: 'asc' }, { track: 'asc' }],
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Get single PayerTrack with all children
knowledgeBaseRoutes.get(
  '/payer-tracks/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await prisma.payerTrack.findUnique({
        where: { id: req.params['id'] },
        include: {
          contacts: { orderBy: { createdAt: 'asc' } },
          timelines: { orderBy: { createdAt: 'asc' } },
          stateRules: { orderBy: { state: 'asc' } },
          forms: { orderBy: { formName: 'asc' } },
          requirements: { orderBy: { name: 'asc' } },
        },
      });

      if (!data) {
        res.status(404).json({ success: false, error: { message: 'PayerTrack not found' } });
        return;
      }

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Create PayerTrack
knowledgeBaseRoutes.post(
  '/payer-tracks',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerTrackSchema.parse(req.body);
      const data = await prisma.payerTrack.create({ data: body });

      triggerEmbedding('payerTrack', data.id, buildPayerTrackEmbeddingText(data));

      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Update PayerTrack
knowledgeBaseRoutes.patch(
  '/payer-tracks/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerTrackSchema.partial().parse(req.body);
      const data = await prisma.payerTrack.update({
        where: { id: req.params['id'] },
        data: body,
      });

      triggerEmbedding('payerTrack', data.id, buildPayerTrackEmbeddingText(data));

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Delete PayerTrack (cascade deletes children + embeddings)
knowledgeBaseRoutes.delete(
  '/payer-tracks/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.payerTrack.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'PayerTrack deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── PayerContact Routes (nested under PayerTrack) ─────────

knowledgeBaseRoutes.post(
  '/payer-tracks/:trackId/contacts',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerContactSchema.parse(req.body);
      const data = await prisma.payerContact.create({
        data: { ...body, payerTrackId: req.params['trackId']! },
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.patch(
  '/contacts/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerContactSchema.partial().parse(req.body);
      const data = await prisma.payerContact.update({
        where: { id: req.params['id'] },
        data: body,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.delete(
  '/contacts/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.payerContact.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Contact deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── PayerTimeline Routes ──────────────────────────────────

knowledgeBaseRoutes.post(
  '/payer-tracks/:trackId/timelines',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerTimelineSchema.parse(req.body);
      const data = await prisma.payerTimeline.create({
        data: { ...body, payerTrackId: req.params['trackId']! },
      });
      triggerEmbedding('payerTimeline', data.id,
        `${data.processType}: ${data.minDays ?? '?'}-${data.maxDays ?? '?'} days. ${data.notes ?? ''}`);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.patch(
  '/timelines/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerTimelineSchema.partial().parse(req.body);
      const data = await prisma.payerTimeline.update({
        where: { id: req.params['id'] },
        data: body,
      });
      triggerEmbedding('payerTimeline', data.id,
        `${data.processType}: ${data.minDays ?? '?'}-${data.maxDays ?? '?'} days. ${data.notes ?? ''}`);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.delete(
  '/timelines/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.payerTimeline.findUnique({ where: { id: req.params['id'] } });
      if (existing) await deleteEmbeddings('payerTimeline', existing.id);
      await prisma.payerTimeline.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Timeline deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── PayerStateRule Routes ─────────────────────────────────

knowledgeBaseRoutes.post(
  '/payer-tracks/:trackId/state-rules',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerStateRuleSchema.parse(req.body);
      const data = await prisma.payerStateRule.create({
        data: {
          ...body,
          payerTrackId: req.params['trackId']!,
          effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null,
          expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
        },
      });
      triggerEmbedding('payerStateRule', data.id,
        `${data.state} ${data.ruleType}: ${data.description}`);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.patch(
  '/state-rules/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerStateRuleSchema.partial().parse(req.body);
      const data = await prisma.payerStateRule.update({
        where: { id: req.params['id'] },
        data: {
          ...body,
          effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
          expirationDate: body.expirationDate ? new Date(body.expirationDate) : undefined,
        },
      });
      triggerEmbedding('payerStateRule', data.id,
        `${data.state} ${data.ruleType}: ${data.description}`);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.delete(
  '/state-rules/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.payerStateRule.findUnique({ where: { id: req.params['id'] } });
      if (existing) await deleteEmbeddings('payerStateRule', existing.id);
      await prisma.payerStateRule.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'State rule deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── PayerForm Routes ──────────────────────────────────────

knowledgeBaseRoutes.post(
  '/payer-tracks/:trackId/forms',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerFormSchema.parse(req.body);
      const data = await prisma.payerForm.create({
        data: { ...body, payerTrackId: req.params['trackId']! },
      });
      triggerEmbedding('payerForm', data.id,
        `${data.formName} (${data.format}). ${data.notes ?? ''}`);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.patch(
  '/forms/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerFormSchema.partial().parse(req.body);
      const data = await prisma.payerForm.update({
        where: { id: req.params['id'] },
        data: body,
      });
      triggerEmbedding('payerForm', data.id,
        `${data.formName} (${data.format}). ${data.notes ?? ''}`);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.delete(
  '/forms/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.payerForm.findUnique({ where: { id: req.params['id'] } });
      if (existing) await deleteEmbeddings('payerForm', existing.id);
      await prisma.payerForm.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Form deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── PayerRequirement Routes ───────────────────────────────

knowledgeBaseRoutes.post(
  '/payer-tracks/:trackId/requirements',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerRequirementSchema.parse(req.body);
      const data = await prisma.payerRequirement.create({
        data: { ...body, payerTrackId: req.params['trackId']! },
      });
      triggerEmbedding('payerRequirement', data.id,
        `${data.name} (${data.overrideType}): ${data.rule}`);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.patch(
  '/requirements/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = payerRequirementSchema.partial().parse(req.body);
      const data = await prisma.payerRequirement.update({
        where: { id: req.params['id'] },
        data: body,
      });
      triggerEmbedding('payerRequirement', data.id,
        `${data.name} (${data.overrideType}): ${data.rule}`);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.delete(
  '/requirements/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.payerRequirement.findUnique({ where: { id: req.params['id'] } });
      if (existing) await deleteEmbeddings('payerRequirement', existing.id);
      await prisma.payerRequirement.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Requirement deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── RequirementUniversal Routes ───────────────────────────

knowledgeBaseRoutes.get(
  '/requirements-universal',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await prisma.requirementUniversal.findMany({
        orderBy: { name: 'asc' },
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.post(
  '/requirements-universal',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = requirementUniversalSchema.parse(req.body);
      const data = await prisma.requirementUniversal.create({ data: body });
      triggerEmbedding('requirementUniversal', data.id,
        `${data.name}: ${data.description}. Applies to: ${data.appliesTo}`);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.patch(
  '/requirements-universal/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = requirementUniversalSchema.partial().parse(req.body);
      const data = await prisma.requirementUniversal.update({
        where: { id: req.params['id'] },
        data: body,
      });
      triggerEmbedding('requirementUniversal', data.id,
        `${data.name}: ${data.description}. Applies to: ${data.appliesTo}`);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

knowledgeBaseRoutes.delete(
  '/requirements-universal/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deleteEmbeddings('requirementUniversal', req.params['id']!);
      await prisma.requirementUniversal.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Universal requirement deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Gaps Endpoint ─────────────────────────────────────────

knowledgeBaseRoutes.get(
  '/gaps',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      // Find all PayerTracks and check for null/empty fields on them and their children
      const tracks = await prisma.payerTrack.findMany({
        include: {
          contacts: true,
          timelines: true,
          stateRules: true,
          forms: true,
          requirements: true,
        },
        orderBy: [{ payerName: 'asc' }, { track: 'asc' }],
      });

      const gaps: Array<{
        payerTrackId: string;
        payerName: string;
        track: string;
        stateRegion: string;
        field: string;
        table: string;
        recordId?: string;
      }> = [];

      for (const t of tracks) {
        // Check PayerTrack-level nullable fields
        if (!t.parentOrg) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'parentOrg', table: 'PayerTrack' });
        if (!t.enrollmentLink) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'enrollmentLink', table: 'PayerTrack' });
        if (!t.portalUrl) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'portalUrl', table: 'PayerTrack' });
        if (!t.notes) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'notes', table: 'PayerTrack' });
        if (t.productLines.length === 0) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'productLines', table: 'PayerTrack' });

        // Check if missing children entirely
        if (t.contacts.length === 0) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'contacts (none)', table: 'PayerTrack' });
        if (t.timelines.length === 0) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'timelines (none)', table: 'PayerTrack' });

        // Check child-level nullable fields
        for (const c of t.contacts) {
          if (!c.phone && !c.email && !c.fax) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'contact missing phone/email/fax', table: 'PayerContact', recordId: c.id });
        }
        for (const tl of t.timelines) {
          if (tl.minDays === null) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'timeline minDays', table: 'PayerTimeline', recordId: tl.id });
          if (tl.maxDays === null) gaps.push({ payerTrackId: t.id, payerName: t.payerName, track: t.track, stateRegion: t.stateRegion, field: 'timeline maxDays', table: 'PayerTimeline', recordId: tl.id });
        }
      }

      // Also check RequirementUniversal gaps
      const universals = await prisma.requirementUniversal.findMany();
      for (const u of universals) {
        if (!u.standardMinimum) gaps.push({ payerTrackId: '', payerName: 'Universal', track: u.name, stateRegion: '', field: 'standardMinimum', table: 'RequirementUniversal', recordId: u.id });
        if (!u.notes) gaps.push({ payerTrackId: '', payerName: 'Universal', track: u.name, stateRegion: '', field: 'notes', table: 'RequirementUniversal', recordId: u.id });
      }

      res.json({ success: true, data: gaps, meta: { totalGaps: gaps.length } });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Filter Options (for dropdowns) ───────────────────────

knowledgeBaseRoutes.get(
  '/filter-options',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [payerTypes, stateRegions] = await Promise.all([
        prisma.payerTrack.findMany({ select: { payerType: true }, distinct: ['payerType'], orderBy: { payerType: 'asc' } }),
        prisma.payerTrack.findMany({ select: { stateRegion: true }, distinct: ['stateRegion'], orderBy: { stateRegion: 'asc' } }),
      ]);

      res.json({
        success: true,
        data: {
          payerTypes: payerTypes.map((p) => p.payerType),
          stateRegions: stateRegions.map((s) => s.stateRegion),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
