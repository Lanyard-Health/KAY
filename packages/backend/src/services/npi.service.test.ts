import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { NPIService } from './npi.service.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeNPIResponse(overrides: Partial<any> = {}, resultCount = 1) {
  const defaultResult = {
    number: '1234567890',
    enumeration_type: 'NPI-1',
    basic: {
      first_name: 'Jane',
      last_name: 'Doe',
      middle_name: 'M',
      name_suffix: 'MD',
      credential: 'MD',
      sex: 'F',
      status: 'A',
      enumeration_date: '2010-01-15',
      last_updated: '2024-06-01',
    },
    addresses: [
      {
        address_1: '123 Main St',
        address_2: 'Suite 100',
        address_purpose: 'LOCATION',
        city: 'Springfield',
        state: 'IL',
        postal_code: '62701',
        telephone_number: '217-555-1234',
        fax_number: '217-555-5678',
      },
      {
        address_1: 'PO Box 999',
        address_purpose: 'MAILING',
        city: 'Springfield',
        state: 'IL',
        postal_code: '62701',
      },
    ],
    taxonomies: [
      { code: '207Q00000X', desc: 'Family Medicine', primary: true, state: 'IL', license: 'MD-12345' },
      { code: '208000000X', desc: 'Pediatrics', primary: false },
    ],
    identifiers: [
      { code: '05', desc: 'Medicaid', identifier: 'MED-123', state: 'IL' },
    ],
    ...overrides,
  };

  return {
    ok: true,
    json: async () => ({
      result_count: resultCount,
      results: resultCount > 0 ? [defaultResult] : [],
    }),
  };
}

