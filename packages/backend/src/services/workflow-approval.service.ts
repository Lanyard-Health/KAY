/**
 * Workflow Approval Service
 *
 * Creates and resolves PendingApproval records for:
 * 1. EnrollmentWorkflowStep completions that require human review
 * 2. FollowUpRun outreach steps that require approval before sending
 */

import { PrismaClient, ApprovalStatus } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { initiateCall, isRetellEnabled } from './retell.service.js';

// ─── Types ─────────────────────────────────────────────────

interface ApprovalContext {
  providerName?: string;
  payerName?: string;
  enrollmentId?: string;
  stepName?: string;
  stepType?: string;
  channel?: string;
  [key: string]: unknown;
}

interface CreateApprovalResult {
  created: boolean;
  approvalId: string | null;
  alreadyExists: boolean;
}

interface ResolveApprovalResult {
  resolved: boolean;
  status: ApprovalStatus;
  error?: string;
}

// ─── Create Approval Gates ─────────────────────────────────

/**
 * Create a PendingApproval for an EnrollmentWorkflowStep.
 * Called when a workflow step is reached that has requiresApproval
 * (mapped from isBlocking on the template step).
 *
 * Prevents duplicates: if a pending approval already exists for this step, skips.
 */
export async function createStepApproval(
  prisma: PrismaClient,
  enrollmentWorkflowStepId: string,
  context: ApprovalContext = {}
): Promise<CreateApprovalResult> {
  // Check for existing pending approval
  const existing = await prisma.pendingApproval.findFirst({
    where: {
      enrollmentWorkflowStepId,
      status: 'pending',
    },
  });

  if (existing) {
    logger.info(`Pending approval already exists for workflow step ${enrollmentWorkflowStepId}`);
    return { created: false, approvalId: existing.id, alreadyExists: true };
  }

  const approval = await prisma.pendingApproval.create({
    data: {
      enrollmentWorkflowStepId,
      type: 'workflow_step',
      status: 'pending',
      context: context as any,
    },
  });

  logger.info(`Created workflow step approval ${approval.id} for step ${enrollmentWorkflowStepId}`);
  return { created: true, approvalId: approval.id, alreadyExists: false };
}

/**
 * Create a PendingApproval for a FollowUpRun outreach step.
 * Called when the follow-up scheduler reaches a step with requiresApproval=true.
 *
 * Prevents duplicates: if a pending approval already exists for this run+step, skips.
 */
export async function createFollowUpApproval(
  prisma: PrismaClient,
  followUpRunId: string,
  followUpStepOrder: number,
  context: ApprovalContext = {}
): Promise<CreateApprovalResult> {
  // Check for existing pending approval
  const existing = await prisma.pendingApproval.findFirst({
    where: {
      followUpRunId,
      followUpStepOrder,
      status: 'pending',
    },
  });

  if (existing) {
    logger.info(`Pending approval already exists for follow-up run ${followUpRunId} step ${followUpStepOrder}`);
    return { created: false, approvalId: existing.id, alreadyExists: true };
  }

  const approval = await prisma.pendingApproval.create({
    data: {
      followUpRunId,
      followUpStepOrder,
      type: 'follow_up_outreach',
      status: 'pending',
      context: context as any,
    },
  });

  logger.info(`Created follow-up approval ${approval.id} for run ${followUpRunId} step ${followUpStepOrder}`);
  return { created: true, approvalId: approval.id, alreadyExists: false };
}

// ─── Resolve Approvals ─────────────────────────────────────

/**
 * Approve or deny a PendingApproval.
 * Only pending approvals can be resolved.
 */
export async function resolveApproval(
  prisma: PrismaClient,
  approvalId: string,
  decision: 'approved' | 'denied',
  decidedBy: string,
  decisionNotes?: string
): Promise<ResolveApprovalResult> {
  const approval = await prisma.pendingApproval.findUnique({
    where: { id: approvalId },
  });

  if (!approval) {
    return { resolved: false, status: 'pending' as ApprovalStatus, error: 'Approval not found' };
  }

  if (approval.status !== 'pending') {
    return { resolved: false, status: approval.status, error: `Approval already ${approval.status}` };
  }

  if (approval.expiresAt && approval.expiresAt < new Date()) {
    return { resolved: false, status: 'pending' as ApprovalStatus, error: 'Approval has expired' };
  }

  const updated = await prisma.pendingApproval.update({
    where: { id: approvalId },
    data: {
      status: decision,
      decidedBy,
      decidedAt: new Date(),
      decisionNotes: decisionNotes || null,
    },
  });

  logger.info(`Approval ${approvalId} ${decision} by ${decidedBy} (type: ${updated.type})`);

  // Trigger Retell call when a phone_call follow-up step is approved
  if (decision === 'approved') {
    triggerRetellIfPhoneCall(prisma, approvalId).catch((err) =>
      logger.error(`Retell trigger failed for approval ${approvalId}:`, err)
    );
  }

  return { resolved: true, status: updated.status };
}

// ─── Query Approvals ───────────────────────────────────────

/**
 * List pending approvals for the workflow queue UI.
 * Returns workflow step and follow-up outreach approvals with context.
 */
export async function listWorkflowApprovals(
  prisma: PrismaClient,
  filters: {
    status?: ApprovalStatus;
    type?: string;
  } = {}
) {
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;

  // Only return workflow step and follow-up approvals, not agent approvals
  where.OR = [
    { enrollmentWorkflowStepId: { not: null } },
    { followUpRunId: { not: null } },
  ];

  return prisma.pendingApproval.findMany({
    where,
    include: {
      enrollmentWorkflowStep: {
        include: {
          enrollment: {
            include: {
              provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
              payer: { select: { id: true, name: true } },
            },
          },
        },
      },
      followUpRun: {
        include: {
          enrollment: {
            include: {
              provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
              payer: { select: { id: true, name: true } },
            },
          },
          template: { select: { id: true, name: true } },
        },
      },
      decider: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { requestedAt: 'desc' },
  });
}

// ─── Retell Trigger Helper ─────────────────────────────

/**
 * After a follow-up approval is approved, check if the step is a phone_call
 * and initiate a Retell AI call. Fire-and-forget (non-blocking).
 */
export async function triggerRetellIfPhoneCall(
  db: PrismaClient,
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
