# Lanyard Admin UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 4 admin screen groups (`/admin/knowledge-base`, `/admin/knowledge-base/gaps`, `/admin/workflow-templates`, `/admin/followup-templates`) restricted to `lanyard_admin` role, with full backend CRUD + embedding auto-trigger.

**Architecture:** Screen-by-screen approach — each task builds backend routes + frontend page together so every task produces a working increment. Backend uses Express + Prisma + Zod validation following existing `payer.routes.ts` patterns. Frontend uses React + React Query + headlessui tabs + Tailwind following existing `PracticesList.tsx` / `PracticeDetail.tsx` patterns. Auto-embed on every KB save via `upsertEmbedding()` (degrades gracefully if no OPENAI_API_KEY).

**Tech Stack:** Express, Prisma, Zod, React 18, React Query, headlessui, Tailwind, heroicons

**Branch:** `feat/schema-redesign-v2` (continue existing branch)

---

## Task 1: Knowledge Base Backend Routes

Build `knowledgeBase.routes.ts` with full CRUD for PayerTrack + all child tables. Auto-trigger embedding on create/update.

**Files:**
- Create: `packages/backend/src/routes/knowledgeBase.routes.ts`
- Modify: `packages/backend/src/index.ts` (add route mount)

**Step 1: Create the route file with PayerTrack CRUD**

Create `packages/backend/src/routes/knowledgeBase.routes.ts`:

```typescript
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { z } from 'zod';
import {
  upsertEmbedding,
  deleteEmbeddings,
  isConfigured as isEmbeddingConfigured,
} from '../services/knowledgeBase.embedding.service.js';
import { logger } from '../utils/logger.js';

export const knowledgeBaseRoutes = Router();
knowledgeBaseRoutes.use(authenticate);
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
```

**Step 2: Register the route in index.ts**

In `packages/backend/src/index.ts`, add:
- Import: `import { knowledgeBaseRoutes } from './routes/knowledgeBase.routes.js';`
- Mount: `app.use('/api/v1/knowledge-base', knowledgeBaseRoutes);`

Add these alongside the existing route registrations (around line 210).

**Step 3: Verify backend compiles**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`
Expected: No new errors

**Step 4: Commit**

```bash
git add packages/backend/src/routes/knowledgeBase.routes.ts packages/backend/src/index.ts
git commit -m "feat: add knowledge base CRUD routes with embedding auto-trigger"
```

---

## Task 2: Workflow Template & Follow-up Template Backend Routes

**Files:**
- Create: `packages/backend/src/routes/workflowTemplate.routes.ts`
- Create: `packages/backend/src/routes/followupTemplate.routes.ts`
- Modify: `packages/backend/src/index.ts` (add route mounts)

**Step 1: Create workflow template routes**

Create `packages/backend/src/routes/workflowTemplate.routes.ts`:

```typescript
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { z } from 'zod';

export const workflowTemplateRoutes = Router();
workflowTemplateRoutes.use(authenticate);
workflowTemplateRoutes.use(authorize('lanyard_admin'));

