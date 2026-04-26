import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { CaqhService } from '../../services/caqh.service.js';
import type {
  PayerAdapter,
  SubmissionInput,
  ReadinessCheck,
  PayerAdapterResult,
} from './payer-adapter.js';

export class CaqhDirectAssureAdapter implements PayerAdapter {
  readonly adapterType = 'caqh_directassure';
  private caqhService: CaqhService;

  constructor(caqhService?: CaqhService) {
    this.caqhService = caqhService ?? new CaqhService();
  }

  async checkReadiness(input: SubmissionInput): Promise<ReadinessCheck> {
    if (!this.caqhService.isConfigured()) {
      return {
        ready: false,
        missingFields: ['CAQH_API_URL', 'CAQH_ORG_ID', 'CAQH_USERNAME', 'CAQH_PASSWORD'],
        warnings: ['CAQH service is not configured — missing environment variables'],
      };
    }

    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      select: { caqhProviderId: true },
    });

    if (!provider) {
      return { ready: false, missingFields: ['provider'], warnings: ['Provider not found'] };
    }

    const warnings: string[] = [];
    if (!provider.caqhProviderId) {
      warnings.push('Provider does not have a CAQH Provider ID — will be added to roster first');
      // Delegate to the service so readiness aligns with what addToRoster will actually validate.
      const rosterReadiness = await this.caqhService.checkRosterReadiness(input.providerId);
      return {
        ready: rosterReadiness.ready,
        missingFields: rosterReadiness.missingFields,
        warnings,
      };
    }

    return { ready: true, missingFields: [], warnings };
  }

  async submit(input: SubmissionInput): Promise<PayerAdapterResult> {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      select: { id: true, caqhProviderId: true },
    });

    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    let caqhProviderId = provider.caqhProviderId;

    // If provider doesn't have a CAQH ID, add them to the roster first
    if (!caqhProviderId) {
      logger.info('Adding provider to CAQH roster via portal adapter', {
        providerId: input.providerId,
        workflowId: input.workflowId,
      });

      const rosterResult = await this.caqhService.addToRoster(provider.id);
      caqhProviderId = rosterResult.caqhProviderId;

      await prisma.providerProfile.update({
        where: { id: provider.id },
        data: { caqhProviderId },
      });
    }

    // Sync credentials from CAQH
    const syncResult = await this.caqhService.syncProvider(provider.id, caqhProviderId);

    return {
      success: true,
      submissionId: syncResult.syncId,
      confirmationNumber: caqhProviderId,
      details: { changes: syncResult.changes },
    };
  }
}
