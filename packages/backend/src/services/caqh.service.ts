import { prisma } from '../utils/prisma.js';
import type { LicenseType, BoardType, DegreeType, CoverageType } from '@prisma/client';
import { logger } from '../utils/logger.js';

interface CaqhRosterResponse {
  caqhProviderId: string;
  status: string;
}

export interface CaqhStatusResponse {
  organization_id?: string;
  caqh_provider_id?: string;
  roster_status?: 'ACTIVE' | 'NOT ON ROSTER';
  authorization_flag?: 'Y' | 'N';
  provider_status?: string;
  provider_status_date?: string; // YYYYMMDD format
  provider_practice_state?: string;
  anniversary_date?: string; // YYYYMMDD format
  provider_found_flag?: 'Y' | 'N';
}

export interface CaqhDocumentInfo {
  DocumentTypeName: string;
  StateIdName?: string | null;
  ExpirationDate?: string | null;
  DocumentStatusName: 'Approved' | 'Ready for Review' | 'Expired';
  DocumentURL: string;
}

export interface CaqhDownloadResult {
  data: Buffer;
  contentType: string;
  fileName?: string;
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
  private username: string;
  private password: string;
  private product: string;

  constructor() {
    this.baseUrl = process.env['CAQH_API_URL'] || '';
    this.orgId = process.env['CAQH_ORG_ID'] || '';
    this.username = process.env['CAQH_USERNAME'] || '';
    this.password = process.env['CAQH_PASSWORD'] || '';
    this.product = process.env['CAQH_PRODUCT'] || 'PV';
  }

  private getAuthHeader(): string {
    const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return `Basic ${token}`;
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
            'Authorization': this.getAuthHeader(),
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

  /**
   * Convert YYYYMMDD date string (e.g. "20250209") to M/D/YYYY (e.g. "2/9/2025").
   * No zero-padding on month/day — matches CAQH API expected format.
   */
  yyyymmddToMDYYYY(dateStr: string): string {
    const year = dateStr.substring(0, 4);
    const month = parseInt(dateStr.substring(4, 6), 10);
    const day = parseInt(dateStr.substring(6, 8), 10);
    return `${month}/${day}/${year}`;
  }

  private async parseXmlToJson(xml: string): Promise<Record<string, any>> {
    const fxp: any = await import('fast-xml-parser');
    const XMLParser = fxp?.XMLParser ?? fxp?.default?.XMLParser;

    if (XMLParser) {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        trimValues: true,
      });
      return parser.parse(xml);
    }

