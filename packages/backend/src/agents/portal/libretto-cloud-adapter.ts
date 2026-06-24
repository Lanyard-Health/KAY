import type { AdapterType } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import type { ResolvedCredential } from '../../services/credential.service.js';
import {
  type SubmissionPortalAdapter,
  type SubmissionAdapterInput,
  type SubmissionResult,
} from './submission-adapter.js';
import { isAetnaRfpData } from './aetna-rfp-adapter.js';
import { aetnaPacketToLibrettoParams } from './libretto-aetna-mapper.js';
import { runJob, LibrettoCloudError } from '../../services/libretto-cloud.client.js';

/**
 * LibrettoCloudAetnaAdapter — runs the Aetna RFP submission on Libretto Cloud
 * instead of an in-process Playwright browser. It is a drop-in for the
 * `AETNA_RFP` slot: it consumes the SAME `AetnaRfpProviderData` packet the
 * worker already builds (submission.worker.ts), reshapes it with the existing
 * mapper, and dispatches the deployed `aetnaRfpBehavioralHealth` workflow via
 * the Libretto job API. No browser runs in our process.
 *
 * Why it claims adapterType = 'AETNA_RFP': routing is keyed by the payer's
 * submissionConfig.adapterType, which stays 'AETNA_RFP'. adapter-factory swaps
 * THIS adapter into that slot when LIBRETTO_AETNA_RFP_ENABLED === 'true', so no
 * enum / schema / payer-config change is needed and the switch reverses by
 * toggling one env var. Cleanup to a dedicated LIBRETTO_CLOUD adapter type is a
 * later, separate change.
 *
 * Workflow output shape (aetna-rfp-workflow.ts): { requestId, reachedSubmitPage,
 * submitted }. We map requestId -> externalReference. Success means the run did
 * what the mode asked: submitted=true for a real submit, reachedSubmitPage=true
 * for a fill-only dry run.
 *
 * SAFETY: `confirmSubmit` (whether the workflow clicks the final Submit) is OFF
 * whenever LIBRETTO_DRY_RUN === 'true', regardless of the packet — a kill-switch
 * for the first live runs. Otherwise it follows the packet's stopBeforeSubmit
 * (the same control the in-process AetnaRfpAdapter uses).
 */
export class LibrettoCloudAetnaAdapter implements SubmissionPortalAdapter {
  readonly adapterType: AdapterType = 'AETNA_RFP';

  async submit(
    input: SubmissionAdapterInput,
    _credential: ResolvedCredential
  ): Promise<SubmissionResult> {
    const data = input.providerData;
    if (!isAetnaRfpData(data)) {
      return {
        success: false,
        errorCode: 'BAD_INPUT',
        errorMessage: 'LibrettoCloudAetnaAdapter: providerData is not in AetnaRfpProviderData shape',
      };
    }

    // Dry-run env kill-switch wins over the packet. confirmSubmit=false fills the
    // form but never clicks the final Submit.
    const dryRun = process.env['LIBRETTO_DRY_RUN'] === 'true';
    const confirmSubmit = !dryRun && data.stopBeforeSubmit !== true;
    const workflowName = process.env['LIBRETTO_AETNA_WORKFLOW'] || 'aetnaRfpBehavioralHealth';
    const params = aetnaPacketToLibrettoParams(data, { confirmSubmit });

    logger.info('LibrettoCloudAetnaAdapter: dispatching', {
      enrollmentRunId: input.enrollmentRunId,
      workflow: workflowName,
      confirmSubmit,
      dryRun,
    });

    try {
      const job = await runJob(workflowName, params as unknown as Record<string, unknown>);
      const result = (job.result ?? {}) as {
        requestId?: string | null;
        reachedSubmitPage?: boolean;
        submitted?: boolean;
      };
      const requestId = result.requestId ?? undefined;

      // Success depends on the mode: a real submit must report submitted=true;
      // a dry run only needs to have reached the final submit page.
      const ok = confirmSubmit ? result.submitted === true : result.reachedSubmitPage === true;

      if (!ok) {
        return {
          success: false,
          errorCode: 'LIBRETTO_INCOMPLETE',
          errorMessage: confirmSubmit
            ? `Libretto job finished but did not submit (requestId=${requestId ?? 'none'})`
            : `Libretto job finished but did not reach the submit page (requestId=${requestId ?? 'none'})`,
          externalReference: requestId,
          rawResponseText: JSON.stringify(result),
        };
      }

      logger.info('LibrettoCloudAetnaAdapter: completed', {
        enrollmentRunId: input.enrollmentRunId,
        requestId,
        submitted: result.submitted === true,
      });

      return {
        success: true,
        externalReference: requestId,
        rawResponseText: JSON.stringify({ ...result, confirmSubmit, via: 'libretto-cloud' }),
      };
    } catch (err) {
      const isLibrettoErr = err instanceof LibrettoCloudError;
      return {
        success: false,
        errorCode: isLibrettoErr ? 'LIBRETTO_JOB_FAILED' : 'LIBRETTO_UNEXPECTED',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
