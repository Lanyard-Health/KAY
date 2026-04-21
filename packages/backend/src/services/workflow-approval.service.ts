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
import { emailService } from './email.service.js';
import { notificationService } from './notification.service.js';
import { advanceStep } from './followUpExecutor.service.js';

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
  /** Result of any side-effect triggered by an approved follow-up step. */
  sideEffect?: {
    type: 'email_sent' | 'email_failed' | 'email_skipped' | 'phone_call_queued' | 'phone_call_unsupported' | 'none';
    detail?: string;
    messageId?: string;
    transport?: string;
  };
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

  // Advance follow-up run step after any decision (approved or denied).
  // We await this so the API response can surface the email send outcome
  // to the UI toast; SMTP sends are fast enough (< a few seconds) that
  // it's acceptable.
  let sideEffect: ResolveApprovalResult['sideEffect'] = { type: 'none' };
  if (updated.followUpRunId) {
    try {
      sideEffect = await advanceFollowUpAfterDecision(prisma, updated, decision);
    } catch (err) {
      logger.error(`Follow-up advancement failed for approval ${approvalId}:`, err);
      sideEffect = {
        type: 'email_failed',
        detail: err instanceof Error ? err.message : 'Advancement failed',
      };
    }
  }

  return { resolved: true, status: updated.status, sideEffect };
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

// ─── Follow-Up Step Advancement ───────────────────────────

/**
 * After a follow-up approval is decided (approved or denied),
 * send the email if it's an approved email step, then advance
 * the run to the next step regardless of decision.
 */
async function advanceFollowUpAfterDecision(
  db: PrismaClient,
  approval: { followUpRunId: string | null; followUpStepOrder: number | null; context: any },
  decision: 'approved' | 'denied'
): Promise<ResolveApprovalResult['sideEffect']> {
  if (!approval.followUpRunId) return { type: 'none' };

  const run = await db.followUpRun.findUnique({
    where: { id: approval.followUpRunId },
    include: {
      template: { include: { steps: true } },
      enrollment: {
        include: {
          provider: true,
          payer: true,
        },
      },
    },
  });

  if (!run) return { type: 'none' };

  const context = (approval.context || {}) as Record<string, any>;
  const providerName = context['providerName'] || `${run.enrollment.provider.firstName} ${run.enrollment.provider.lastName}`;
  const payerName = context['payerName'] || run.enrollment.payer.name;
  const channel = context['channel'] || 'unknown';

  let sideEffect: ResolveApprovalResult['sideEffect'] = { type: 'none' };

  // If approved, send on the appropriate channel.
  if (decision === 'approved') {
    if (channel === 'email') {
      // Accept a few common context-key spellings so seed scripts + the
      // executor stay interop without a rigid contract.
      const recipientEmail =
        context['toAddress'] ||
        context['emailRecipient'] ||
        context['to'] ||
        run.enrollment.followUpEmail;
      const subject = context['emailSubject'] || context['subject'];
      const bodyRaw = context['emailBody'] || context['body'];

      if (!recipientEmail || !subject) {
        sideEffect = {
          type: 'email_skipped',
          detail: 'Missing recipient or subject in approval context',
        };
      } else {
        const html = bodyRaw
          ? `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; white-space: pre-line;">${bodyRaw}</div>`
          : '';
        const sendResult = await emailService.sendEmail({
          to: recipientEmail,
          subject,
          html,
          notificationType: 'enrollment_follow_up',
        });
        if (sendResult.success) {
          sideEffect = {
            type: 'email_sent',
            detail: `Sent to ${recipientEmail}`,
            messageId: sendResult.messageId,
            transport: sendResult.transport,
          };
        } else {
          sideEffect = {
            type: 'email_failed',
            detail: sendResult.error,
            transport: sendResult.transport,
          };
          logger.error(`[FollowUpAdvance] Email send failed for run ${run.id}: ${sendResult.error}`);
          // Still advance — the human approved, don't block the sequence
        }
      }
    } else if (channel === 'phone_call') {
      // Retell call is triggered separately by triggerRetellIfPhoneCall.
      // Just mark it so the UI can reflect state.
      sideEffect = { type: 'phone_call_queued', detail: 'Phone call queued via Retell (if configured)' };
    }
  }

  // Advance step (always, whether approved or denied)
  const totalSteps = run.template.steps.length;
  const { completed } = await advanceStep(db, run.id, totalSteps);

  // Notify admins
  const statusLabel = completed ? `${decision} (run completed)` : decision;
  await notificationService.notifyAdminUsers({
    type: 'system_announcement',
    title: `Follow-Up ${decision === 'approved' ? 'Approved' : 'Denied'}`,
    message: `Follow-up ${statusLabel}: ${channel} to ${payerName} for ${providerName}`,
    actionUrl: `/enrollments/${run.enrollmentId}`,
  });

  logger.info(`[FollowUpAdvance] Run ${run.id}: step ${approval.followUpStepOrder} ${decision}, advanced to ${run.currentStepOrder + 1}${completed ? ' (completed)' : ''}`);
  return sideEffect;
}
