import { prisma } from '../utils/prisma.js';
import type { LicenseType, BoardType, DegreeType, CoverageType, Gender, IdentifierType, AddressType } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { encryptSafe } from '../utils/crypto.js';

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

/**
 * Real CAQH Credentialing API v8 response shape.
 * XML-parsed root `<Provider>` becomes `{ Provider: {...} }` in JSON.
 * All nested field names are PascalCase.
 *
 * Field presence varies per provider — all marked optional for safety.
 * Source: captured payload from POID 6279 / CAQH ID 16174500 (2026-04-21)
 * plus v8-only additions documented in the CAQH API Data Dictionary.
 */
export interface CaqhV8Response {
  Provider?: CaqhV8Provider;
}

export interface CaqhV8Provider {
  // Core identity
  ID?: string | number;
  NPI?: string | number;
  SSN?: string | number;
  ProviderFirstName?: string;
  ProviderLastName?: string;
  ProviderMiddleName?: string;
  ProviderSuffix?: string;
  FirstName?: string; // some payloads omit the `Provider` prefix
  LastName?: string;
  MiddleName?: string;
  ProviderDateOfBirth?: string;
  DateOfBirth?: string;
  BirthDate?: string;
  ProviderGender?: string;
  Gender?: string;
  ProviderEmail?: string;
  Email?: string;
  EmailAddress?: string;
  ProviderPhone?: string;
  Phone?: string;

  // V8 additions
  ProviderAttestID?: string | number;
  PrimaryPracticeState?: string;
  OtherPracticeState?: string;
  EthnicityDescription?: string;
  HospitalBasedFlag?: string | boolean;
  HospitalPrivilegeFlag?: string | boolean;
  FellowshipTrainingFlag?: string | boolean;
  SecondarySpecialtyFlag?: string | boolean;
  ActiveMilitaryFlag?: string | boolean;
  WorkHistoryGapFlag?: string | boolean;
  MedicareProviderFlag?: string | boolean;
  MedicaidProviderFlag?: string | boolean;

  // Nested sections (detail handling deferred to Phases 2+)
  ProviderAddress?: CaqhV8Address | CaqhV8Address[];
  ProviderIdentifier?: CaqhV8Identifier | CaqhV8Identifier[];

  // Catch-all for as-yet-unmapped sections; we preserve raw JSON in the mirror
  [key: string]: unknown;
}

export interface CaqhV8Address {
  AddressType?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  Address?: string;  // v8 uses this in place of AddressLine1
  City?: string;
  State?: string;
  ZipCode?: string;
  PostalCode?: string | number;
  EmailAddress?: string;
  Country?: string;
  [key: string]: unknown;
}

export interface CaqhV8Identifier {
  IdentifierType?: string;
  IdentifierValue?: string | number;
  IssuingEntity?: string;
  State?: string;
  EffectiveDate?: string;
  ExpirationDate?: string;
  [key: string]: unknown;
}

/** @deprecated — legacy camelCase shape kept for backward compatibility during phased rollout */
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

export interface MappedProviderCore {
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  npi: string;
  ssn?: string;               // plaintext — caller encrypts before persist
  dateOfBirth?: Date;
  gender?: Gender;
  email?: string;
  phone?: string;
  ethnicity?: string;
  primaryPracticeState?: string;
  otherPracticeState?: string;
  // Phase 0 flags
  hospitalBasedFlag?: boolean;
  hospitalPrivilegeFlag?: boolean;
  fellowshipTrainingFlag?: boolean;
  secondarySpecialtyFlag?: boolean;
  activeMilitaryFlag?: boolean;
  workHistoryGapFlag?: boolean;
  acceptingMedicare?: boolean;
  acceptingMedicaid?: boolean;
}

export interface MappedProviderAddress {
  type: AddressType;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

export interface MappedProviderIdentifier {
  identifierType: IdentifierType;
  identifierValue: string;
  issuingEntity?: string;
  state?: string;
  effectiveDate?: Date;
  expirationDate?: Date;
  notes?: string;
}

export interface MappedCaqhData {
  provider: MappedProviderCore;
  addresses: MappedProviderAddress[];
  identifiers: MappedProviderIdentifier[];
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

/** Coerce various CAQH value shapes to an optional trimmed string. */
function toOptString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // fast-xml-parser emits `{'#text': 'value'}` for elements with attributes.
  // CAQH v8 uses `{XxxDescription: 'value'}` for coded-lookup fields
  //   (AddressType, IdentifierType, etc.).
  // Also handle CAQH `{string: {'#text': 'value'}}` wrappers seen in probes.
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj['#text'] === 'string' || typeof obj['#text'] === 'number') {
      return toOptString(obj['#text']);
    }
    if (obj['string'] != null) {
      return toOptString(obj['string']);
    }
    // CAQH coded-lookup pattern: `{<Field>Description: <value>}`
    const keys = Object.keys(obj);
    const descKey = keys.find(k => k.endsWith('Description'));
    if (descKey) {
      // eslint-disable-next-line security/detect-object-injection -- key is from object's own keys
      return toOptString(obj[descKey]);
    }
  }
  return undefined;
}

