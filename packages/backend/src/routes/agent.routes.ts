import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ForbiddenError } from '../middleware/error.middleware.js';
import { prisma } from '../utils/prisma.js';
import { isRedisConfigured } from '../utils/redis.js';
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
import {
  listPendingApprovals,
  getApproval,
  decideApproval,
} from '../agents/approval.service.js';

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

const n = <T extends z.ZodTypeAny>(s: T) => z.union([s, z.null()]).optional().transform((v: z.input<T> | null | undefined) => v === null ? undefined : v);
const patchWorkflowSchema = z.object({
  action: z.enum(['cancel']),
  reason: n(z.string().max(500)),
});

const listApprovalsSchema = z.object({
  status: z.enum(['pending', 'approved', 'denied']).optional(),
  workflowId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  notes: z.string().max(1000).optional(),
});

const bulkDecideSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  decision: z.enum(['approved', 'denied']),
  notes: z.string().max(1000).optional(),
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
        const provider = await prisma.providerProfile.findFirst({
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

      if (!isRedisConfigured()) {
        res.status(503).json({
          error: 'Agent system is not available — background job processing is not configured.',
        });
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
        const provider = await prisma.providerProfile.findFirst({
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
        const p = await prisma.providerProfile.findFirst({
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
        const p = await prisma.providerProfile.findFirst({
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

      if (!isRedisConfigured()) {
        res.status(503).json({
          error: 'Agent system is not available — background job processing is not configured.',
        });
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

      if (!isRedisConfigured()) {
        res.status(503).json({
          error: 'Agent system is not available — background job processing is not configured.',
        });
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

// ==========================================
// Approval routes
// ==========================================

const approvalIdSchema = z.object({ id: z.string().uuid() });

/** Check whether the caller's practice(s) own the approval's workflow provider. */
async function verifyApprovalAccess(req: Request, approvalId: string): Promise<boolean> {
  if (req.practiceScope?.isSuperAdmin) return true;
  const approval = await prisma.pendingApproval.findUnique({
    where: { id: approvalId },
    select: { workflow: { select: { providerId: true } } },
  });
  if (!approval) return false;
  if (!approval.workflow) return false;
  const provider = await prisma.providerProfile.findFirst({
    where: {
      id: approval.workflow.providerId,
      practiceId: { in: req.practiceScope?.practiceIds ?? [] },
    },
    select: { id: true },
  });
  return !!provider;
}

// GET /approvals — list approvals (practice-scoped)
agentRoutes.get(
  '/approvals',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = listApprovalsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      // Apply practice-scope filter
      const filters = { ...parsed.data };
      const approvals = await listPendingApprovals(filters, practiceFilter(req));
      res.status(200).json(approvals);
    } catch (err) {
      next(err);
    }
  }
);

// POST /approvals/bulk-decide — approve or deny multiple approvals
agentRoutes.post(
  '/approvals/bulk-decide',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = bulkDecideSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { ids, decision, notes } = parsed.data;
      const succeeded: string[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const id of ids) {
        try {
          const hasAccess = await verifyApprovalAccess(req, id);
          if (!hasAccess) {
            failed.push({ id, error: 'Not found or access denied' });
            continue;
          }

          await decideApproval(id, {
            decision,
            decidedBy: req.user!.id,
            notes,
          });
          succeeded.push(id);
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : String(err) });
        }
      }

      res.status(200).json({ succeeded, failed });
    } catch (err) {
      next(err);
    }
  }
);

// GET /approvals/:id — get single approval
agentRoutes.get(
  '/approvals/:id',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paramParsed = approvalIdSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: 'Invalid approval ID' });
        return;
      }
      const { id } = paramParsed.data;

      const approval = await getApproval(id);
      if (!approval) {
        res.status(404).json({ error: 'Approval not found' });
        return;
      }

      // Practice-scope check
      if (!(await verifyApprovalAccess(req, id))) {
        res.status(404).json({ error: 'Approval not found' });
        return;
      }

      res.status(200).json(approval);
    } catch (err) {
      next(err);
    }
  }
);

// POST /approvals/:id/decide — approve or deny
agentRoutes.post(
  '/approvals/:id/decide',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paramParsed = approvalIdSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: 'Invalid approval ID' });
        return;
      }
      const { id } = paramParsed.data;

      const parsed = decideApprovalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      // Practice-scope check
      if (!(await verifyApprovalAccess(req, id))) {
        res.status(404).json({ error: 'Approval not found' });
        return;
      }

      const approval = await decideApproval(id, {
        decision: parsed.data.decision,
        decidedBy: req.user!.id,
        notes: parsed.data.notes,
      });

      res.status(200).json(approval);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Approval not found') {
          res.status(404).json({ error: err.message });
          return;
        }
        if (err.message.startsWith('Approval has already been decided')) {
          res.status(409).json({ error: err.message });
          return;
        }
        if (err.message.startsWith('Approval has expired')) {
          res.status(410).json({ error: err.message });
          return;
        }
      }
      next(err);
    }
  }
);
