import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { approvalExpiryFromNow } from '../approval-policy.js';
import type {
  SubmissionPortalAdapter,
  SubmissionAdapterInput,
  SubmissionResult,
} from './submission-adapter.js';
import type { AdapterType } from '@prisma/client';
import type { ResolvedCredential } from '../../services/credential.service.js';

/**
 * Manual submission adapter — the real path for payers without a portal
 * integration. Creates a PendingApproval row so a human coordinator can finish
 * the submission via the payer's manual channel (email, fax, postal mail).
 *
 * No portal login is attempted; the credential parameter is accepted for
 * interface compatibility only.
 */
export class ManualSubmissionAdapter implements SubmissionPortalAdapter {
  readonly adapterType: AdapterType = 'MANUAL';

  async submit(
    input: SubmissionAdapterInput,
    _credential: ResolvedCredential
  ): Promise<SubmissionResult> {
    const approval = await prisma.pendingApproval.create({
      data: {
        workflowId: input.enrollmentRunId,
        taskId: input.enrollmentRunId,
        type: 'manual_submission',
        status: 'pending',
        context: {
          enrollmentRunId: input.enrollmentRunId,
          payerId: input.payerId,
          practiceId: input.practiceId,
          providerId: input.providerId,
          note: 'Coordinator must complete submission via payer-specific channel.',
        } as never,
        expiresAt: approvalExpiryFromNow(),
      },
    });

    logger.info('Manual submission approval created (new pipeline)', {
      approvalId: approval.id,
      enrollmentRunId: input.enrollmentRunId,
    });

    return {
      success: true,
      externalReference: approval.id,
      rawResponseText: 'Manual submission queued — awaiting coordinator action.',
    };
  }
}