/**
 * Coerce CAQH flag values to boolean.
 * Accepts: true/false, "Y"/"N", "Yes"/"No", "true"/"false", "1"/"0".
 */
function toOptBool(v: unknown): boolean | undefined {
  if (v == null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = toOptString(v);
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(t)) return true;
  if (['n', 'no', 'false', '0'].includes(t)) return false;
  return undefined;
}

/** Parse CAQH date values (YYYYMMDD, YYYY-MM-DD, MM/DD/YYYY, ISO). */
function parseCaqhDate(raw: unknown): Date | undefined {
  const s = toOptString(raw);
  if (!s || s === '0') return undefined;
  // YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    const dt = new Date(Date.UTC(y, m - 1, d));
    return isNaN(dt.getTime()) ? undefined : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? undefined : dt;
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

    const url = `/credentialingapi/api/v8/entities?caqhProviderId=${encodeURIComponent(caqhProviderId)}&organizationId=${encodeURIComponent(this.orgId)}&attestationDate=${encodeURIComponent(attestationDate)}`;

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

  /**
   * Map CAQH data to our internal format.
   *
   * Accepts two shapes:
   *   1. v8 PascalCase — `{ Provider: {...} }` root wrapper (real CAQH API response)
   *   2. Legacy camelCase — `{ provider, licenses, ... }` (older test fixtures, backward compat)
   *
   * Defensive against partial payloads: missing sections produce empty arrays
   * rather than crashing, so `rawJson` is always preserved for debugging.
   *
   * Phase 1 scope: provider core (name, NPI, SSN, DOB, gender, practice state, flags)
   * + addresses + identifiers. Licenses/certs/education/malpractice still use
   * legacy camelCase path only — Phases 2+ will extend to v8 PascalCase for those.
   */
  mapCaqhToInternal(caqhData: unknown, providerId?: string): MappedCaqhData {
    // Detect v8 PascalCase shape by presence of `Provider` root wrapper
    const v8Root = (caqhData as CaqhV8Response | undefined)?.Provider;
    if (v8Root && typeof v8Root === 'object') {
      return this.mapV8(v8Root, providerId);
    }
    // Fall back to legacy camelCase shape
    return this.mapLegacy(caqhData as CaqhCredentialsResponse | undefined, providerId);
  }

  private mapV8(p: CaqhV8Provider, providerId?: string): MappedCaqhData {
    const addrList = this.asArray(p.ProviderAddress);
    const idList = this.asArray(p.ProviderIdentifier);

    const npiStr = toOptString(p.NPI);
    const ssnStr = toOptString(p.SSN);
    return {
      provider: {
        firstName: toOptString(p.ProviderFirstName ?? p.FirstName) ?? '',
        lastName: toOptString(p.ProviderLastName ?? p.LastName) ?? '',
        middleName: toOptString(p.ProviderMiddleName ?? p.MiddleName),
        suffix: toOptString(p.ProviderSuffix),
        npi: npiStr ?? '',
        ssn: ssnStr ? this.normalizeSsn(ssnStr) : undefined,
        dateOfBirth: parseCaqhDate(p.ProviderDateOfBirth ?? p.DateOfBirth ?? p.BirthDate),
        gender: this.mapGender(p.ProviderGender ?? p.Gender, providerId),
        email: toOptString(p.ProviderEmail ?? p.Email ?? p.EmailAddress),
        phone: toOptString(p.ProviderPhone ?? p.Phone),
        ethnicity: toOptString(p.EthnicityDescription),
        primaryPracticeState: toOptString(p.PrimaryPracticeState),
        otherPracticeState: toOptString(p.OtherPracticeState),
        hospitalBasedFlag: toOptBool(p.HospitalBasedFlag),
        hospitalPrivilegeFlag: toOptBool(p.HospitalPrivilegeFlag),
        fellowshipTrainingFlag: toOptBool(p.FellowshipTrainingFlag),
        secondarySpecialtyFlag: toOptBool(p.SecondarySpecialtyFlag),
        activeMilitaryFlag: toOptBool(p.ActiveMilitaryFlag),
        workHistoryGapFlag: toOptBool(p.WorkHistoryGapFlag),
        acceptingMedicare: toOptBool(p.MedicareProviderFlag),
        acceptingMedicaid: toOptBool(p.MedicaidProviderFlag),
      },
      addresses: addrList
        .map(a => this.mapV8Address(a, providerId))
        .filter((a): a is MappedProviderAddress => a !== null),
      identifiers: idList
        .map(i => this.mapV8Identifier(i, providerId))
        .filter((i): i is MappedProviderIdentifier => i !== null),
      // Deferred to Phases 2+
      licenses: [],
      certifications: [],
      education: [],
      malpractice: [],
    };
  }

  private mapLegacy(caqhData: CaqhCredentialsResponse | undefined, providerId?: string): MappedCaqhData {
    const provider = caqhData?.provider ?? ({} as CaqhCredentialsResponse['provider']);
    const licenses = Array.isArray(caqhData?.licenses) ? caqhData.licenses : [];
    const certifications = Array.isArray(caqhData?.certifications) ? caqhData.certifications : [];
    const education = Array.isArray(caqhData?.education) ? caqhData.education : [];

    return {
      provider: {
        firstName: provider.firstName ?? '',
        lastName: provider.lastName ?? '',
        npi: provider.npi ?? '',
      },
      addresses: [],
      identifiers: [],
      licenses: licenses.map(license => ({
        licenseType: this.mapLicenseType(license.type, providerId),
        licenseNumber: license.number,
        state: license.state,
        expirationDate: new Date(license.expirationDate),
      })),
      certifications: certifications.map(cert => ({
        boardType: this.mapBoardType(cert.board, providerId),
        boardName: cert.board,
        specialty: cert.specialty,
        expirationDate: cert.expirationDate
          ? new Date(cert.expirationDate)
          : undefined,
      })),
      education: education.map(edu => ({
        institutionName: edu.institution,
        degree: this.mapDegreeType(edu.degree, providerId),
        graduationDate: new Date(edu.graduationDate),
      })),
      malpractice: caqhData?.malpractice
        ? [{
            carrierName: caqhData.malpractice.carrier,
            policyNumber: caqhData.malpractice.policyNumber,
            expirationDate: caqhData.malpractice.expirationDate,
            perClaimAmount: caqhData.malpractice.coverageAmount,
          }]
        : [],
    };
  }

  private asArray<T>(v: T | T[] | undefined): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  }

  private normalizeSsn(raw: string): string {
    // Strip non-digits; CAQH sometimes returns with dashes or as numeric.
    const digits = raw.replace(/\D/g, '');
    return digits;
  }

  private mapGender(raw: unknown, providerId?: string): Gender | undefined {
    const str = toOptString(raw);
    if (!str) return undefined;
    const v = str.toLowerCase();
    if (v === 'm' || v === 'male') return 'male';
    if (v === 'f' || v === 'female') return 'female';
    if (v === 'o' || v === 'other') return 'other';
    logger.warn({
      event: 'caqh_unknown_mapping',
      field: 'gender',
      rawValue: raw,
      providerId,
    });
    return undefined;
  }

  private mapV8Address(a: CaqhV8Address, providerId?: string): MappedProviderAddress | null {
    const line1 = toOptString(a.AddressLine1 ?? a.Address);
    const city = toOptString(a.City);
    const state = toOptString(a.State);
    const zip = toOptString(a.ZipCode ?? a.PostalCode);
    if (!line1 || !city || !state || !zip) {
      logger.warn({
        event: 'caqh_skip_address_incomplete',
        providerId,
        have: { line1: !!line1, city: !!city, state: !!state, zip: !!zip },
      });
      return null;
    }
    return {
      type: this.mapAddressType(a.AddressType),
      addressLine1: line1,
      addressLine2: toOptString(a.AddressLine2),
      city,
      state,
      zipCode: zip,
      country: toOptString(a.Country) ?? 'US',
    };
  }

  private mapAddressType(raw: unknown): AddressType {
    const str = toOptString(raw);
    if (!str) return 'home';
    const v = str.toLowerCase();
    if (v.includes('practice')) return 'practice';
    if (v.includes('mail')) return 'mailing';
    if (v.includes('bill')) return 'billing';
    return 'home';
  }

  private mapV8Identifier(i: CaqhV8Identifier, providerId?: string): MappedProviderIdentifier | null {
    const value = toOptString(i.IdentifierValue);
    if (!value) return null;
    const type = this.mapIdentifierType(i.IdentifierType, providerId);
    // Preserve CAQH's descriptive label so unknown-type identifiers don't lose meaning
    const description = toOptString(i.IdentifierType);
    return {
      identifierType: type,
      identifierValue: value,
      issuingEntity: toOptString(i.IssuingEntity),
      state: toOptString(i.State),
      effectiveDate: parseCaqhDate(i.EffectiveDate),
      expirationDate: parseCaqhDate(i.ExpirationDate),
      notes: type === 'OTHER' && description ? description : undefined,
    };
  }

  private mapIdentifierType(raw: unknown, providerId?: string): IdentifierType {
    const str = toOptString(raw);
    if (!str) return 'OTHER';
    const v = str.toUpperCase().replace(/[\s-]+/g, '_');
    const direct: Record<string, IdentifierType> = {
      MEDICARE_PTAN: 'MEDICARE_PTAN',
      PTAN: 'MEDICARE_PTAN',
      MEDICARE_PECOS_ID: 'MEDICARE_PECOS_ID',
      PECOS: 'MEDICARE_PECOS_ID',
      MEDICARE_PECOS: 'MEDICARE_PECOS_ID',
      MEDICAID: 'MEDICAID_ID',
      MEDICAID_ID: 'MEDICAID_ID',
      TRICARE: 'TRICARE_ID',
      TRICARE_ID: 'TRICARE_ID',
      RAILROAD_MEDICARE: 'RAILROAD_MEDICARE_ID',
      RAILROAD_MEDICARE_ID: 'RAILROAD_MEDICARE_ID',
      STATE_LICENSE: 'STATE_LICENSE_ID',
      STATE_LICENSE_ID: 'STATE_LICENSE_ID',
      PAYER: 'PAYER_SPECIFIC_ID',
      PAYER_SPECIFIC_ID: 'PAYER_SPECIFIC_ID',
      UPIN: 'UPIN',
      CDS: 'CDS',
      ACLS: 'ACLS',
      BLS: 'BLS',
      PALS: 'PALS',
      CPR: 'CPR',
    };
    // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn; `v` is derived from CAQH API payload
    const match = Object.hasOwn(direct, v) ? direct[v] : undefined;
    if (match) return match;
    logger.warn({
      event: 'caqh_unknown_mapping',
      field: 'identifierType',
      rawValue: raw,
      defaultedTo: 'OTHER',
      providerId,
    });
    return 'OTHER';
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

      // Persist raw response immediately — survives downstream mapper errors
      // so failed syncs can still be debugged against the actual CAQH payload.
      await prisma.providerCaqhMirror.upsert({
        where: { providerProfileId: providerId },
        create: {
          providerProfileId: providerId,
          rawJson: rawCaqhData as never,
          lastPulledAt: new Date(),
          syncStatus: 'pending',
        },
        update: {
          rawJson: rawCaqhData as never,
          lastPulledAt: new Date(),
          syncStatus: 'pending',
        },
      });

      let caqhData: MappedCaqhData;
      try {
        caqhData = this.mapCaqhToInternal(rawCaqhData, providerId);
      } catch (mapError) {
        logger.error({
          event: 'caqh_map_error',
          providerId,
          caqhProviderId,
          error: mapError instanceof Error ? mapError.message : 'Unknown map error',
          rawKeys: rawCaqhData && typeof rawCaqhData === 'object' ? Object.keys(rawCaqhData) : [],
        });
        await prisma.providerCaqhMirror.update({
          where: { providerProfileId: providerId },
          data: { syncStatus: 'failed' },
        });
        throw mapError;
      }
      await this.applyProviderCore(providerId, caqhData);
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

      await prisma.providerCaqhMirror.update({
        where: { providerProfileId: providerId },
        data: { syncStatus: 'success' },
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
   * Phase 1: persist CAQH provider-core demographics, addresses, and identifiers.
   * Fields already present on the ProviderProfile row are NOT overwritten if the
   * incoming CAQH value is blank/undefined — CAQH is additive, not authoritative,
   * for existing records.
   */
  async applyProviderCore(providerId: string, caqhData: MappedCaqhData): Promise<void> {
    const core = caqhData.provider;
    if (!core) return;

    const updateData: Record<string, unknown> = {};
    if (core.firstName) updateData['firstName'] = core.firstName;
    if (core.lastName) updateData['lastName'] = core.lastName;
    if (core.middleName !== undefined) updateData['middleName'] = core.middleName;
    if (core.suffix !== undefined) updateData['suffix'] = core.suffix;
    if (core.dateOfBirth) updateData['dateOfBirth'] = core.dateOfBirth;
    if (core.gender) updateData['gender'] = core.gender;
    if (core.ssn) updateData['ssnEncrypted'] = encryptSafe(core.ssn);
    if (core.primaryPracticeState) updateData['primaryPracticeState'] = core.primaryPracticeState;
    if (core.otherPracticeState) updateData['otherPracticeState'] = core.otherPracticeState;
    if (core.hospitalBasedFlag !== undefined) updateData['hospitalBasedFlag'] = core.hospitalBasedFlag;
    if (core.hospitalPrivilegeFlag !== undefined) updateData['hospitalPrivilegeFlag'] = core.hospitalPrivilegeFlag;
    if (core.fellowshipTrainingFlag !== undefined) updateData['fellowshipTrainingFlag'] = core.fellowshipTrainingFlag;
    if (core.secondarySpecialtyFlag !== undefined) updateData['secondarySpecialtyFlag'] = core.secondarySpecialtyFlag;
    if (core.activeMilitaryFlag !== undefined) updateData['activeMilitaryFlag'] = core.activeMilitaryFlag;
    if (core.workHistoryGapFlag !== undefined) updateData['workHistoryGapFlag'] = core.workHistoryGapFlag;
    if (core.acceptingMedicare !== undefined) updateData['acceptingMedicare'] = core.acceptingMedicare;
    if (core.acceptingMedicaid !== undefined) updateData['acceptingMedicaid'] = core.acceptingMedicaid;

    if (Object.keys(updateData).length > 0) {
      await prisma.providerProfile.update({
        where: { id: providerId },
        data: updateData,
      });
    }

    // Ethnicity → demographics table (upsert, single row per provider)
    if (core.ethnicity) {
      await prisma.providerDemographics.upsert({
        where: { providerId },
        create: { providerId, ethnicity: core.ethnicity },
        update: { ethnicity: core.ethnicity },
      });
    }

    // Addresses — match on type+line1+zip (CAQH is source of truth for non-manual)
    for (const addr of caqhData.addresses) {
      const existing = await prisma.providerAddress.findFirst({
        where: {
          providerId,
          type: addr.type,
          addressLine1: addr.addressLine1,
          zipCode: addr.zipCode,
        },
      });
      if (existing) {
        await prisma.providerAddress.update({
          where: { id: existing.id },
          data: {
            addressLine2: addr.addressLine2 ?? existing.addressLine2,
            city: addr.city,
            state: addr.state,
            country: addr.country ?? existing.country,
          },
        });
      } else {
        await prisma.providerAddress.create({
          data: {
            providerId,
            type: addr.type,
            addressLine1: addr.addressLine1,
            addressLine2: addr.addressLine2,
            city: addr.city,
            state: addr.state,
            zipCode: addr.zipCode,
            country: addr.country ?? 'US',
          },
        });
      }
    }

    // Identifiers — match on type + value
    for (const ident of caqhData.identifiers) {
      const existing = await prisma.providerIdentifier.findFirst({
        where: {
          providerId,
          identifierType: ident.identifierType,
          identifierValue: ident.identifierValue,
        },
      });
      if (existing) {
        await prisma.providerIdentifier.update({
          where: { id: existing.id },
          data: {
            issuingEntity: ident.issuingEntity ?? existing.issuingEntity,
            state: ident.state ?? existing.state,
            effectiveDate: ident.effectiveDate ?? existing.effectiveDate,
            expirationDate: ident.expirationDate ?? existing.expirationDate,
            notes: ident.notes ?? existing.notes,
          },
        });
      } else {
        await prisma.providerIdentifier.create({
          data: {
            providerId,
            identifierType: ident.identifierType,
            identifierValue: ident.identifierValue,
            issuingEntity: ident.issuingEntity,
            state: ident.state,
            effectiveDate: ident.effectiveDate,
            expirationDate: ident.expirationDate,
            notes: ident.notes,
          },
        });
      }
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
