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
    const missingFields: string[] = [];
    const warnings: string[] = [];

    if (!this.caqhService.isConfigured()) {
      return {
        ready: false,
        missingFields: ['CAQH_API_URL', 'CAQH_ORG_ID', 'CAQH_API_KEY'],
        warnings: ['CAQH service is not configured — missing environment variables'],
      };
    }

    const provider = await prisma.provider.findUnique({
      where: { id: input.providerId },
      select: { id: true, caqhProviderId: true, npi: true, firstName: true, lastName: true, dateOfBirth: true },
    });

    if (!provider) {
      return { ready: false, missingFields: ['provider'], warnings: ['Provider not found'] };
    }

    if (!provider.npi) missingFields.push('npi');
    if (!provider.firstName) missingFields.push('firstName');
    if (!provider.lastName) missingFields.push('lastName');
    if (!provider.dateOfBirth) missingFields.push('dateOfBirth');

    if (!provider.caqhProviderId) {
      warnings.push('Provider does not have a CAQH Provider ID — will be added to roster first');
    }

    return {
      ready: missingFields.length === 0,
      missingFields,
      warnings,
    };
  }

  async submit(input: SubmissionInput): Promise<PayerAdapterResult> {
    const provider = await prisma.provider.findUnique({
      where: { id: input.providerId },
      select: {
        id: true,
        caqhProviderId: true,
        npi: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
      },
    });

    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    if (!provider.npi || !provider.firstName || !provider.lastName || !provider.dateOfBirth) {
      return { success: false, error: 'Provider missing required fields (npi, name, dateOfBirth)' };
    }

    let caqhProviderId = provider.caqhProviderId;

    // If provider doesn't have a CAQH ID, add them to the roster first
    if (!caqhProviderId) {
      logger.info(`Adding provider ${provider.npi} to CAQH roster`, {
        providerId: input.providerId,
        workflowId: input.workflowId,
      });

      const rosterResult = await this.caqhService.addToRoster({
        id: provider.id,
        npi: provider.npi,
        firstName: provider.firstName,
        lastName: provider.lastName,
        dateOfBirth: provider.dateOfBirth,
      });

      caqhProviderId = rosterResult.caqhProviderId;

      // Persist the CAQH provider ID
      await prisma.provider.update({
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
