import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import {
  listPendingApprovals,
  getApproval,
  decideApproval,
} from '../agents/approval.service.js';

// ==========================================
// Zod Schemas
// ==========================================

const listApprovalsSchema = z.object({
  status: z.string().optional(),
  workflowId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  notes: z.string().max(1000).optional(),
});

// ==========================================
// Router
// ==========================================

export const approvalRoutes = Router();

const auth = [
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
];

// GET /approvals — list approvals with optional filters
approvalRoutes.get(
  '/',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = listApprovalsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const query: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (value !== undefined) query[key] = value;
      }

      const approvals = await listPendingApprovals(query as any);
      res.status(200).json(approvals);
    } catch (err) {
      next(err);
    }
  }
);

// GET /approvals/:id — get a single approval
approvalRoutes.get(
  '/:id',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const approval = await getApproval(req.params['id']!);
      if (!approval) {
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
approvalRoutes.post(
  '/:id/decide',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = decideApprovalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const result = await decideApproval(req.params['id']!, {
        decision: parsed.data.decision,
        decidedBy: req.user!.id,
        notes: parsed.data.notes,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