const stepSchema = z.object({
  stepOrder: z.number().int(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  stepType: z.string().min(1),
  owner: z.string().min(1),
  requiredDocuments: z.array(z.string()).optional(),
  triggerDaysAfterPrev: z.number().int().nullable().optional(),
  isBlocking: z.boolean().optional(),
  reviewerInstructions: z.string().nullable().optional(),
});

const conditionSchema = z.object({
  conditionType: z.string().min(1),
  conditionValue: z.string().min(1),
  action: z.string().min(1),
  targetStepOrder: z.number().int().nullable().optional(),
  stepDefinition: z.any().nullable().optional(),
});

const templateSchema = z.object({
  payerTrackId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  description: z.string().nullable().optional(),
  steps: z.array(stepSchema).optional(),
  conditions: z.array(conditionSchema).optional(),
});

// List all templates
workflowTemplateRoutes.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query['status'] as string | undefined;
      const payerTrackId = req.query['payerTrackId'] as string | undefined;

      const data = await prisma.workflowTemplate.findMany({
        where: {
          ...(status && { status }),
          ...(payerTrackId && { payerTrackId }),
        },
        include: {
          payerTrack: { select: { payerName: true, track: true, stateRegion: true } },
          _count: { select: { steps: true, conditions: true, enrollments: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Get single template with steps + conditions
workflowTemplateRoutes.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await prisma.workflowTemplate.findUnique({
        where: { id: req.params['id'] },
        include: {
          payerTrack: { select: { payerName: true, track: true, stateRegion: true } },
          steps: { orderBy: { stepOrder: 'asc' } },
          conditions: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!data) {
        res.status(404).json({ success: false, error: { message: 'Template not found' } });
        return;
      }

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Create template (with optional inline steps + conditions)
workflowTemplateRoutes.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { steps, conditions, ...body } = templateSchema.parse(req.body);

      const data = await prisma.workflowTemplate.create({
        data: {
          ...body,
          status: body.status || 'draft',
          createdBy: req.user!.id,
          ...(steps && { steps: { create: steps } }),
          ...(conditions && { conditions: { create: conditions } }),
        },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          conditions: true,
        },
      });

      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Update template
workflowTemplateRoutes.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { steps, conditions, ...body } = templateSchema.partial().parse(req.body);

      const data = await prisma.workflowTemplate.update({
        where: { id: req.params['id'] },
        data: {
          ...body,
          ...(body.status === 'active' && { publishedAt: new Date() }),
        },
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Delete template
workflowTemplateRoutes.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.workflowTemplate.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Steps CRUD ────────────────────────────────────────────

workflowTemplateRoutes.post(
  '/:templateId/steps',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = stepSchema.parse(req.body);
      const data = await prisma.workflowTemplateStep.create({
        data: { ...body, templateId: req.params['templateId']! },
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

workflowTemplateRoutes.patch(
  '/steps/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = stepSchema.partial().parse(req.body);
      const data = await prisma.workflowTemplateStep.update({
        where: { id: req.params['id'] },
        data: body,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

workflowTemplateRoutes.delete(
  '/steps/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.workflowTemplateStep.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Step deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Conditions CRUD ───────────────────────────────────────

workflowTemplateRoutes.post(
  '/:templateId/conditions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = conditionSchema.parse(req.body);
      const data = await prisma.workflowTemplateCondition.create({
        data: { ...body, templateId: req.params['templateId']! },
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

workflowTemplateRoutes.delete(
  '/conditions/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.workflowTemplateCondition.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Condition deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Reorder Steps (bulk update) ───────────────────────────

workflowTemplateRoutes.put(
  '/:templateId/steps/reorder',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { order } = z.object({ order: z.array(z.object({ id: z.string(), stepOrder: z.number().int() })) }).parse(req.body);

      await prisma.$transaction(
        order.map((item) =>
          prisma.workflowTemplateStep.update({
            where: { id: item.id },
            data: { stepOrder: item.stepOrder },
          })
        )
      );

      res.json({ success: true, message: 'Steps reordered' });
    } catch (error) {
      next(error);
    }
  }
);
```

**Step 2: Create follow-up template routes**

Create `packages/backend/src/routes/followupTemplate.routes.ts`:

```typescript
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { z } from 'zod';

export const followupTemplateRoutes = Router();
followupTemplateRoutes.use(authenticate);
followupTemplateRoutes.use(authorize('lanyard_admin'));

const followUpStepSchema = z.object({
  stepOrder: z.number().int(),
  name: z.string().min(1),
  channel: z.enum(['email', 'phone_call']),
  triggerDaysAfterPrev: z.number().int(),
  escalationLevel: z.number().int().optional(),
  emailSubject: z.string().nullable().optional(),
  emailBodyTemplate: z.string().nullable().optional(),
  emailTone: z.string().nullable().optional(),
  retellScriptTemplate: z.string().nullable().optional(),
  retellAgentId: z.string().nullable().optional(),
  requiresApproval: z.boolean().optional(),
});

const followUpTemplateSchema = z.object({
  payerTrackId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  description: z.string().nullable().optional(),
  steps: z.array(followUpStepSchema).optional(),
});

// List
followupTemplateRoutes.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query['status'] as string | undefined;
      const payerTrackId = req.query['payerTrackId'] as string | undefined;

      const data = await prisma.followUpTemplate.findMany({
        where: {
          ...(status && { status }),
          ...(payerTrackId && { payerTrackId }),
        },
        include: {
          payerTrack: { select: { payerName: true, track: true, stateRegion: true } },
          _count: { select: { steps: true, runs: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Get single
followupTemplateRoutes.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await prisma.followUpTemplate.findUnique({
        where: { id: req.params['id'] },
        include: {
          payerTrack: { select: { payerName: true, track: true, stateRegion: true } },
          steps: { orderBy: { stepOrder: 'asc' } },
        },
      });

      if (!data) {
        res.status(404).json({ success: false, error: { message: 'Template not found' } });
        return;
      }

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Create
followupTemplateRoutes.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { steps, ...body } = followUpTemplateSchema.parse(req.body);

      const data = await prisma.followUpTemplate.create({
        data: {
          ...body,
          status: body.status || 'draft',
          createdBy: req.user!.id,
          ...(steps && { steps: { create: steps } }),
        },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
        },
      });

      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Update
followupTemplateRoutes.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { steps, ...body } = followUpTemplateSchema.partial().parse(req.body);

      const data = await prisma.followUpTemplate.update({
        where: { id: req.params['id'] },
        data: {
          ...body,
          ...(body.status === 'active' && { publishedAt: new Date() }),
        },
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

// Delete
followupTemplateRoutes.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.followUpTemplate.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Steps CRUD ────────────────────────────────────────────

followupTemplateRoutes.post(
  '/:templateId/steps',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = followUpStepSchema.parse(req.body);
      const data = await prisma.followUpTemplateStep.create({
        data: { ...body, templateId: req.params['templateId']! },
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

followupTemplateRoutes.patch(
  '/steps/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = followUpStepSchema.partial().parse(req.body);
      const data = await prisma.followUpTemplateStep.update({
        where: { id: req.params['id'] },
        data: body,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

followupTemplateRoutes.delete(
  '/steps/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.followUpTemplateStep.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, message: 'Step deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Reorder Steps ─────────────────────────────────────────

followupTemplateRoutes.put(
  '/:templateId/steps/reorder',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { order } = z.object({ order: z.array(z.object({ id: z.string(), stepOrder: z.number().int() })) }).parse(req.body);

      await prisma.$transaction(
        order.map((item) =>
          prisma.followUpTemplateStep.update({
            where: { id: item.id },
            data: { stepOrder: item.stepOrder },
          })
        )
      );

      res.json({ success: true, message: 'Steps reordered' });
    } catch (error) {
      next(error);
    }
  }
);
```

**Step 3: Register both routes in index.ts**

Add to `packages/backend/src/index.ts`:
- `import { workflowTemplateRoutes } from './routes/workflowTemplate.routes.js';`
- `import { followupTemplateRoutes } from './routes/followupTemplate.routes.js';`
- `app.use('/api/v1/workflow-templates', workflowTemplateRoutes);`
- `app.use('/api/v1/followup-templates', followupTemplateRoutes);`

**Step 4: Verify backend compiles**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`
Expected: No new errors

**Step 5: Commit**

```bash
git add packages/backend/src/routes/workflowTemplate.routes.ts packages/backend/src/routes/followupTemplate.routes.ts packages/backend/src/index.ts
git commit -m "feat: add workflow template and follow-up template CRUD routes"
```

---

## Task 3: Frontend React Query Hooks

Create hooks for all three resource groups.

**Files:**
- Create: `packages/frontend/src/hooks/useKnowledgeBase.ts`
- Create: `packages/frontend/src/hooks/useWorkflowTemplates.ts`
- Create: `packages/frontend/src/hooks/useFollowupTemplates.ts`

**Step 1: Create knowledge base hooks**

Create `packages/frontend/src/hooks/useKnowledgeBase.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ─── Types ─────────────────────────────────────────────────

export interface PayerTrack {
  id: string;
  payerName: string;
  parentOrg: string | null;
  payerType: string;
  stateRegion: string;
  track: string;
  submissionMethod: string;
  enrollmentLink: string | null;
  portalUrl: string | null;
  productLines: string[];
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contacts?: PayerContact[];
  timelines?: PayerTimeline[];
  stateRules?: PayerStateRule[];
  forms?: PayerForm[];
  requirements?: PayerRequirement[];
  _count?: {
    contacts: number;
    timelines: number;
    stateRules: number;
    forms: number;
    requirements: number;
    workflowTemplates: number;
    followUpTemplates: number;
  };
}

export interface PayerContact {
  id: string;
  payerTrackId: string;
  contactType: string;
  phone: string | null;
  email: string | null;
  fax: string | null;
  portalUrl: string | null;
  hours: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PayerTimeline {
  id: string;
  payerTrackId: string;
  processType: string;
  minDays: number | null;
  maxDays: number | null;
  stateOverrides: Record<string, number> | null;
  notes: string | null;
  createdAt: string;
}

export interface PayerStateRule {
  id: string;
  payerTrackId: string;
  state: string;
  ruleType: string;
  description: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  createdAt: string;
}

export interface PayerForm {
  id: string;
  payerTrackId: string;
  formName: string;
  format: string;
  url: string | null;
  destination: string | null;
  isRequired: boolean;
  notes: string | null;
  createdAt: string;
}

export interface PayerRequirement {
  id: string;
  payerTrackId: string;
  name: string;
  overrideType: string;
  rule: string;
  appliesTo: string | null;
  isBlocking: boolean;
  source: string | null;
  createdAt: string;
}

export interface RequirementUniversal {
  id: string;
  name: string;
  description: string;
  appliesTo: string;
  isBlocking: boolean;
  standardMinimum: string | null;
  notes: string | null;
  createdAt: string;
}

export interface KnowledgeBaseGap {
  payerTrackId: string;
  payerName: string;
  track: string;
  stateRegion: string;
  field: string;
  table: string;
  recordId?: string;
}

export interface FilterOptions {
  payerTypes: string[];
  stateRegions: string[];
}

// ─── Queries ───────────────────────────────────────────────

export function usePayerTracks(filters?: { search?: string; payerType?: string; stateRegion?: string; isActive?: string }) {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.payerType) params.set('payerType', filters.payerType);
  if (filters?.stateRegion) params.set('stateRegion', filters.stateRegion);
  if (filters?.isActive) params.set('isActive', filters.isActive);
  const qs = params.toString();

  return useQuery({
    queryKey: ['payerTracks', filters],
    queryFn: async () => {
      const response = await api.get(`/knowledge-base/payer-tracks${qs ? `?${qs}` : ''}`);
      return response.data.data as PayerTrack[];
    },
  });
}

export function usePayerTrack(id: string) {
  return useQuery({
    queryKey: ['payerTrack', id],
    queryFn: async () => {
      const response = await api.get(`/knowledge-base/payer-tracks/${id}`);
      return response.data.data as PayerTrack;
    },
    enabled: !!id,
  });
}

export function useKnowledgeBaseGaps() {
  return useQuery({
    queryKey: ['knowledgeBaseGaps'],
    queryFn: async () => {
      const response = await api.get('/knowledge-base/gaps');
      return response.data as { data: KnowledgeBaseGap[]; meta: { totalGaps: number } };
    },
  });
}

export function useFilterOptions() {
  return useQuery({
    queryKey: ['knowledgeBaseFilterOptions'],
    queryFn: async () => {
      const response = await api.get('/knowledge-base/filter-options');
      return response.data.data as FilterOptions;
    },
  });
}

export function useRequirementsUniversal() {
  return useQuery({
    queryKey: ['requirementsUniversal'],
    queryFn: async () => {
      const response = await api.get('/knowledge-base/requirements-universal');
      return response.data.data as RequirementUniversal[];
    },
  });
}

// ─── Mutations ─────────────────────────────────────────────

export function useCreatePayerTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<PayerTrack>) => {
      const response = await api.post('/knowledge-base/payer-tracks', data);
      return response.data.data as PayerTrack;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payerTracks'] }); },
  });
}

export function useUpdatePayerTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<PayerTrack>) => {
      const response = await api.patch(`/knowledge-base/payer-tracks/${id}`, data);
      return response.data.data as PayerTrack;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['payerTracks'] });
      qc.invalidateQueries({ queryKey: ['payerTrack', v.id] });
      qc.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

export function useDeletePayerTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/knowledge-base/payer-tracks/${id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payerTracks'] });
      qc.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

// Child mutations — all invalidate parent payerTrack detail + gaps
function useChildMutation<T>(
  createFn: (data: any) => Promise<T>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payerTrack'] });
      qc.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

export function useCreateContact() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Partial<PayerContact>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/contacts`, data);
    return response.data.data;
  });
}

export function useUpdateContact() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<PayerContact>) => {
    const response = await api.patch(`/knowledge-base/contacts/${id}`, data);
    return response.data.data;
  });
}

export function useDeleteContact() {
  return useChildMutation(async (id: string) => { await api.delete(`/knowledge-base/contacts/${id}`); });
}

export function useCreateTimeline() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Partial<PayerTimeline>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/timelines`, data);
    return response.data.data;
  });
}

export function useUpdateTimeline() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<PayerTimeline>) => {
    const response = await api.patch(`/knowledge-base/timelines/${id}`, data);
    return response.data.data;
  });
}

export function useDeleteTimeline() {
  return useChildMutation(async (id: string) => { await api.delete(`/knowledge-base/timelines/${id}`); });
}

export function useCreateStateRule() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Partial<PayerStateRule>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/state-rules`, data);
    return response.data.data;
  });
}

export function useUpdateStateRule() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<PayerStateRule>) => {
    const response = await api.patch(`/knowledge-base/state-rules/${id}`, data);
    return response.data.data;
  });
}

export function useDeleteStateRule() {
  return useChildMutation(async (id: string) => { await api.delete(`/knowledge-base/state-rules/${id}`); });
}

export function useCreateForm() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Partial<PayerForm>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/forms`, data);
    return response.data.data;
  });
}

export function useUpdateForm() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<PayerForm>) => {
    const response = await api.patch(`/knowledge-base/forms/${id}`, data);
    return response.data.data;
  });
}

export function useDeleteForm() {
  return useChildMutation(async (id: string) => { await api.delete(`/knowledge-base/forms/${id}`); });
}

export function useCreateRequirement() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Partial<PayerRequirement>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/requirements`, data);
    return response.data.data;
  });
}

export function useUpdateRequirement() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<PayerRequirement>) => {
    const response = await api.patch(`/knowledge-base/requirements/${id}`, data);
    return response.data.data;
  });
}

export function useDeleteRequirement() {
  return useChildMutation(async (id: string) => { await api.delete(`/knowledge-base/requirements/${id}`); });
}

export function useCreateRequirementUniversal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<RequirementUniversal>) => {
      const response = await api.post('/knowledge-base/requirements-universal', data);
      return response.data.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requirementsUniversal'] }); },
  });
}

export function useUpdateRequirementUniversal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<RequirementUniversal>) => {
      const response = await api.patch(`/knowledge-base/requirements-universal/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requirementsUniversal'] });
      qc.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

export function useDeleteRequirementUniversal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/knowledge-base/requirements-universal/${id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requirementsUniversal'] });
      qc.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}
```

**Step 2: Create workflow template hooks**

Create `packages/frontend/src/hooks/useWorkflowTemplates.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export interface WorkflowTemplate {
  id: string;
  payerTrackId: string;
  name: string;
  version: number;
  status: string;
  description: string | null;
  createdBy: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  payerTrack?: { payerName: string; track: string; stateRegion: string };
  steps?: WorkflowTemplateStep[];
  conditions?: WorkflowTemplateCondition[];
  _count?: { steps: number; conditions: number; enrollments: number };
}

export interface WorkflowTemplateStep {
  id: string;
  templateId: string;
  stepOrder: number;
  name: string;
  description: string | null;
  stepType: string;
  owner: string;
  requiredDocuments: string[];
  triggerDaysAfterPrev: number | null;
  isBlocking: boolean;
  reviewerInstructions: string | null;
  createdAt: string;
}

export interface WorkflowTemplateCondition {
  id: string;
  templateId: string;
  conditionType: string;
  conditionValue: string;
  action: string;
  targetStepOrder: number | null;
  stepDefinition: any;
  createdAt: string;
}

export function useWorkflowTemplates(filters?: { status?: string; payerTrackId?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.payerTrackId) params.set('payerTrackId', filters.payerTrackId);
  const qs = params.toString();

  return useQuery({
    queryKey: ['workflowTemplates', filters],
    queryFn: async () => {
      const response = await api.get(`/workflow-templates${qs ? `?${qs}` : ''}`);
      return response.data.data as WorkflowTemplate[];
    },
  });
}

export function useWorkflowTemplate(id: string) {
  return useQuery({
    queryKey: ['workflowTemplate', id],
    queryFn: async () => {
      const response = await api.get(`/workflow-templates/${id}`);
      return response.data.data as WorkflowTemplate;
    },
    enabled: !!id,
  });
}

export function useCreateWorkflowTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await api.post('/workflow-templates', data);
      return response.data.data as WorkflowTemplate;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflowTemplates'] }); },
  });
}

export function useUpdateWorkflowTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<WorkflowTemplate>) => {
      const response = await api.patch(`/workflow-templates/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['workflowTemplates'] });
      qc.invalidateQueries({ queryKey: ['workflowTemplate', v.id] });
    },
  });
}

