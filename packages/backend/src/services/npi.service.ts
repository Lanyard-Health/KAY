import { logger } from '../utils/logger.js';

interface NPIAddress {
  address_1: string;
  address_2?: string;
  address_purpose: 'LOCATION' | 'MAILING';
  address_type: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  country_name: string;
  telephone_number?: string;
  fax_number?: string;
}

interface NPITaxonomy {
  code: string;
  desc: string;
  primary: boolean;
  state?: string;
  license?: string;
}

interface NPIBasic {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  name_prefix?: string;
  name_suffix?: string;
  credential?: string;
  sex?: string;
  enumeration_date?: string;
  last_updated?: string;
  status?: string;
  sole_proprietor?: string;
  // Organization fields
  organization_name?: string;
  organizational_subpart?: string;
  authorized_official_first_name?: string;
  authorized_official_last_name?: string;
  authorized_official_telephone_number?: string;
}

interface NPIResult {
  number: string;
  enumeration_type: 'NPI-1' | 'NPI-2';
  basic: NPIBasic;
  addresses: NPIAddress[];
  taxonomies?: NPITaxonomy[];
  identifiers?: Array<{
    code: string;
    desc: string;
    identifier: string;
    issuer?: string;
    state?: string;
  }>;
  other_names?: Array<{
    type: string;
    first_name?: string;
    last_name?: string;
    organization_name?: string;
  }>;
  endpoints?: Array<{
    endpoint_type: string;
    endpoint: string;
  }>;
}

interface NPIAPIResponse {
  result_count: number;
  results: NPIResult[];
}

export interface NPILookupResult {
  found: boolean;
  npi?: string;
  entityType?: 'individual' | 'organization';
  // Individual fields
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;
  credential?: string;
  gender?: string;
  // Organization fields
  organizationName?: string;
  authorizedOfficialName?: string;
  authorizedOfficialPhone?: string;
  // Common fields
  status?: string;
  enumerationDate?: string;
  lastUpdated?: string;
  // Primary taxonomy/specialty
  primaryTaxonomy?: {
    code: string;
    description: string;
    license?: string;
    state?: string;
  };
  allTaxonomies?: Array<{
    code: string;
    description: string;
    primary: boolean;
    license?: string;
    state?: string;
  }>;
  // Addresses
  practiceLocation?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    phone?: string;
    fax?: string;
  };
  mailingAddress?: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    phone?: string;
    fax?: string;
  };
  // Other identifiers
  otherIdentifiers?: Array<{
    type: string;
    identifier: string;
    issuer?: string;
    state?: string;
  }>;
  // Raw data for debugging
  raw?: NPIResult;
}

export class NPIService {
  private baseUrl = 'https://npiregistry.cms.hhs.gov/api/';

  async lookupByNPI(npiNumber: string): Promise<NPILookupResult> {
    // Validate NPI format (10 digits)
    if (!/^\d{10}$/.test(npiNumber)) {
      return { found: false };
    }

    try {
      const url = `${this.baseUrl}?version=2.1&number=${npiNumber}`;
      logger.info('Looking up NPI', { npi: npiNumber });

      const response = await fetch(url);

      if (!response.ok) {
        logger.error('NPI API returned non-OK status', { status: response.status });
        return { found: false };
      }

      const data = await response.json() as NPIAPIResponse;

      if (data.result_count === 0 || !data.results || data.results.length === 0) {
        logger.info('NPI not found', { npi: npiNumber });
        return { found: false };
      }

      const result = data.results[0]!;
      return this.parseNPIResult(result);
    } catch (error) {
      logger.error('NPI lookup failed:', error);
      return { found: false };
    }
  }

  // Organization (NPI-2) search for practices — the Add Practice modal's
  // "search by name" path. NPPES wildcard needs 2+ chars before the *.
  async searchOrganizations(name: string, state?: string): Promise<NPILookupResult[]> {
    if (name.trim().length < 2) return [];

    try {
      const params = new URLSearchParams({ version: '2.1' });
      params.append('organization_name', `${name.trim()}*`);
      params.append('enumeration_type', 'NPI-2');
      params.append('limit', '10');
      if (state) params.append('state', state);

      const url = `${this.baseUrl}?${params.toString()}`;
      logger.info('Searching NPI registry for organizations', { name, state });

      const response = await fetch(url);

      if (!response.ok) {
        logger.error(`NPI API returned ${response.status}`);
        return [];
      }

      const data = await response.json() as NPIAPIResponse;

      if (data.result_count === 0 || !data.results) {
        return [];
      }

      return data.results.slice(0, 10).map(r => this.parseNPIResult(r));
    } catch (error) {
      logger.error('NPI organization search failed:', error);
      return [];
    }
  }

