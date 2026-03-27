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
import { initiateCall, isRetellEnabled } from '../services/retell.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// GET /workflow-approvals — list approvals for the workflow queue
router.get(
  '/',
  authenticate,
  authorize('admin', 'credentialing_staff', 'practice_admin', 'lanyard_admin'),
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
  authorize('admin', 'credentialing_staff', 'practice_admin', 'lanyard_admin'),
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

      // Trigger Retell call when a phone_call follow-up step is approved
      if (validated.decision === 'approved') {
        triggerRetellIfPhoneCall(prisma, id!).catch((err) =>
          logger.error(`Retell trigger failed for approval ${id}:`, err)
        );
      }

      res.json({ success: true, data: { status: result.status } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: { message: 'Validation failed', details: error.errors },
        });
      }
      next(error);
    }
  }
);

// ─── Retell Trigger Helper ─────────────────────────────

/**
 * After a follow-up approval is approved, check if the step is a phone_call
 * and initiate a Retell AI call. Fire-and-forget (non-blocking).
 */
async function triggerRetellIfPhoneCall(
  db: import('@prisma/client').PrismaClient,
  approvalId: string
): Promise<void> {
  if (!isRetellEnabled()) return;

  const approval = await db.pendingApproval.findUnique({
    where: { id: approvalId },
    include: {
      followUpRun: {
        include: {
          template: {
            include: { steps: true },
          },
          enrollment: {
            include: {
              payer: true,
              payerTrack: { include: { contacts: true } },
            },
          },
        },
      },
    },
  });

  if (!approval?.followUpRunId || !approval.followUpRun) return;

  const run = approval.followUpRun;
  const stepOrder = approval.followUpStepOrder ?? run.currentStepOrder;

  // Find the template step for this approval
  const templateStep = run.template.steps.find(
    (s) => s.stepOrder === stepOrder
  );

  if (!templateStep || templateStep.channel !== 'phone_call') return;

  const agentId = templateStep.retellAgentId;
  if (!agentId) {
    logger.warn(`No retellAgentId configured for template step ${templateStep.id}`);
    return;
  }

  // Find the payer contact phone number
  const contacts = run.enrollment.payerTrack?.contacts || [];
  const contact = contacts.find((c) => c.phone) || contacts[0];
  const phoneNumber = contact?.phone;

  if (!phoneNumber) {
    logger.warn(`No phone number found for follow-up run ${run.id} — cannot initiate Retell call`);
    return;
  }

  const result = await initiateCall(db, {
    followUpRunId: run.id,
    agentId,
    phoneNumber,
    payerContactId: contact?.id,
    metadata: {
      enrollment_id: run.enrollmentId,
      payer_name: run.enrollment.payer?.name || '',
      step_name: templateStep.name,
    },
  });

  if (result.success) {
    logger.info(`Retell call ${result.callId} initiated for approval ${approvalId}`);
  } else {
    logger.error(`Retell call failed for approval ${approvalId}: ${result.error}`);
  }
}

export { router as workflowApprovalRoutes };
