import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { prisma } from '../utils/prisma.js';
import {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  getWorkflowEvents,
  cancelWorkflow,
  dispatchPortalSubmission,
  dispatchDocumentParsing,
} from '../agents/coordinator.service.js';
import type { ListWorkflowsFilters } from '../agents/coordinator.service.js';

// ==========================================
// Zod Schemas
// ==========================================

const createWorkflowSchema = z.object({
  goal: z.string().min(1).max(200),
  providerId: z.string().uuid(),
  payerId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

const listWorkflowsSchema = z.object({
  status: z.string().optional(),
  providerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const portalSubmissionSchema = z.object({
  providerId: z.string().uuid(),
  payerId: z.string().uuid(),
  enrollmentId: z.string().uuid().optional(),
  action: z.enum(['submit_to_portal', 'check_readiness']).optional(),
});

const parseDocumentSchema = z.object({
  documentId: z.string().uuid(),
  providerId: z.string().uuid(),
  extractionHints: z.array(z.string()).optional(),
});

const patchWorkflowSchema = z.object({
  action: z.enum(['cancel']),
  reason: z.string().max(500).optional(),
});

// ==========================================
// Router
// ==========================================

export const agentRoutes = Router();

/** Build a Prisma where-clause that restricts workflows to the caller's practice(s). */
function practiceFilter(req: Request) {
  if (req.practiceScope?.isSuperAdmin) return {};
  return {
    provider: {
      practiceId: { in: req.practiceScope?.practiceIds ?? [] },
    },
  };
}

const auth = [
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
];

// POST /workflows — create a new agent workflow
agentRoutes.post(
  '/workflows',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createWorkflowSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      // Verify provider belongs to caller's practice (multi-tenancy check)
      if (!req.practiceScope?.isSuperAdmin) {
        const provider = await prisma.provider.findFirst({
          where: {
            id: parsed.data.providerId,
            practiceId: { in: req.practiceScope?.practiceIds ?? [] },
          },
          select: { id: true },
        });
        if (!provider) {
          throw new ForbiddenError('Provider not found in your practice');
        }
      }

      const workflow = await createWorkflow({
        ...parsed.data,
        requestedBy: req.user!.id,
      });

      res.status(201).json(workflow);
    } catch (err) {
      next(err);
    }
  }
);

// GET /workflows — list workflows with optional filters
agentRoutes.get(
  '/workflows',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = listWorkflowsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      // Strip undefined keys so the service only receives provided filters
      const query: ListWorkflowsFilters = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (value !== undefined) (query as Record<string, unknown>)[key] = value;
      }

      const workflows = await listWorkflows(query, practiceFilter(req));
      res.status(200).json(workflows);
    } catch (err) {
      next(err);
    }
  }
);

// GET /workflows/:id — get a single workflow
agentRoutes.get(
  '/workflows/:id',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workflow = await getWorkflow(req.params['id']!);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      // Practice-scope check
      if (!req.practiceScope?.isSuperAdmin) {
        const provider = await prisma.provider.findFirst({
          where: {
            id: workflow.providerId,
            practiceId: { in: req.practiceScope?.practiceIds ?? [] },
          },
          select: { id: true },
        });
        if (!provider) {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }
      }
      res.status(200).json(workflow);
    } catch (err) {
      next(err);
    }
  }
);

// GET /workflows/:id/events — get events for a workflow
agentRoutes.get(
  '/workflows/:id/events',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Practice-scope: verify caller owns this workflow's provider
      if (!req.practiceScope?.isSuperAdmin) {
        const wf = await prisma.agentWorkflow.findUnique({
          where: { id: req.params['id']! },
          select: { providerId: true },
        });
        if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
        const p = await prisma.provider.findFirst({
          where: { id: wf.providerId, practiceId: { in: req.practiceScope?.practiceIds ?? [] } },
          select: { id: true },
        });
        if (!p) { res.status(404).json({ error: 'Workflow not found' }); return; }
      }
      const events = await getWorkflowEvents(req.params['id']!);
      res.status(200).json(events);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /workflows/:id — perform an action on a workflow
agentRoutes.patch(
  '/workflows/:id',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = patchWorkflowSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { action, reason } = parsed.data;

      // Practice-scope: verify caller owns this workflow's provider
      if (!req.practiceScope?.isSuperAdmin) {
        const wf = await prisma.agentWorkflow.findUnique({
          where: { id: req.params['id']! },
          select: { providerId: true },
        });
        if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
        const p = await prisma.provider.findFirst({
          where: { id: wf.providerId, practiceId: { in: req.practiceScope?.practiceIds ?? [] } },
          select: { id: true },
        });
        if (!p) { res.status(404).json({ error: 'Workflow not found' }); return; }
      }

      if (action === 'cancel') {
        const workflow = await cancelWorkflow(req.params['id']!, reason ?? 'Cancelled by user');
        res.status(200).json(workflow);
        return;
      }

      res.status(400).json({ error: 'Unknown action. Supported: cancel' });
    } catch (err) {
      next(err);
    }
  }
);

// POST /workflows/:id/submit-to-portal — dispatch portal submission
agentRoutes.post(
  '/workflows/:id/submit-to-portal',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = portalSubmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const task = await dispatchPortalSubmission({
        workflowId: req.params['id']!,
        providerId: parsed.data.providerId,
        payerId: parsed.data.payerId,
        enrollmentId: parsed.data.enrollmentId,
        action: parsed.data.action,
      });

      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }
);

// POST /workflows/:id/parse-document — dispatch document parsing
agentRoutes.post(
  '/workflows/:id/parse-document',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const task = await dispatchDocumentParsing({
        workflowId: req.params['id']!,
        documentId: parsed.data.documentId,
        providerId: parsed.data.providerId,
        extractionHints: parsed.data.extractionHints,
      });

      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }
);
