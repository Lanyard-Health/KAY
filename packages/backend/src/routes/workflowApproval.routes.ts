/**
 * Workflow Approval Routes
 *
 * API endpoints for the /workflow-queue UI (Step 12).
 * Lists and resolves PendingApproval records for workflow steps
 * and follow-up outreach.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import {
  listWorkflowApprovals,
  resolveApproval,
} from '../services/workflow-approval.service.js';

const router = Router();

// GET /workflow-approvals — list approvals for the workflow queue
router.get(
  '/',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query['status'] as string | undefined;
      const type = req.query['type'] as string | undefined;

      const approvals = await listWorkflowApprovals(prisma, {
        status: status as any,
        type,
      });

      res.json({ success: true, data: approvals });
    } catch (error) {
      next(error);
    }
  }
);

// POST /workflow-approvals/:id/decide — approve or deny
const decideSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  decisionNotes: z.string().optional(),
});

router.post(
  '/:id/decide',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const validated = decideSchema.parse(req.body);

      const result = await resolveApproval(
        prisma,
        id!,
        validated.decision,
        req.user!.id,
        validated.decisionNotes
      );

      if (!result.resolved) {
        return res.status(400).json({
          success: false,
          error: { message: result.error || 'Could not resolve approval' },
        });
      }

      res.json({
        success: true,
        data: { status: result.status, sideEffect: result.sideEffect },
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as workflowApprovalRoutes };