export function useDeleteWorkflowTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/workflow-templates/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflowTemplates'] }); },
  });
}

export function useCreateWorkflowStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, ...data }: { templateId: string } & Partial<WorkflowTemplateStep>) => {
      const response = await api.post(`/workflow-templates/${templateId}/steps`, data);
      return response.data.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflowTemplate'] }); },
  });
}

export function useUpdateWorkflowStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<WorkflowTemplateStep>) => {
      const response = await api.patch(`/workflow-templates/steps/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflowTemplate'] }); },
  });
}

export function useDeleteWorkflowStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/workflow-templates/steps/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflowTemplate'] }); },
  });
}

export function useReorderWorkflowSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, order }: { templateId: string; order: { id: string; stepOrder: number }[] }) => {
      await api.put(`/workflow-templates/${templateId}/steps/reorder`, { order });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflowTemplate'] }); },
  });
}

export function useCreateWorkflowCondition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, ...data }: { templateId: string } & Partial<WorkflowTemplateCondition>) => {
      const response = await api.post(`/workflow-templates/${templateId}/conditions`, data);
      return response.data.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflowTemplate'] }); },
  });
}

export function useDeleteWorkflowCondition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/workflow-templates/conditions/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workflowTemplate'] }); },
  });
}
```

**Step 3: Create follow-up template hooks**

Create `packages/frontend/src/hooks/useFollowupTemplates.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export interface FollowUpTemplate {
  id: string;
  payerTrackId: string;
  name: string;
  version: number;
  status: string;
  description: string | null;
  createdBy: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  payerTrack?: { payerName: string; track: string; stateRegion: string };
  steps?: FollowUpTemplateStep[];
  _count?: { steps: number; runs: number };
}

export interface FollowUpTemplateStep {
  id: string;
  templateId: string;
  stepOrder: number;
  name: string;
  channel: string;
  triggerDaysAfterPrev: number;
  escalationLevel: number;
  emailSubject: string | null;
  emailBodyTemplate: string | null;
  emailTone: string | null;
  retellScriptTemplate: string | null;
  retellAgentId: string | null;
  requiresApproval: boolean;
  createdAt: string;
}

export function useFollowupTemplates(filters?: { status?: string; payerTrackId?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.payerTrackId) params.set('payerTrackId', filters.payerTrackId);
  const qs = params.toString();

  return useQuery({
    queryKey: ['followupTemplates', filters],
    queryFn: async () => {
      const response = await api.get(`/followup-templates${qs ? `?${qs}` : ''}`);
      return response.data.data as FollowUpTemplate[];
    },
  });
}

export function useFollowupTemplate(id: string) {
  return useQuery({
    queryKey: ['followupTemplate', id],
    queryFn: async () => {
      const response = await api.get(`/followup-templates/${id}`);
      return response.data.data as FollowUpTemplate;
    },
    enabled: !!id,
  });
}

export function useCreateFollowupTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const response = await api.post('/followup-templates', data);
      return response.data.data as FollowUpTemplate;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['followupTemplates'] }); },
  });
}

export function useUpdateFollowupTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<FollowUpTemplate>) => {
      const response = await api.patch(`/followup-templates/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['followupTemplates'] });
      qc.invalidateQueries({ queryKey: ['followupTemplate', v.id] });
    },
  });
}

