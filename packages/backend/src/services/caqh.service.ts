import { prisma } from '../utils/prisma.js';
import type { LicenseType, BoardType, DegreeType, CoverageType } from '@prisma/client';
import { logger } from '../utils/logger.js';

interface CaqhRosterResponse {
  caqhProviderId: string;
  status: string;
}

interface CaqhStatusResponse {
  caqhProviderId: string;
  attestationStatus: 'active' | 'inactive' | 'pending' | 'expired';
  lastAttestationDate?: string;
  nextAttestationDate?: string;
}

export interface CaqhCredentialsResponse {
  provider: {
    firstName: string;
    lastName: string;
    npi: string;
  };
  licenses: Array<{
    type: string;
    number: string;
    state: string;
    expirationDate: string;
  }>;
  certifications: Array<{
    board: string;
    specialty: string;
    expirationDate?: string;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    graduationDate: string;
  }>;
  malpractice?: {
    carrier: string;
    policyNumber: string;
    expirationDate: string;
    coverageAmount: number;
  };
}

export interface MappedCaqhData {
  provider: {
    firstName: string;
    lastName: string;
    npi: string;
  };
  licenses: Array<{
    licenseType: LicenseType;
    licenseNumber: string;
    state: string;
    expirationDate: Date;
    issueDate?: Date;
  }>;
  certifications: Array<{
    boardType: BoardType;
    boardName: string;
    specialty: string;
    expirationDate?: Date;
    initialCertificationDate?: Date;
  }>;
  education: Array<{
    institutionName: string;
    degree: DegreeType;
    graduationDate?: Date;
    fieldOfStudy?: string;
    country?: string;
  }>;
  malpractice: Array<{
    carrierName: string;
    policyNumber: string;
    expirationDate: string;
    perClaimAmount?: number;
    aggregateAmount?: number;
    coverageType?: CoverageType;
    effectiveDate?: string;
  }>;
}

export class CaqhService {
  private baseUrl: string;
  private orgId: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env['CAQH_API_URL'] || '';
    this.orgId = process.env['CAQH_ORG_ID'] || '';
    this.apiKey = process.env['CAQH_API_KEY'] || '';
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryable = true
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const maxRetries = retryable ? 3 : 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'Organization-Id': this.orgId,
            ...options.headers,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();

          // Don't retry 4xx client errors
          if (response.status >= 400 && response.status < 500) {
            logger.error(`CAQH API client error: ${response.status} - ${errorText}`);
            throw new Error(`CAQH API error: ${response.status}`);
          }