    throw new Error('No usable XML parser found (fast-xml-parser)');
  }

  async addToRoster(provider: {
    id: string;
    npi: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date;
  }): Promise<CaqhRosterResponse> {
    logger.info(`Adding provider ${provider.npi} to CAQH roster`);

    const response = await this.request<CaqhRosterResponse>(
      `/RosterAPI/API/Roster?product=${encodeURIComponent(this.product)}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider_id: provider.npi,
          first_name: provider.firstName,
          last_name: provider.lastName,
          date_of_birth: provider.dateOfBirth.toISOString().split('T')[0],
        }),
      },
      false
    );

    return response;
  }

  async removeFromRoster(caqhProviderId: string): Promise<void> {
    logger.info(`Removing provider ${caqhProviderId} from CAQH roster`);

    await this.request(
      `/RosterAPI/API/Roster?product=${encodeURIComponent(this.product)}&caqhProviderId=${encodeURIComponent(caqhProviderId)}&organizationId=${encodeURIComponent(this.orgId)}`,
      { method: 'DELETE' },
      false
    );
  }

  async checkStatus(caqhProviderId: string): Promise<CaqhStatusResponse> {
    logger.info(`Checking CAQH status for provider ${caqhProviderId}`);

    const response = await this.request<CaqhStatusResponse>(
      `/RosterAPI/api/ProviderStatus?Product=${encodeURIComponent(this.product)}&Caqh_Provider_Id=${encodeURIComponent(caqhProviderId)}&Organization_Id=${encodeURIComponent(this.orgId)}`
    );

    return response;
  }

  async pullCredentials(caqhProviderId: string, attestationDate: string): Promise<CaqhCredentialsResponse> {
    logger.info(`Pulling credentials from CAQH for provider ${caqhProviderId} (attestation: ${attestationDate})`);

    const url = `/credentialingapi/api/v9/entities?caqhProviderId=${encodeURIComponent(caqhProviderId)}&organizationId=${encodeURIComponent(this.orgId)}&attestationDate=${encodeURIComponent(attestationDate)}`;

    const fullUrl = `${this.baseUrl}${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(fullUrl, {
        signal: controller.signal,
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/xml, text/xml;q=0.9, application/json;q=0.1',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`CAQH Credentialing API error: ${response.status} - ${errorText}`);
        throw new Error(`CAQH API error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      // CAQH Credentialing API v9 returns XML
      if (/xml/i.test(contentType) || text.trim().startsWith('<')) {
        try {
          const parsed = await this.parseXmlToJson(text);
          return parsed as Record<string, any> as CaqhCredentialsResponse;
        } catch (err) {
          logger.error('Failed to parse CAQH credentialing XML response', {
            error: err instanceof Error ? err.message : 'unknown',
          });
          throw new Error('Failed to parse CAQH credentialing response');
        }
      }

      // Fallback to JSON if service returns it
      try {
        return JSON.parse(text) as CaqhCredentialsResponse;
      } catch {
        throw new Error('Unexpected CAQH credentialing response format');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('CAQH API request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDocumentsList(caqhProviderId: string): Promise<CaqhDocumentInfo[]> {
    logger.info(`Fetching CAQH documents list for provider ${caqhProviderId}`);

    const response = await this.request<CaqhDocumentInfo[]>(
      `/documentapi/api/ProviderDocs/GetDocumentsList?caqhProviderID=${encodeURIComponent(caqhProviderId)}&organizationID=${encodeURIComponent(this.orgId)}`,
      { headers: { 'Accept': 'application/json' } }
    );

    return response;
  }

  async downloadDocument(caqhProviderId: string, docUrl: string): Promise<CaqhDownloadResult> {
    logger.info(`Downloading CAQH document for provider ${caqhProviderId}`);

    const url = `${this.baseUrl}/DocumentAPI/api/providerdocs/download?caqhProviderID=${encodeURIComponent(caqhProviderId)}&organizationID=${encodeURIComponent(this.orgId)}&docURL=${encodeURIComponent(docUrl)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': this.getAuthHeader(),
        },
      });

      if (!response.ok) {
        throw new Error(`CAQH API error: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const disposition = response.headers.get('content-disposition') || '';

      let fileName: string | undefined;
      const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
      if (match) {
        fileName = decodeURIComponent((match[1] ?? match[2]) as string);
      }

      return {
        data: Buffer.from(arrayBuffer),
        contentType,
        fileName,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('CAQH API request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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
    // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn; caqhType is from CAQH API, not user HTTP input
    const result = Object.hasOwn(mapping, caqhType) ? mapping[caqhType] : undefined;
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
    const startTime = Date.now();

    const syncLog = await prisma.caqhSyncLog.create({
      data: {
        providerId,
        direction: 'pull',
        status: 'in_progress',
      },
    });

    try {
      // Step 1: Get provider status to extract attestation date
      const status = await this.checkStatus(caqhProviderId);
      const rawDate = status.provider_status_date || status.anniversary_date;

      if (!rawDate) {
        throw new Error('CAQH status response missing attestation date (provider_status_date and anniversary_date both empty)');
      }

      const attestationDate = this.yyyymmddToMDYYYY(rawDate);

      // Step 2: Pull credentials using the attestation date
      const rawCaqhData = await this.pullCredentials(caqhProviderId, attestationDate);
      const caqhData = this.mapCaqhToInternal(rawCaqhData, providerId);
      const changes = await this.applyCaqhDataToProvider(providerId, caqhData);

      const durationMs = Date.now() - startTime;

      await prisma.caqhSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          changesApplied: changes as any,
          durationMs,
        },
      });

      logger.info({
        event: 'caqh_sync_complete',
        providerId,
        durationMs,
        changes,
      });

      await prisma.providerProfile.update({
        where: { id: providerId },
        data: { caqhLastSync: new Date() },
      });

      return { syncId: syncLog.id, changes };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      await prisma.caqhSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          durationMs,
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
      licenses: { created: 0, updated: 0, skipped: 0, failed: 0 },
      certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
      education: { created: 0, updated: 0, skipped: 0, failed: 0 },
      malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
      failedRecords: [],
    };

    // --- Licenses ---
    if (caqhData.licenses?.length > 0) {
      for (const lic of caqhData.licenses) {
        try {
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
            const issueDate = lic.issueDate ? new Date(lic.issueDate) : null;
            if (!issueDate) {
              logger.warn({
                event: 'caqh_missing_field',
                field: 'issueDate',
                category: 'license',
                identifier: lic.licenseNumber,
                providerId,
                fallback: 'current date',
              });
            }
            await prisma.license.create({
              data: {
                providerId,
                licenseType: lic.licenseType,
                licenseNumber: lic.licenseNumber,
                state: lic.state,
                issueDate: issueDate ?? new Date(),
                expirationDate: new Date(lic.expirationDate),
                source: 'caqh_sync',
              },
            });
            summary.licenses.created++;
          }
        } catch (error) {
          summary.licenses.failed++;
          summary.failedRecords.push({
            category: 'license',
            identifier: lic.licenseNumber,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Board Certifications ---
    if (caqhData.certifications?.length > 0) {
      for (const cert of caqhData.certifications) {
        try {
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
        } catch (error) {
          summary.certifications.failed++;
          summary.failedRecords.push({
            category: 'certification',
            identifier: `${cert.boardName}/${cert.specialty}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Education ---
    if (caqhData.education?.length > 0) {
      for (const edu of caqhData.education) {
        try {
          const existing = await prisma.education.findFirst({
            where: { providerId, institutionName: edu.institutionName, degree: edu.degree },
          });

          if (existing) {
            await prisma.education.update({
              where: { id: existing.id },
              data: {
                graduationDate: edu.graduationDate ? new Date(edu.graduationDate) : existing.graduationDate,
                source: 'caqh_sync' as any,
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
                fieldOfStudy: edu.fieldOfStudy ?? 'Not specified',
                country: edu.country ?? 'US',
                startDate: gradDate ?? new Date(),
                graduationDate: gradDate,
                source: 'caqh_sync' as any,
              },
            });
            summary.education.created++;
          }
        } catch (error) {
          summary.education.failed++;
          summary.failedRecords.push({
            category: 'education',
            identifier: `${edu.institutionName}/${edu.degree}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Malpractice Insurance ---
    const malpracticeList = Array.isArray(caqhData.malpractice)
      ? caqhData.malpractice
      : caqhData.malpractice ? [caqhData.malpractice] : [];
    if (malpracticeList.length > 0) {
      for (const mal of malpracticeList) {
        try {
          if (!mal.perClaimAmount) {
            logger.warn({
              event: 'caqh_malpractice_incomplete',
              providerId,
              policyNumber: mal.policyNumber,
              reason: 'Missing perClaimAmount',
            });
            summary.malpractice.skipped++;
            continue;
          }

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
            await prisma.malpracticeInsurance.create({
              data: {
                providerId,
                carrierName: mal.carrierName,
                policyNumber: mal.policyNumber,
                coverageType: mal.coverageType ?? 'occurrence',
                perClaimAmount: mal.perClaimAmount,
                aggregateAmount: mal.aggregateAmount ?? mal.perClaimAmount,
                effectiveDate: mal.effectiveDate ? new Date(mal.effectiveDate) : new Date(),
                expirationDate: new Date(mal.expirationDate),
              },
            });
            summary.malpractice.created++;
          }
        } catch (error) {
          summary.malpractice.failed++;
          summary.failedRecords.push({
            category: 'malpractice',
            identifier: mal.policyNumber,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    return summary;
  }

  /**
   * Check if the CAQH API is configured.
   */
  isConfigured(): boolean {
    return !!(this.baseUrl && this.orgId && this.username && this.password);
  }
}

export interface CaqhSyncSummary {
  licenses: { created: number; updated: number; skipped: number; failed: number };
  certifications: { created: number; updated: number; skipped: number; failed: number };
  education: { created: number; updated: number; skipped: number; failed: number };
  malpractice: { created: number; updated: number; skipped: number; failed: number };
  failedRecords: Array<{ category: string; identifier: string; error: string }>;
}
