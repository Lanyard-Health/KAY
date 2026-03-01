import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';
import { logAgentEvent } from '../event-logger.js';
import { emitApprovalRequest } from '../websocket.js';
import type {
  PayerAdapter,
  SubmissionInput,
  ReadinessCheck,
  PayerAdapterResult,
} from './payer-adapter.js';

export class ManualSubmissionAdapter implements PayerAdapter {
  readonly adapterType = 'manual_submission';

  async checkReadiness(_input: SubmissionInput): Promise<ReadinessCheck> {
    return {
      ready: true,
      missingFields: [],
      warnings: ['Manual submission — requires human handoff to complete'],
    };
  }

  async submit(input: SubmissionInput): Promise<PayerAdapterResult> {
    // Gather provider credentials for the manifest
    const provider = await prisma.provider.findUnique({
      where: { id: input.providerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        npi: true,
        licenses: { select: { licenseType: true, licenseNumber: true, state: true, expirationDate: true } },
        boardCertifications: { select: { boardType: true, boardName: true, specialty: true, expirationDate: true } },
        malpracticeInsurances: { select: { carrierName: true, policyNumber: true, expirationDate: true } },
      },
    });

    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    const manifest = {
      provider: {
        name: `${provider.firstName} ${provider.lastName}`,
        npi: provider.npi,
      },
      credentials: {
        licenses: provider.licenses,
        certifications: provider.boardCertifications,
        malpracticeInsurance: provider.malpracticeInsurances,
      },
      submissionInstructions: (input.config as Record<string, unknown>)?.['instructions'] ?? 'Submit credentials to payer portal manually',
    };

    // Create a PendingApproval for human handoff
    const approval = await prisma.pendingApproval.create({
      data: {
        workflowId: input.workflowId,
        taskId: input.taskId,
        type: 'manual_submission',
        status: 'pending',
        context: manifest as any,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Pause workflow to waiting_approval
    await prisma.agentWorkflow.update({
      where: { id: input.workflowId },
      data: { status: 'waiting_approval' },
    });

    // Log event
    await logAgentEvent({
      workflowId: input.workflowId,
      taskId: input.taskId,
      agent: 'portal_adapter',
      action: 'manual_submission_approval_requested',
      data: { approvalId: approval.id, type: 'manual_submission' },
    });

    // Emit WebSocket notification
    emitApprovalRequest({
      approvalId: approval.id,
      workflowId: input.workflowId,
      taskId: input.taskId,
      type: 'manual_submission',
      context: { provider: manifest.provider },
    });

    // Enqueue approval expiry check job
    const approvalQueue = getQueue(QUEUE_NAMES.APPROVAL);
    await approvalQueue.add('process_approval', {
      approvalId: approval.id,
      workflowId: input.workflowId,
      taskId: input.taskId,
      type: 'manual_submission',
      expiresAt: approval.expiresAt.toISOString(),
    }, { jobId: `expiry-${approval.id}` });

    logger.info('Manual submission approval created', {
      approvalId: approval.id,
      workflowId: input.workflowId,
      providerId: input.providerId,
    });

    return {
      success: true,
      submissionId: approval.id,
      details: { manifest, approvalId: approval.id },
    };
  }
}