export function useDeleteFollowupTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/followup-templates/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['followupTemplates'] }); },
  });
}

export function useCreateFollowupStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, ...data }: { templateId: string } & Partial<FollowUpTemplateStep>) => {
      const response = await api.post(`/followup-templates/${templateId}/steps`, data);
      return response.data.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['followupTemplate'] }); },
  });
}

export function useUpdateFollowupStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<FollowUpTemplateStep>) => {
      const response = await api.patch(`/followup-templates/steps/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['followupTemplate'] }); },
  });
}

export function useDeleteFollowupStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/followup-templates/steps/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['followupTemplate'] }); },
  });
}

export function useReorderFollowupSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, order }: { templateId: string; order: { id: string; stepOrder: number }[] }) => {
      await api.put(`/followup-templates/${templateId}/steps/reorder`, { order });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['followupTemplate'] }); },
  });
}
```

**Step 4: Commit**

```bash
git add packages/frontend/src/hooks/useKnowledgeBase.ts packages/frontend/src/hooks/useWorkflowTemplates.ts packages/frontend/src/hooks/useFollowupTemplates.ts
git commit -m "feat: add React Query hooks for knowledge base, workflow templates, follow-up templates"
```

---

## Task 4: Knowledge Base List Page

Searchable/filterable table of all PayerTracks with completeness indicators.

**Files:**
- Create: `packages/frontend/src/features/admin/KnowledgeBaseList.tsx`
- Modify: `packages/frontend/src/App.tsx` (add route)

**Step 1: Create the list page**

Create `packages/frontend/src/features/admin/KnowledgeBaseList.tsx`. This page should:

- Header: "Knowledge Base" title + "Add Payer Track" button (links to `/admin/knowledge-base/new`)
- Search bar: text input debounced 300ms, filters `search` param
- Filter row: dropdown for payerType, dropdown for stateRegion (populated from `/filter-options`), active/inactive toggle
- Table columns: Payer Name, Track, State/Region, Type, Submission, Completeness (badge showing child counts), Active status
- Each row links to `/admin/knowledge-base/{id}`
- Completeness badge: green if all child counts > 0, yellow if some missing, red if many missing
- Empty state when no results
- Loading skeleton while fetching
- Use `usePayerTracks()` and `useFilterOptions()` hooks
- Follow the `PracticesList.tsx` pattern exactly: `PageTransition` wrapper, table structure, `EmptyState` component

**Step 2: Add lazy route in App.tsx**

In `packages/frontend/src/App.tsx`:
- Add lazy import: `const KnowledgeBaseList = lazy(() => import('./features/admin/KnowledgeBaseList'));`
- Add route inside the admin `<Route>` block: `<Route path="admin/knowledge-base" element={<KnowledgeBaseList />} />`

**Step 3: Verify frontend compiles**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/frontend/src/features/admin/KnowledgeBaseList.tsx packages/frontend/src/App.tsx
git commit -m "feat: add Knowledge Base list page with search, filters, completeness badges"
```

---

## Task 5: Knowledge Base Detail Page

Full PayerTrack editor with tabbed sections for child records.

**Files:**
- Create: `packages/frontend/src/features/admin/KnowledgeBaseDetail.tsx`
- Modify: `packages/frontend/src/App.tsx` (add route)

**Step 1: Create the detail page**

Create `packages/frontend/src/features/admin/KnowledgeBaseDetail.tsx`. This page should:

- Back link to `/admin/knowledge-base`
- Header: PayerTrack name (`{payerName} — {track} ({stateRegion})`), Edit button, Delete button (with confirmation)
- Top section: editable card for PayerTrack fields (payerName, parentOrg, payerType, stateRegion, track, submissionMethod, enrollmentLink, portalUrl, productLines, notes, isActive). Use inline editing — click a field to edit, blur/enter to save via `useUpdatePayerTrack()`
- Tab.Group with 5 tabs:
  1. **Contacts** — table of PayerContacts with add/edit/delete. Columns: Type, Phone, Email, Fax, Portal URL, Hours, Notes
  2. **Timelines** — table of PayerTimelines. Columns: Process Type, Min Days, Max Days, State Overrides, Notes
  3. **State Rules** — table of PayerStateRules. Columns: State, Rule Type, Description, Effective Date, Expiration
  4. **Forms** — table of PayerForms. Columns: Form Name, Format, URL, Destination, Required, Notes
  5. **Requirements** — table of PayerRequirements. Columns: Name, Override Type, Rule, Applies To, Blocking, Source
- Each tab has an "Add" button that opens a modal with the appropriate form fields
- Inline edit on table cells where practical (click to edit)
- Delete button per row with confirmation
- Toast notification on save/delete success via `react-hot-toast`
- Use `usePayerTrack(id)` for data, child mutation hooks for CRUD
- Follow `PracticeDetail.tsx` Tab.Group pattern

**Step 2: Add route in App.tsx**

Add: `<Route path="admin/knowledge-base/:id" element={<KnowledgeBaseDetail />} />`

With lazy import: `const KnowledgeBaseDetail = lazy(() => import('./features/admin/KnowledgeBaseDetail'));`

**Step 3: Verify frontend compiles**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/frontend/src/features/admin/KnowledgeBaseDetail.tsx packages/frontend/src/App.tsx
git commit -m "feat: add Knowledge Base detail page with tabbed child record editing"
```

---

## Task 6: Knowledge Base New Page + Gaps Page

**Files:**
- Create: `packages/frontend/src/features/admin/KnowledgeBaseNew.tsx`
- Create: `packages/frontend/src/features/admin/KnowledgeBaseGaps.tsx`
- Modify: `packages/frontend/src/App.tsx` (add routes)

**Step 1: Create the New PayerTrack page**

Create `packages/frontend/src/features/admin/KnowledgeBaseNew.tsx`. This is a form page (NOT a modal) for creating a new PayerTrack:

- Back link to `/admin/knowledge-base`
- Form with all PayerTrack fields (use react-hook-form)
- On submit: `useCreatePayerTrack()`, then navigate to `/admin/knowledge-base/{newId}`
- Toast on success
- Validation: payerName, payerType, stateRegion, track, submissionMethod required
- After creating the PayerTrack, user can add children on the detail page

**Step 2: Create the Gaps page**

Create `packages/frontend/src/features/admin/KnowledgeBaseGaps.tsx`:

- Header: "Knowledge Base Gaps" with count badge
- Uses `useKnowledgeBaseGaps()` hook
- Groups gaps by PayerTrack (payerName + track + stateRegion)
- For each group: collapsible section showing list of missing fields
- Each gap row shows: field name, table, and a "Fix" link that navigates to the PayerTrack detail page (`/admin/knowledge-base/{payerTrackId}`)
- Sort groups by gap count descending (most gaps first = highest impact)
- Color coding: red for missing children (contacts, timelines), yellow for missing optional fields
- Empty state when no gaps: "All records are complete!"

**Step 3: Add routes in App.tsx**

Add lazy imports and routes:
- `const KnowledgeBaseNew = lazy(() => import('./features/admin/KnowledgeBaseNew'));`
- `const KnowledgeBaseGaps = lazy(() => import('./features/admin/KnowledgeBaseGaps'));`
- `<Route path="admin/knowledge-base/new" element={<KnowledgeBaseNew />} />` (BEFORE `:id` route)
- `<Route path="admin/knowledge-base/gaps" element={<KnowledgeBaseGaps />} />`

**IMPORTANT:** The `/new` and `/gaps` routes must be ABOVE the `/:id` route in App.tsx to avoid matching `:id` = "new" or "gaps".

**Step 4: Verify frontend compiles**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/frontend/src/features/admin/KnowledgeBaseNew.tsx packages/frontend/src/features/admin/KnowledgeBaseGaps.tsx packages/frontend/src/App.tsx
git commit -m "feat: add Knowledge Base new page and gaps dashboard"
```

---

## Task 7: Workflow Templates Page

List + detail view for workflow templates.

**Files:**
- Create: `packages/frontend/src/features/admin/WorkflowTemplates.tsx`
- Create: `packages/frontend/src/features/admin/WorkflowTemplateDetail.tsx`
- Modify: `packages/frontend/src/App.tsx` (add routes)

**Step 1: Create the list page**

Create `packages/frontend/src/features/admin/WorkflowTemplates.tsx`:

- Header: "Workflow Templates" + "New Template" button
- Filter by status (draft/active/archived tabs)
- Table: Name, Payer Track, Version, Status (badge), Steps count, Enrollments count, Last Updated
- Status badges: draft = gray, active = green, archived = yellow
- Click row → navigate to detail page
- "New Template" opens a modal asking for: PayerTrack (dropdown from `usePayerTracks()`), Name, Description. On create → navigate to detail.

**Step 2: Create the detail page**

Create `packages/frontend/src/features/admin/WorkflowTemplateDetail.tsx`:

- Back link to `/admin/workflow-templates`
- Header: template name, status badge, version number
- Action buttons: Publish (draft→active), Archive (active→archived), Delete (with confirmation)
- Two sections (tabs or stacked):
  1. **Steps** — ordered list of steps. Each step card shows: order number, name, type badge, owner badge, blocking indicator, trigger days, required documents. Add/edit/delete per step. Drag handle for reorder (or up/down arrows that call `useReorderWorkflowSteps`).
  2. **Conditions** — list of conditions. Each shows: type, value, action, target step. Add/delete.
- Step type options (for dropdown): readiness_check, caqh_authorization, populate_template, human_review, submit_application, confirm_submission, follow_up, escalate, await_decision, record_outcome
- Owner options: credentialing_staff, provider, payer

**Step 3: Add routes in App.tsx**

- `const WorkflowTemplates = lazy(() => import('./features/admin/WorkflowTemplates'));`
- `const WorkflowTemplateDetail = lazy(() => import('./features/admin/WorkflowTemplateDetail'));`
- `<Route path="admin/workflow-templates" element={<WorkflowTemplates />} />`
- `<Route path="admin/workflow-templates/:id" element={<WorkflowTemplateDetail />} />`

**Step 4: Verify**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/frontend/src/features/admin/WorkflowTemplates.tsx packages/frontend/src/features/admin/WorkflowTemplateDetail.tsx packages/frontend/src/App.tsx
git commit -m "feat: add Workflow Templates list and detail pages"
```

---

## Task 8: Follow-up Templates Page

List + detail view for follow-up templates.

**Files:**
- Create: `packages/frontend/src/features/admin/FollowupTemplates.tsx`
- Create: `packages/frontend/src/features/admin/FollowupTemplateDetail.tsx`
- Modify: `packages/frontend/src/App.tsx` (add routes)

**Step 1: Create the list page**

Create `packages/frontend/src/features/admin/FollowupTemplates.tsx`:

- Same pattern as WorkflowTemplates list
- Table: Name, Payer Track, Version, Status, Steps count, Runs count, Last Updated
- "New Template" flow same pattern (modal with PayerTrack dropdown + name)

**Step 2: Create the detail page**

Create `packages/frontend/src/features/admin/FollowupTemplateDetail.tsx`:

- Back link, header with status/version, publish/archive/delete buttons
- Steps section: ordered list of follow-up steps. Each step card shows:
  - Order number, name, channel (email/phone_call badge), trigger days after prev, escalation level
  - If email: subject, body template preview, tone
  - If phone_call: script template, Retell agent ID
  - Requires approval checkbox
  - Add/edit/delete/reorder
- Channel options for dropdown: email, phone_call
- Email tone options: professional, urgent, escalated

**Step 3: Add routes in App.tsx**

- `const FollowupTemplates = lazy(() => import('./features/admin/FollowupTemplates'));`
- `const FollowupTemplateDetail = lazy(() => import('./features/admin/FollowupTemplateDetail'));`
- `<Route path="admin/followup-templates" element={<FollowupTemplates />} />`
- `<Route path="admin/followup-templates/:id" element={<FollowupTemplateDetail />} />`

**Step 4: Verify**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/frontend/src/features/admin/FollowupTemplates.tsx packages/frontend/src/features/admin/FollowupTemplateDetail.tsx packages/frontend/src/App.tsx
git commit -m "feat: add Follow-up Templates list and detail pages"
```

---

## Task 9: Sidebar Navigation + Final Wiring

Add the Lanyard Admin nav group to the sidebar, visible only to `lanyard_admin` users.

**Files:**
- Modify: `packages/frontend/src/components/Layout.tsx`

**Step 1: Add Lanyard Admin nav group**

In `packages/frontend/src/components/Layout.tsx`, add a new nav group after the existing `customerNavGroups` array. The key behavior:

- Create a `lanyardAdminNavGroup` object:
  ```typescript
  const lanyardAdminNavGroup: NavGroup = {
    label: 'Lanyard Admin',
    items: [
      { name: 'Knowledge Base', href: '/admin/knowledge-base', icon: BookOpenIcon },
      { name: 'KB Gaps', href: '/admin/knowledge-base/gaps', icon: ExclamationTriangleIcon },
      { name: 'Workflow Templates', href: '/admin/workflow-templates', icon: Cog6ToothIcon },
      { name: 'Follow-up Templates', href: '/admin/followup-templates', icon: EnvelopeIcon },
    ],
  };
  ```
- Import the needed icons from `@heroicons/react/24/outline`: `BookOpenIcon`, `ExclamationTriangleIcon`, `Cog6ToothIcon`, `EnvelopeIcon`
- Conditionally render this group only when `user?.role === 'lanyard_admin'`:
  ```typescript
  const navGroups = user?.role === 'lanyard_admin'
    ? [...customerNavGroups, lanyardAdminNavGroup]
    : customerNavGroups;
  ```
- Use `navGroups` instead of `customerNavGroups` in the sidebar render

**Step 2: Verify the full app compiles**

Run:
```bash
cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit
cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/Layout.tsx
git commit -m "feat: add Lanyard Admin nav group to sidebar for knowledge base and template management"
```

---

## Task 10: Backend Tests + Final Verification

Write tests for the knowledge base routes.

**Files:**
- Create: `packages/backend/src/routes/knowledgeBase.routes.test.ts`

**Step 1: Write route tests**

Create `packages/backend/src/routes/knowledgeBase.routes.test.ts` using the project's testing patterns:
- Use `vi.mock('../utils/prisma.js')` with `prismaMock`
- Use `createTestApp(knowledgeBaseRoutes, lanyardAdminUser)` pattern
- Test at minimum:
  - GET `/payer-tracks` returns list
  - GET `/payer-tracks/:id` returns detail with children
  - GET `/payer-tracks/:id` returns 404 for missing
  - POST `/payer-tracks` creates with valid data
  - POST `/payer-tracks` rejects invalid data (missing required fields)
  - PATCH `/payer-tracks/:id` updates
  - DELETE `/payer-tracks/:id` deletes
  - GET `/gaps` returns gap analysis
  - GET `/filter-options` returns distinct values
  - Authorization: non-lanyard_admin users get 403

**Step 2: Run all tests**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run`

Expected: New tests pass. Pre-existing failures from schema renames are acceptable (known issue from Steps 1-5).

**Step 3: Run full TypeScript check across monorepo**

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit
cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add packages/backend/src/routes/knowledgeBase.routes.test.ts
git commit -m "test: add knowledge base route tests"
```

---

## Task 11: Push + Update PR

**Step 1: Push to remote**

```bash
cd /Users/kay/Documents/KAY
git push origin feat/schema-redesign-v2
```

This updates the existing PR #152.

**Step 2: Update project memory**

Update `/Users/kay/.claude/projects/-Users-kay/memory/project_schema_redesign.md`:
- Mark Step 8 as Done
- Set Step 9 as Next

---

## Key Implementation Notes

### API endpoint structure
- Knowledge Base: `/api/v1/knowledge-base/payer-tracks`, `/api/v1/knowledge-base/gaps`, `/api/v1/knowledge-base/filter-options`, `/api/v1/knowledge-base/requirements-universal`
- Child resources: `/api/v1/knowledge-base/payer-tracks/:trackId/contacts` (create), `/api/v1/knowledge-base/contacts/:id` (update/delete)
- Workflow Templates: `/api/v1/workflow-templates`
- Follow-up Templates: `/api/v1/followup-templates`

### Auth pattern
All admin routes use `authorize('lanyard_admin')` — only the platform super-admin can access these. Dev testing: set `X-Dev-Role: lanyard_admin` header or use `localStorage.setItem('dev_session', 'lanyard_admin')` in browser.

### Embedding auto-trigger
Every create/update on KB records calls `triggerEmbedding()` which is fire-and-forget. If OPENAI_API_KEY is not set, it silently skips. The user has not added the key yet — embeddings will remain pending until they do.

### Frontend ApiClient
Uses `api.get()`, `api.post()`, `api.patch()`, `api.delete()` from `packages/frontend/src/services/api.ts`. Response shape: `{ data: { success: true, data: T } }` (note: `data.data` because axios/fetch wraps the response).

### Existing patterns to match
- **List pages**: `PracticesList.tsx` — PageTransition, table, empty state, skeleton loading
- **Detail pages**: `PracticeDetail.tsx` — Tab.Group from headlessui, back link, action buttons
- **Hooks**: `usePractices.ts` — useQuery/useMutation with queryKey invalidation
- **Icons**: `@heroicons/react/24/outline` for all icons
- **Styling**: Tailwind utility classes, `btn-primary`, `card`, `badge-*` patterns