  async searchByName(
    firstName?: string,
    lastName?: string,
    state?: string,
    city?: string
  ): Promise<NPILookupResult[]> {
    try {
      const params = new URLSearchParams({ version: '2.1' });

      if (firstName) params.append('first_name', firstName);
      if (lastName) params.append('last_name', lastName);
      if (state) params.append('state', state);
      if (city) params.append('city', city);
      params.append('enumeration_type', 'NPI-1'); // Individual providers only

      const url = `${this.baseUrl}?${params.toString()}`;
      logger.info('Searching NPI by name', { firstName, lastName, state, city });

      const response = await fetch(url);

      if (!response.ok) {
        logger.error(`NPI API returned ${response.status}`);
        return [];
      }

      const data = await response.json() as NPIAPIResponse;

      if (data.result_count === 0 || !data.results) {
        return [];
      }

      // Return up to 10 results
      return data.results.slice(0, 10).map(r => this.parseNPIResult(r));
    } catch (error) {
      logger.error('NPI search failed:', error);
      return [];
    }
  }

  private parseNPIResult(result: NPIResult): NPILookupResult {
    const isIndividual = result.enumeration_type === 'NPI-1';
    const basic = result.basic;

    // Find practice location and mailing address
    const practiceAddr = result.addresses.find(a => a.address_purpose === 'LOCATION');
    const mailingAddr = result.addresses.find(a => a.address_purpose === 'MAILING');

    // Find primary taxonomy
    const primaryTax = result.taxonomies?.find(t => t.primary);
    const allTaxonomies = result.taxonomies?.map(t => ({
      code: t.code,
      description: t.desc,
      primary: t.primary,
      license: t.license,
      state: t.state,
    }));

    // Parse other identifiers
    const otherIdentifiers = result.identifiers?.map(id => ({
      type: id.desc,
      identifier: id.identifier,
      issuer: id.issuer || undefined,
      state: id.state || undefined,
    }));

    // Format zip code (remove +4 suffix for consistency)
    const formatZip = (zip: string) => {
      if (!zip) return '';
      // Handle 9-digit zip codes
      if (zip.length === 9) {
        return zip.substring(0, 5);
      }
      return zip.replace(/-.*/, '');
    };

    // Clean up suffix (remove -- placeholder)
    const cleanSuffix = (suffix?: string) => {
      if (!suffix || suffix === '--') return undefined;
      return suffix;
    };

    // Map gender
    const mapGender = (sex?: string) => {
      if (sex === 'M') return 'male';
      if (sex === 'F') return 'female';
      return undefined;
    };

    const parsed: NPILookupResult = {
      found: true,
      npi: result.number,
      entityType: isIndividual ? 'individual' : 'organization',
      status: basic.status === 'A' ? 'Active' : 'Inactive',
      enumerationDate: basic.enumeration_date,
      lastUpdated: basic.last_updated,
    };

    if (isIndividual) {
      parsed.firstName = basic.first_name;
      parsed.lastName = basic.last_name;
      parsed.middleName = basic.middle_name;
      parsed.suffix = cleanSuffix(basic.name_suffix);
      parsed.credential = basic.credential;
      parsed.gender = mapGender(basic.sex);
    } else {
      parsed.organizationName = basic.organization_name;
      if (basic.authorized_official_first_name || basic.authorized_official_last_name) {
        parsed.authorizedOfficialName =
          `${basic.authorized_official_first_name || ''} ${basic.authorized_official_last_name || ''}`.trim();
      }
      parsed.authorizedOfficialPhone = basic.authorized_official_telephone_number;
    }

    if (primaryTax) {
      parsed.primaryTaxonomy = {
        code: primaryTax.code,
        description: primaryTax.desc,
        license: primaryTax.license,
        state: primaryTax.state,
      };
    }

    parsed.allTaxonomies = allTaxonomies;

    if (practiceAddr) {
      parsed.practiceLocation = {
        addressLine1: practiceAddr.address_1,
        addressLine2: practiceAddr.address_2,
        city: practiceAddr.city,
        state: practiceAddr.state,
        zipCode: formatZip(practiceAddr.postal_code),
        phone: practiceAddr.telephone_number,
        fax: practiceAddr.fax_number,
      };
    }

    if (mailingAddr) {
      parsed.mailingAddress = {
        addressLine1: mailingAddr.address_1,
        addressLine2: mailingAddr.address_2,
        city: mailingAddr.city,
        state: mailingAddr.state,
        zipCode: formatZip(mailingAddr.postal_code),
        phone: mailingAddr.telephone_number,
        fax: mailingAddr.fax_number,
      };
    }

    parsed.otherIdentifiers = otherIdentifiers;

    return parsed;
  }
}
