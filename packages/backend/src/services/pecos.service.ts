/**
 * PECOS/Medicare Enrollment Service
 *
 * Uses CMS data.cms.gov API to fetch detailed Medicare enrollment data.
 * Data source: Medicare Fee-For-Service Public Provider Enrollment
 * https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment/medicare-fee-for-service-public-provider-enrollment
 */

import { logger } from '../utils/logger.js';

// CMS Medicare Fee-For-Service Public Provider Enrollment dataset UUID
const CMS_ENROLLMENT_DATASET_UUID = '2457ea29-fc82-48b0-86ec-3b0755de7515';
// CMS Order and Referring dataset (for ordering privileges)
const CMS_ORDER_REFER_DATASET_UUID = 'c99b5865-1119-4436-bb80-c5af2773ea1f';
const CMS_API_BASE = 'https://data.cms.gov/data-api/v1/dataset';

export interface MedicareEnrollment {
  enrollmentId: string;
  enrollmentDate: string;  // Extracted from enrollment ID
  providerTypeCode: string;
  providerTypeDesc: string;
  state: string;
}

export interface OrderingPrivileges {
  partB: boolean;
  dme: boolean;
  hha: boolean;
  pmd: boolean;
  hospice: boolean;
}

export interface MedicareEnrollmentResult {
  found: boolean;
  npi?: string;
  pacId?: string;  // PECOS Associate Control ID
  firstName?: string;
  middleName?: string;
  lastName?: string;
  organizationName?: string;
  multipleNpiFlag?: boolean;
  enrollments?: MedicareEnrollment[];
  primaryEnrollment?: MedicareEnrollment;
  orderingPrivileges?: OrderingPrivileges;
  verifiedAt?: string;
}

export class PECOSService {
  /**
   * Extract enrollment date from enrollment ID
   * Format: I20091005000100 -> 2009-10-05
   */
  private parseEnrollmentDate(enrollmentId: string): string {
    if (!enrollmentId || enrollmentId.length < 9) return '';
    // Format: IYYYYMMDD...
    const year = enrollmentId.substring(1, 5);
    const month = enrollmentId.substring(5, 7);
    const day = enrollmentId.substring(7, 9);
    return `${year}-${month}-${day}`;
  }

  /**
   * Look up detailed Medicare enrollment by NPI
   */
  async lookupByNPI(npi: string): Promise<MedicareEnrollmentResult> {
    try {
      logger.info(`PECOS detailed lookup for NPI: ${npi}`);

      // Fetch enrollment data and ordering privileges in parallel
      const [enrollmentData, orderingData] = await Promise.all([
        this.fetchEnrollmentData(npi),
        this.fetchOrderingPrivileges(npi),
      ]);

      if (!enrollmentData || enrollmentData.length === 0) {
        logger.info(`NPI ${npi} not found in Medicare enrollment data`);
        return { found: false };
      }

      // Get the first record for basic info (same across all enrollments for this NPI)
      const firstRecord = enrollmentData[0];

      // Parse all enrollments
      const enrollments: MedicareEnrollment[] = enrollmentData.map((record: any) => ({
        enrollmentId: record.ENRLMT_ID,
        enrollmentDate: this.parseEnrollmentDate(record.ENRLMT_ID),
        providerTypeCode: record.PROVIDER_TYPE_CD,
        providerTypeDesc: record.PROVIDER_TYPE_DESC,
        state: record.STATE_CD,
      }));

      // Sort by enrollment date (oldest first) to find primary/original enrollment
      enrollments.sort((a, b) => a.enrollmentDate.localeCompare(b.enrollmentDate));

      // Parse ordering privileges
      let orderingPrivileges: OrderingPrivileges | undefined;
      if (orderingData) {
        orderingPrivileges = {
          partB: orderingData.PARTB === 'Y',
          dme: orderingData.DME === 'Y',
          hha: orderingData.HHA === 'Y',
          pmd: orderingData.PMD === 'Y',
          hospice: orderingData.HOSPICE === 'Y',
        };
      }

      logger.info(`Found ${enrollments.length} Medicare enrollment(s) for NPI ${npi}`);

      return {
        found: true,
        npi: firstRecord.NPI,
        pacId: firstRecord.PECOS_ASCT_CNTL_ID,
        firstName: firstRecord.FIRST_NAME,
        middleName: firstRecord.MDL_NAME || undefined,
        lastName: firstRecord.LAST_NAME,
        organizationName: firstRecord.ORG_NAME || undefined,
        multipleNpiFlag: firstRecord.MULTIPLE_NPI_FLAG === 'Y',
        enrollments,
        primaryEnrollment: enrollments[0],
        orderingPrivileges,
        verifiedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('PECOS lookup error:', error);
      throw new Error('Failed to lookup Medicare enrollment status');
    }
  }

  /**
   * Fetch enrollment data from CMS API
   */
  private async fetchEnrollmentData(npi: string): Promise<any[] | null> {
    try {
      const url = `${CMS_API_BASE}/${CMS_ENROLLMENT_DATASET_UUID}/data?keyword=${npi}&size=50`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        logger.error(`CMS Enrollment API error: ${response.status}`);
        return null;
      }

      const data = await response.json() as any[];
      // Filter to exact NPI match
      return data.filter(record => record.NPI === npi);
    } catch (error) {
      logger.error('Error fetching enrollment data:', error);
      return null;
    }
  }

  /**
   * Fetch ordering privileges from Order and Referring dataset
   */
  private async fetchOrderingPrivileges(npi: string): Promise<any | null> {
    try {
      const url = `${CMS_API_BASE}/${CMS_ORDER_REFER_DATASET_UUID}/data?keyword=${npi}&size=10`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        logger.error(`CMS Order/Refer API error: ${response.status}`);
        return null;
      }

      const data = await response.json() as any[];
      // Find exact NPI match
      return data.find(record => record.NPI === npi) || null;
    } catch (error) {
      logger.error('Error fetching ordering privileges:', error);
      return null;
    }
  }

  /**
   * Check if a provider is enrolled in Medicare
   */
  async isEnrolledInMedicare(npi: string): Promise<boolean> {
    const result = await this.lookupByNPI(npi);
    return result.found && (result.enrollments?.length ?? 0) > 0;
  }

  /**
   * Get all enrollment states for a provider
   */
  async getEnrollmentStates(npi: string): Promise<string[]> {
    const result = await this.lookupByNPI(npi);
    if (!result.found || !result.enrollments) return [];
    return [...new Set(result.enrollments.map(e => e.state))];
  }

  /**
   * Get all specialties for a provider
   */
  async getSpecialties(npi: string): Promise<string[]> {
    const result = await this.lookupByNPI(npi);
    if (!result.found || !result.enrollments) return [];
    return [...new Set(result.enrollments.map(e => e.providerTypeDesc))];
  }

  /**
   * Batch lookup for multiple NPIs
   */
  async batchLookup(npis: string[]): Promise<Map<string, MedicareEnrollmentResult>> {
    const results = new Map<string, MedicareEnrollmentResult>();

    // Process in parallel with concurrency limit
    const concurrencyLimit = 5;
    for (let i = 0; i < npis.length; i += concurrencyLimit) {
      const batch = npis.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(npi => this.lookupByNPI(npi))
      );

      batch.forEach((npi, index) => {
        results.set(npi, batchResults[index]);
      });
    }

    return results;
  }
}
