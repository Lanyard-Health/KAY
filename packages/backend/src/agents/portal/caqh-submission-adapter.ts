import type { AdapterType } from '@prisma/client';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { CaqhService } from '../../services/caqh.service.js';
import type {
  SubmissionPortalAdapter,
  SubmissionAdapterInput,
  SubmissionResult,
} from './submission-adapter.js';
import type { ResolvedCredential } from '../../services/credential.service.js';

/**
 * Real CAQH submission adapter (Phase 3). Replaces CaqhSubmissionAdapterStub.
 *
 * CAQH submission is REST/XML over HTTPS via CaqhService — no browser. So this
 * adapter implements SubmissionPortalAdapter directly instead of extending
 * PlaywrightBaseAdapter.
 *
 * The `credential` parameter is accepted for interface compatibility but not
 * read. CAQH API auth is org-level (CAQH_USERNAME / CAQH_PASSWORD env vars),
 * handled inside CaqhService. Per-provider CAQH portal login is a separate
 * concern not used by the submission pipeline.
 */
export class CaqhSubmissionAdapter implements SubmissionPortalAdapter {
  readonly adapterType: AdapterType = 'CAQH';
  private caqhService: CaqhService;

  constructor(caqhService?: CaqhService) {
    this.caqhService = caqhService ?? new CaqhService();
  }

  async submit(
    input: SubmissionAdapterInput,
    _credential: ResolvedCredential
  ): Promise<SubmissionResult> {
    if (!this.caqhService.isConfigured()) {
      return {
        success: false,
        errorCode: 'CAQH_NOT_CONFIGURED',
        errorMessage:
          'CAQH service is not configured — missing CAQH_API_URL, CAQH_ORG_ID, CAQH_USERNAME, or CAQH_PASSWORD.',
      };
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      select: { id: true, caqhProviderId: true },
    });

    if (!provider) {
      return {
        success: false,
        errorCode: 'PROVIDER_NOT_FOUND',
        errorMessage: `Provider ${input.providerId} not found`,
      };
    }

    let caqhProviderId = provider.caqhProviderId;

    if (!caqhProviderId) {
      logger.info('Adding provider to CAQH roster (Phase 3 adapter)', {
        enrollmentRunId: input.enrollmentRunId,
        providerId: input.providerId,
      });

      try {
        const rosterResult = await this.caqhService.addToRoster(provider.id);
        caqhProviderId = rosterResult.caqhProviderId;

        await prisma.providerProfile.update({
          where: { id: provider.id },
          data: { caqhProviderId },
        });
      } catch (err) {
        return {
          success: false,
          errorCode: 'CAQH_ROSTER_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      const syncResult = await this.caqhService.syncProvider(provider.id, caqhProviderId);

      return {
        success: true,
        confirmationNumber: caqhProviderId,
        externalReference: syncResult.syncId,
      };
    } catch (err) {
      return {
        success: false,
        errorCode: 'CAQH_SYNC_FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
