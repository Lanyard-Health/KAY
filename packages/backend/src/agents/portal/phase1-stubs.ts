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
 * Phase 1 adapter stubs. These implement the new SubmissionPortalAdapter
 * contract so the AdapterFactory, BullMQ worker, and credential service can
 * be wired end-to-end without the real portal-automation code being ready.
 *
 * - CaqhSubmissionAdapterStub: returns NOT_IMPLEMENTED. The legacy
 *   caqh-adapter.ts is still used by the older portal-agent pipeline. The
 *   real CAQH-on-PlaywrightBase adapter ships in Phase 3.
 *
 * - ManualSubmissionAdapterStub: creates a PendingApproval row so a human
 *   coordinator can finish the submission. This is the real path — manual
 *   submissions don't need a Playwright run.
 */

export class CaqhSubmissionAdapterStub implements SubmissionPortalAdapter {
  readonly adapterType: AdapterType = 'CAQH';

  async submit(
    input: SubmissionAdapterInput,
    _credential: ResolvedCredential
  ): Promise<SubmissionResult> {
    logger.warn('CAQH submission adapter not yet wired into new pipeline (Phase 3)', {
      enrollmentRunId: input.enrollmentRunId,
      payerId: input.payerId,
    });
    return {
      success: false,
      errorCode: 'NOT_IMPLEMENTED_YET',
      errorMessage:
        'CAQH adapter rebuild on PlaywrightBaseAdapter is scheduled for Phase 3. ' +
        'Submissions through the new pipeline are not yet routed here — the ' +
        'legacy CAQH service still handles roster operations via nightly sync.',
    };
  }
}

export class ManualSubmissionAdapterStub implements SubmissionPortalAdapter {
  readonly adapterType: AdapterType = 'MANUAL';

  async submit(
    input: SubmissionAdapterInput,
    _credential: ResolvedCredential
  ): Promise<SubmissionResult> {
    // Manual adapters never receive useful credentials (no portal login is
    // attempted). We accept the parameter for interface compatibility.
    const approval = await prisma.pendingApproval.create({
      data: {
        workflowId: input.enrollmentRunId, // run id doubles as workflow reference for manual fallbacks
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