describe('NPIService', () => {
  let service: NPIService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new NPIService();
  });

  describe('lookupByNPI', () => {
    it('returns { found: false } for NPI shorter than 10 digits', async () => {
      const result = await service.lookupByNPI('123');
      expect(result).toEqual({ found: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { found: false } for NPI with non-digit characters', async () => {
      const result = await service.lookupByNPI('abcdefghij');
      expect(result).toEqual({ found: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { found: false } for empty string NPI', async () => {
      const result = await service.lookupByNPI('');
      expect(result).toEqual({ found: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns { found: false } when API returns non-ok status', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await service.lookupByNPI('1234567890');
      expect(result).toEqual({ found: false });
    });

    it('returns { found: false } when result_count is 0', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse({}, 0));

      const result = await service.lookupByNPI('1234567890');
      expect(result).toEqual({ found: false });
    });

    it('returns { found: false } when fetch throws an error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.lookupByNPI('1234567890');
      expect(result).toEqual({ found: false });
    });

    it('parses individual provider (NPI-1) correctly', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse({
        basic: {
          first_name: 'John',
          last_name: 'Smith',
          middle_name: 'A',
          name_suffix: 'Jr',
          credential: 'DO',
          sex: 'M',
          status: 'A',
          enumeration_date: '2008-05-20',
          last_updated: '2023-11-15',
        },
      }));

      const result = await service.lookupByNPI('1234567890');

      expect(result.found).toBe(true);
      expect(result.entityType).toBe('individual');
      expect(result.npi).toBe('1234567890');
      expect(result.firstName).toBe('John');
      expect(result.lastName).toBe('Smith');
      expect(result.middleName).toBe('A');
      expect(result.suffix).toBe('Jr');
      expect(result.credential).toBe('DO');
      expect(result.gender).toBe('male');
      expect(result.status).toBe('Active');
      expect(result.enumerationDate).toBe('2008-05-20');
      expect(result.lastUpdated).toBe('2023-11-15');

      // Practice location
      expect(result.practiceLocation).toEqual({
        addressLine1: '123 Main St',
        addressLine2: 'Suite 100',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62701',
        phone: '217-555-1234',
        fax: '217-555-5678',
      });

      // Mailing address
      expect(result.mailingAddress).toEqual({
        addressLine1: 'PO Box 999',
        addressLine2: undefined,
        city: 'Springfield',
        state: 'IL',
        zipCode: '62701',
        phone: undefined,
        fax: undefined,
      });

      // Primary taxonomy
      expect(result.primaryTaxonomy).toEqual({
        code: '207Q00000X',
        description: 'Family Medicine',
        license: 'MD-12345',
        state: 'IL',
      });

      // All taxonomies
      expect(result.allTaxonomies).toHaveLength(2);
      expect(result.allTaxonomies![0]).toEqual({
        code: '207Q00000X',
        description: 'Family Medicine',
        primary: true,
        license: 'MD-12345',
        state: 'IL',
      });
      expect(result.allTaxonomies![1]).toEqual({
        code: '208000000X',
        description: 'Pediatrics',
        primary: false,
        license: undefined,
        state: undefined,
      });

      // Other identifiers
      expect(result.otherIdentifiers).toEqual([
        { type: 'Medicaid', identifier: 'MED-123', issuer: undefined, state: 'IL' },
      ]);
    });

    it('parses organization (NPI-2) correctly', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse({
        enumeration_type: 'NPI-2',
        basic: {
          organization_name: 'Springfield Medical Group',
          authorized_official_first_name: 'Robert',
          authorized_official_last_name: 'Jones',
          authorized_official_telephone_number: '217-555-9999',
          status: 'A',
          enumeration_date: '2005-03-10',
          last_updated: '2024-01-01',
        },
      }));

      const result = await service.lookupByNPI('1234567890');

      expect(result.found).toBe(true);
      expect(result.entityType).toBe('organization');
      expect(result.organizationName).toBe('Springfield Medical Group');
      expect(result.authorizedOfficialName).toBe('Robert Jones');
      expect(result.authorizedOfficialPhone).toBe('217-555-9999');
      expect(result.firstName).toBeUndefined();
      expect(result.lastName).toBeUndefined();
      expect(result.gender).toBeUndefined();
    });

    it('cleans "--" suffix to undefined', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse({
        basic: {
          first_name: 'Jane',
          last_name: 'Doe',
          name_suffix: '--',
          sex: 'F',
          status: 'A',
        },
      }));

      const result = await service.lookupByNPI('1234567890');
      expect(result.suffix).toBeUndefined();
    });

    it('cleans 9-digit zip code to 5 digits', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse({
        addresses: [
          {
            address_1: '123 Main St',
            address_purpose: 'LOCATION',
            city: 'Springfield',
            state: 'IL',
            postal_code: '123456789',
          },
        ],
      }));

      const result = await service.lookupByNPI('1234567890');
      expect(result.practiceLocation!.zipCode).toBe('12345');
    });

    it('cleans zip code with dash format to 5 digits', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse({
        addresses: [
          {
            address_1: '456 Oak Ave',
            address_purpose: 'LOCATION',
            city: 'Chicago',
            state: 'IL',
            postal_code: '12345-6789',
          },
        ],
      }));

      const result = await service.lookupByNPI('1234567890');
      expect(result.practiceLocation!.zipCode).toBe('12345');
    });

    it('maps gender "F" to "female"', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse());

      const result = await service.lookupByNPI('1234567890');
      expect(result.gender).toBe('female');
    });

    it('maps undefined gender to undefined', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse({
        basic: {
          first_name: 'Pat',
          last_name: 'Smith',
          status: 'A',
        },
      }));

      const result = await service.lookupByNPI('1234567890');
      expect(result.gender).toBeUndefined();
    });

    it('maps status "A" to "Active" and non-A to "Inactive"', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse({
        basic: {
          first_name: 'Jane',
          last_name: 'Doe',
          status: 'D',
        },
      }));

      const result = await service.lookupByNPI('1234567890');
      expect(result.status).toBe('Inactive');
    });

    it('calls the correct API URL with version and NPI number', async () => {
      mockFetch.mockResolvedValueOnce(makeNPIResponse());

      await service.lookupByNPI('9876543210');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://npiregistry.cms.hhs.gov/api/?version=2.1&number=9876543210'
      );
    });
  });

  describe('searchByName', () => {
    it('returns empty array when no results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result_count: 0, results: [] }),
      });

      const result = await service.searchByName('John', 'Doe');
      expect(result).toEqual([]);
    });

    it('returns up to 10 results when API returns more', async () => {
      const results = Array.from({ length: 15 }, (_, i) => ({
        number: `100000000${i}`,
        enumeration_type: 'NPI-1',
        basic: {
          first_name: 'Provider',
          last_name: `Test${i}`,
          status: 'A',
        },
        addresses: [],
        taxonomies: [],
        identifiers: [],
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result_count: 15, results }),
      });

      const result = await service.searchByName('Provider', 'Test');
      expect(result).toHaveLength(10);
    });

    it('passes search params correctly to URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result_count: 0, results: [] }),
      });

      await service.searchByName('John', 'Doe', 'IL', 'Chicago');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;

      expect(calledUrl).toContain('version=2.1');
      expect(calledUrl).toContain('first_name=John');
      expect(calledUrl).toContain('last_name=Doe');
      expect(calledUrl).toContain('state=IL');
      expect(calledUrl).toContain('city=Chicago');
      expect(calledUrl).toContain('enumeration_type=NPI-1');
      expect(calledUrl.startsWith('https://npiregistry.cms.hhs.gov/api/?')).toBe(true);
    });

    it('omits undefined params from URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result_count: 0, results: [] }),
      });

      await service.searchByName(undefined, 'Doe');

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('first_name');
      expect(calledUrl).toContain('last_name=Doe');
      expect(calledUrl).not.toContain('state');
      expect(calledUrl).not.toContain('city');
    });

    it('returns empty array on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.searchByName('John', 'Doe');
      expect(result).toEqual([]);
    });

    it('returns empty array when API returns non-ok status', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const result = await service.searchByName('John', 'Doe');
      expect(result).toEqual([]);
    });
  });
});