          // Retry 5xx server errors
          logger.warn({
            event: 'caqh_api_retry',
            attempt,
            maxRetries,
            status: response.status,
            endpoint,
          });
          lastError = new Error(`CAQH API error: ${response.status}`);
          if (attempt < maxRetries) {
            await this.sleep(1000 * Math.pow(2, attempt - 1));
            continue;
          }
          throw lastError;
        }

        const text = await response.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          logger.error({ event: 'caqh_json_parse_error', endpoint, responseText: text.substring(0, 200) });
          throw new Error('CAQH API returned invalid JSON');
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          lastError = new Error('CAQH API request timed out');
        } else if (error instanceof Error && error.message.startsWith('CAQH API')) {
          lastError = error;
        } else {
          lastError = error instanceof Error ? error : new Error('Unknown CAQH error');
        }

        if (attempt < maxRetries && retryable) {
          logger.warn({
            event: 'caqh_api_retry',
            attempt,
            maxRetries,
            error: lastError.message,
            endpoint,
          });
          await this.sleep(1000 * Math.pow(2, attempt - 1));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error('CAQH API request failed');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async addToRoster(provider: {
    id: string;
    npi: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date;
  }): Promise<CaqhRosterResponse> {
    logger.info(`Adding provider ${provider.npi} to CAQH roster`);

    // CAQH Roster API endpoint
    const response = await this.request<CaqhRosterResponse>('/roster/add', {
      method: 'POST',
      body: JSON.stringify({
        provider_id: provider.npi,
        first_name: provider.firstName,
        last_name: provider.lastName,
        date_of_birth: provider.dateOfBirth.toISOString().split('T')[0],
      }),
    }, false);

    return response;
  }

  async removeFromRoster(caqhProviderId: string): Promise<void> {
    logger.info(`Removing provider ${caqhProviderId} from CAQH roster`);

    await this.request(`/roster/${caqhProviderId}`, {
      method: 'DELETE',
    }, false);
  }

  async checkStatus(caqhProviderId: string): Promise<CaqhStatusResponse> {
    logger.info(`Checking CAQH status for provider ${caqhProviderId}`);

    const response = await this.request<CaqhStatusResponse>(
      `/status/${caqhProviderId}`
    );

    return response;
  }

  async pullCredentials(caqhProviderId: string): Promise<CaqhCredentialsResponse> {
    logger.info(`Pulling credentials from CAQH for provider ${caqhProviderId}`);

    // DirectAssure API endpoint for credential data
    const response = await this.request<CaqhCredentialsResponse>(
      `/directassure/provider/${caqhProviderId}`
    );

    return response;
  }

  // Map CAQH data to our internal format
  mapCaqhToInternal(caqhData: CaqhCredentialsResponse, providerId?: string): MappedCaqhData {
    return {
      provider: {
        firstName: caqhData.provider.firstName,
        lastName: caqhData.provider.lastName,
        npi: caqhData.provider.npi,
      },
      licenses: caqhData.licenses.map(license => ({
        licenseType: this.mapLicenseType(license.type, providerId),
        licenseNumber: license.number,
        state: license.state,
        expirationDate: new Date(license.expirationDate),
      })),
      certifications: caqhData.certifications.map(cert => ({
        boardType: this.mapBoardType(cert.board, providerId),
        boardName: cert.board,
        specialty: cert.specialty,
        expirationDate: cert.expirationDate
          ? new Date(cert.expirationDate)
          : undefined,
      })),
      education: caqhData.education.map(edu => ({
        institutionName: edu.institution,
        degree: this.mapDegreeType(edu.degree, providerId),
        graduationDate: new Date(edu.graduationDate),
      })),
      malpractice: caqhData.malpractice
        ? [{
            carrierName: caqhData.malpractice.carrier,
            policyNumber: caqhData.malpractice.policyNumber,
            expirationDate: caqhData.malpractice.expirationDate,
            perClaimAmount: caqhData.malpractice.coverageAmount,
          }]
        : [],
    };
  }

  private mapLicenseType(caqhType: string, providerId?: string): LicenseType {
    const mapping: Record<string, LicenseType> = {
      'MD': 'state_medical',
      'DO': 'state_medical',
      'PSY': 'state_psychology',
      'SW': 'state_social_work',
      'LPC': 'state_counseling',
      'MFT': 'state_marriage_family',
      'DEA': 'dea',
      'CDS': 'controlled_substance',
    };
    const result = mapping[caqhType];
    if (!result) {
      logger.warn({
        event: 'caqh_unknown_mapping',
        field: 'licenseType',
        rawValue: caqhType,
        defaultedTo: 'state_medical',
        providerId,
      });
      return 'state_medical';
    }
    return result;
  }

  private mapBoardType(caqhBoard: string, providerId?: string): BoardType {
    const boardLower = caqhBoard.toLowerCase();

    if (boardLower.includes('psychiatry')) return 'abpn_psychiatry';
    if (boardLower.includes('psychology')) return 'abpp_clinical';
    if (boardLower.includes('social work')) return 'abecsw';
    if (boardLower.includes('counselor')) return 'nbcc';
    if (boardLower.includes('marriage') || boardLower.includes('family')) return 'aamft';
    if (boardLower.includes('nurse')) return 'ancc_pmhnp';

    logger.warn({
      event: 'caqh_unknown_mapping',
      field: 'boardType',
      rawValue: caqhBoard,
      defaultedTo: 'other',
      providerId,
    });
    return 'other';
  }

  private mapDegreeType(caqhDegree: string, providerId?: string): DegreeType {
    const degreeLower = caqhDegree.toLowerCase();

    if (degreeLower.includes('md')) return 'md';
    if (degreeLower.includes('do')) return 'do';
    if (degreeLower.includes('phd')) return 'phd';
    if (degreeLower.includes('psyd')) return 'psyd';
    if (degreeLower.includes('msw')) return 'msw';
    if (degreeLower.includes('dnp')) return 'dnp';
    if (degreeLower.includes('msn')) return 'msn';

    logger.warn({
      event: 'caqh_unknown_mapping',
      field: 'degreeType',
      rawValue: caqhDegree,
      defaultedTo: 'other',
      providerId,
    });
    return 'other';
  }

  /**
   * Full sync flow for a single provider: pull → map → apply → log.
   * Used by both the manual pull route and the nightly scheduler.
   */
  async syncProvider(providerId: string, caqhProviderId: string): Promise<{
    syncId: string;
    changes: CaqhSyncSummary;
  }> {
    const syncLog = await prisma.caqhSyncLog.create({
      data: {
        providerId,
        direction: 'pull',
        status: 'in_progress',
      },
    });

    try {
      const rawCaqhData = await this.pullCredentials(caqhProviderId);
      const caqhData = this.mapCaqhToInternal(rawCaqhData, providerId);
      const changes = await this.applyCaqhDataToProvider(providerId, caqhData);

      await prisma.caqhSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          changesApplied: changes as any,
        },
      });

      await prisma.provider.update({
        where: { id: providerId },
        data: { caqhLastSync: new Date() },
      });

      return { syncId: syncLog.id, changes };
    } catch (error) {
      await prisma.caqhSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }

  /**
   * Apply mapped CAQH data to provider records.
   * Skips records marked as source='manual_entry'.
   */
  async applyCaqhDataToProvider(
    providerId: string,
    caqhData: MappedCaqhData
  ): Promise<CaqhSyncSummary> {
    const summary: CaqhSyncSummary = {
      licenses: { created: 0, updated: 0, skipped: 0 },
      certifications: { created: 0, updated: 0, skipped: 0 },
      education: { created: 0, updated: 0, skipped: 0 },
      malpractice: { created: 0, updated: 0, skipped: 0 },
    };

    // --- Licenses ---
    if (caqhData.licenses?.length > 0) {
      for (const lic of caqhData.licenses) {
        const existing = await prisma.license.findFirst({
          where: { providerId, licenseNumber: lic.licenseNumber },
        });

        if (existing) {
          if (existing.source === 'manual_entry') {
            summary.licenses.skipped++;
            continue;
          }
          await prisma.license.update({
            where: { id: existing.id },
            data: {
              licenseType: lic.licenseType ?? existing.licenseType,
              state: lic.state ?? existing.state,
              expirationDate: lic.expirationDate ? new Date(lic.expirationDate) : existing.expirationDate,
              source: 'caqh_sync',
            },
          });
          summary.licenses.updated++;
        } else {
          await prisma.license.create({
            data: {
              providerId,
              licenseType: lic.licenseType,
              licenseNumber: lic.licenseNumber,
              state: lic.state,
              issueDate: lic.issueDate ? new Date(lic.issueDate) : new Date(),
              expirationDate: new Date(lic.expirationDate),
              source: 'caqh_sync',
            },
          });
          summary.licenses.created++;
        }
      }
    }

    // --- Board Certifications ---
    if (caqhData.certifications?.length > 0) {
      for (const cert of caqhData.certifications) {
        const existing = await prisma.boardCertification.findFirst({
          where: { providerId, boardName: cert.boardName, specialty: cert.specialty },
        });

        if (existing) {
          if (existing.source === 'manual_entry') {
            summary.certifications.skipped++;
            continue;
          }
          await prisma.boardCertification.update({
            where: { id: existing.id },
            data: {
              boardType: cert.boardType ?? existing.boardType,
              expirationDate: cert.expirationDate ? new Date(cert.expirationDate) : existing.expirationDate,
              source: 'caqh_sync',
            },
          });
          summary.certifications.updated++;
        } else {
          await prisma.boardCertification.create({
            data: {
              providerId,
              boardType: cert.boardType ?? 'other',
              boardName: cert.boardName,
              specialty: cert.specialty,
              initialCertificationDate: cert.initialCertificationDate
                ? new Date(cert.initialCertificationDate)
                : new Date(),
              expirationDate: cert.expirationDate ? new Date(cert.expirationDate) : undefined,
              source: 'caqh_sync',
            },
          });
          summary.certifications.created++;
        }
      }
    }

    // --- Education ---
    if (caqhData.education?.length > 0) {
      for (const edu of caqhData.education) {
        const existing = await prisma.education.findFirst({
          where: { providerId, institutionName: edu.institutionName, degree: edu.degree },
        });

        if (existing) {
          await prisma.education.update({
            where: { id: existing.id },
            data: {
              graduationDate: edu.graduationDate ? new Date(edu.graduationDate) : existing.graduationDate,
            },
          });
          summary.education.updated++;
        } else {
          const gradDate = edu.graduationDate ? new Date(edu.graduationDate) : undefined;
          await prisma.education.create({
            data: {
              providerId,
              institutionName: edu.institutionName,
              degree: edu.degree,
              fieldOfStudy: edu.fieldOfStudy ?? 'Unknown',
              country: edu.country ?? 'US',
              startDate: gradDate ?? new Date(),
              graduationDate: gradDate,
            },
          });
          summary.education.created++;
        }
      }
    }

    // --- Malpractice Insurance ---
    const malpracticeList = Array.isArray(caqhData.malpractice)
      ? caqhData.malpractice
      : caqhData.malpractice ? [caqhData.malpractice] : [];
    if (malpracticeList.length > 0) {
      for (const mal of malpracticeList) {
        const existing = await prisma.malpracticeInsurance.findFirst({
          where: { providerId, policyNumber: mal.policyNumber },
        });

        if (existing) {
          await prisma.malpracticeInsurance.update({
            where: { id: existing.id },
            data: {
              carrierName: mal.carrierName ?? existing.carrierName,
              expirationDate: mal.expirationDate ? new Date(mal.expirationDate) : existing.expirationDate,
              perClaimAmount: mal.perClaimAmount ?? existing.perClaimAmount,
            },
          });
          summary.malpractice.updated++;
        } else {
          const perClaim = mal.perClaimAmount ?? 1000000;
          await prisma.malpracticeInsurance.create({
            data: {
              providerId,
              carrierName: mal.carrierName,
              policyNumber: mal.policyNumber,
              coverageType: mal.coverageType ?? 'occurrence',
              perClaimAmount: perClaim,
              aggregateAmount: mal.aggregateAmount ?? perClaim * 3,
              effectiveDate: mal.effectiveDate ? new Date(mal.effectiveDate) : new Date(),
              expirationDate: new Date(mal.expirationDate),
            },
          });
          summary.malpractice.created++;
        }
      }
    }

    return summary;
  }

  /**
   * Check if the CAQH API is configured.
   */
  isConfigured(): boolean {
    return !!(this.baseUrl && this.orgId && this.apiKey);
  }
}

export interface CaqhSyncSummary {
  licenses: { created: number; updated: number; skipped: number };
  certifications: { created: number; updated: number; skipped: number };
  education: { created: number; updated: number; skipped: number };
  malpractice: { created: number; updated: number; skipped: number };
}
