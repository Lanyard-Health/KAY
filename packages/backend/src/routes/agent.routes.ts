import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  getWorkflowEvents,
  cancelWorkflow,
  dispatchPortalSubmission,
} from '../agents/coordinator.service.js';

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

const patchWorkflowSchema = z.object({
  action: z.string(),
  reason: z.string().optional(),
});

// ==========================================
// Router
// ==========================================

export const agentRoutes = Router();

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
      const query: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (value !== undefined) query[key] = value;
      }

      const workflows = await listWorkflows(query as any);
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
