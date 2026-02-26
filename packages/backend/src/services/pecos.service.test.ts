import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { PECOSService } from './pecos.service.js';

const enrollmentDatasetUUID = '2457ea29-fc82-48b0-86ec-3b0755de7515';
const orderReferDatasetUUID = 'c99b5865-1119-4436-bb80-c5af2773ea1f';

const mockEnrollmentRecords = [
  {
    NPI: '1234567890',
    PECOS_ASCT_CNTL_ID: 'PAC123',
    FIRST_NAME: 'JOHN',
    LAST_NAME: 'DOE',
    MDL_NAME: 'A',
    ORG_NAME: null,
    MULTIPLE_NPI_FLAG: 'N',
    ENRLMT_ID: 'I20150301000100',
    PROVIDER_TYPE_CD: '14',
    PROVIDER_TYPE_DESC: 'Clinical Psychologist',
    STATE_CD: 'TX',
  },
  {
    NPI: '1234567890',
    PECOS_ASCT_CNTL_ID: 'PAC123',
    FIRST_NAME: 'JOHN',
    LAST_NAME: 'DOE',
    MDL_NAME: 'A',
    ORG_NAME: null,
    MULTIPLE_NPI_FLAG: 'N',
    ENRLMT_ID: 'I20091005000100',
    PROVIDER_TYPE_CD: '14',
    PROVIDER_TYPE_DESC: 'Clinical Psychologist',
    STATE_CD: 'CA',
  },
];

const mockOrderingData = [
  {
    NPI: '1234567890',
    PARTB: 'Y',
    DME: 'N',
    HHA: 'Y',
    PMD: 'N',
    HOSPICE: 'N',
  },
];

function setupSuccessMocks(
  enrollmentRecords: any[] = mockEnrollmentRecords,
  orderingRecords: any[] = mockOrderingData,
) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes(enrollmentDatasetUUID)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(enrollmentRecords),
      });
    }
    if (url.includes(orderReferDatasetUUID)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(orderingRecords),
      });
    }
    return Promise.resolve({ ok: false });
  });
}

describe('PECOSService', () => {
  let service: PECOSService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new PECOSService();
  });

  describe('parseEnrollmentDate (tested via lookupByNPI)', () => {
    it('parses normal enrollment ID "I20091005000100" to "2009-10-05"', async () => {
      setupSuccessMocks();
      const result = await service.lookupByNPI('1234567890');
      // Enrollments are sorted oldest first, so 2009 is first
      expect(result.enrollments![0].enrollmentDate).toBe('2009-10-05');
      expect(result.enrollments![1].enrollmentDate).toBe('2015-03-01');
    });

    it('returns empty string for short/null enrollment IDs', async () => {
      const records = [
        {
          NPI: '1234567890',
          PECOS_ASCT_CNTL_ID: 'PAC123',
          FIRST_NAME: 'JOHN',
          LAST_NAME: 'DOE',
          MDL_NAME: null,
          ORG_NAME: null,
          MULTIPLE_NPI_FLAG: 'N',
          ENRLMT_ID: 'I2009',
          PROVIDER_TYPE_CD: '14',
          PROVIDER_TYPE_DESC: 'Clinical Psychologist',
          STATE_CD: 'TX',
        },
      ];
      setupSuccessMocks(records, []);
      const result = await service.lookupByNPI('1234567890');
      expect(result.enrollments![0].enrollmentDate).toBe('');
    });
  });

  describe('lookupByNPI', () => {
    it('returns correct result on success', async () => {
      setupSuccessMocks();
      const result = await service.lookupByNPI('1234567890');

      expect(result.found).toBe(true);
      expect(result.npi).toBe('1234567890');
      expect(result.pacId).toBe('PAC123');
      expect(result.firstName).toBe('JOHN');
      expect(result.lastName).toBe('DOE');
      expect(result.middleName).toBe('A');
      expect(result.organizationName).toBeUndefined();
      expect(result.multipleNpiFlag).toBe(false);
      expect(result.verifiedAt).toBeDefined();
    });

    it('sorts enrollments by date, oldest first', async () => {
      setupSuccessMocks();
      const result = await service.lookupByNPI('1234567890');
      expect(result.enrollments).toHaveLength(2);
      expect(result.enrollments![0].enrollmentDate).toBe('2009-10-05');
      expect(result.enrollments![0].state).toBe('CA');
      expect(result.enrollments![1].enrollmentDate).toBe('2015-03-01');
      expect(result.enrollments![1].state).toBe('TX');
    });

    it('sets primaryEnrollment to the oldest enrollment', async () => {
      setupSuccessMocks();
      const result = await service.lookupByNPI('1234567890');
      expect(result.primaryEnrollment).toEqual(result.enrollments![0]);
      expect(result.primaryEnrollment!.enrollmentDate).toBe('2009-10-05');
    });

    it('maps ordering privileges correctly (Y→true, N→false)', async () => {
      setupSuccessMocks();
      const result = await service.lookupByNPI('1234567890');
      expect(result.orderingPrivileges).toEqual({
        partB: true,
        dme: false,
        hha: true,
        pmd: false,
        hospice: false,
      });
    });

    it('returns {found: false} when no enrollment data', async () => {
      setupSuccessMocks([], mockOrderingData);
      const result = await service.lookupByNPI('0000000000');
      expect(result).toEqual({ found: false });
    });

    it('returns found:false when both fetches fail (errors caught internally)', async () => {
      // fetchEnrollmentData and fetchOrderingPrivileges catch errors and return null
      mockFetch.mockRejectedValue(new Error('Network error'));
      const result = await service.lookupByNPI('1234567890');
      expect(result).toEqual({ found: false });
    });

    it('throws when an unexpected error occurs in lookupByNPI', async () => {
      // Spy on Promise.all to force an error inside lookupByNPI's try block
      // but outside the individual fetch helpers' try/catch
      const origAll = Promise.all.bind(Promise);
      vi.spyOn(Promise, 'all').mockImplementationOnce(() => {
        return origAll([Promise.reject(new Error('Unexpected'))]);
      });
      await expect(service.lookupByNPI('1234567890')).rejects.toThrow(
        'Failed to lookup Medicare enrollment status',
      );
    });

    it('maps multipleNpiFlag Y to true', async () => {
      const records = [
        {
          ...mockEnrollmentRecords[0],
          MULTIPLE_NPI_FLAG: 'Y',
        },
      ];
      setupSuccessMocks(records, []);
      const result = await service.lookupByNPI('1234567890');
      expect(result.multipleNpiFlag).toBe(true);
    });

    it('maps organizationName when present', async () => {
      const records = [
        {
          ...mockEnrollmentRecords[0],
          ORG_NAME: 'Test Org',
        },
      ];
      setupSuccessMocks(records, []);
      const result = await service.lookupByNPI('1234567890');
      expect(result.organizationName).toBe('Test Org');
    });
  });

  describe('fetchEnrollmentData (via lookupByNPI)', () => {
    it('filters to exact NPI match', async () => {
      const mixedRecords = [
        ...mockEnrollmentRecords,
        {
          NPI: '9999999999',
          PECOS_ASCT_CNTL_ID: 'PAC999',
          FIRST_NAME: 'JANE',
          LAST_NAME: 'SMITH',
          MDL_NAME: null,
          ORG_NAME: null,
          MULTIPLE_NPI_FLAG: 'N',
          ENRLMT_ID: 'I20200101000100',
          PROVIDER_TYPE_CD: '20',
          PROVIDER_TYPE_DESC: 'Physical Therapist',
          STATE_CD: 'NY',
        },
      ];
      setupSuccessMocks(mixedRecords, mockOrderingData);
      const result = await service.lookupByNPI('1234567890');
      expect(result.enrollments).toHaveLength(2);
      expect(result.enrollments!.every((e) => e.state !== 'NY')).toBe(true);
    });

    it('returns found:false when enrollment fetch returns non-ok', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes(enrollmentDatasetUUID)) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        if (url.includes(orderReferDatasetUUID)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockOrderingData),
          });
        }
        return Promise.resolve({ ok: false });
      });
      const result = await service.lookupByNPI('1234567890');
      expect(result).toEqual({ found: false });
    });
  });

  describe('fetchOrderingPrivileges', () => {
    it('returns no orderingPrivileges when ordering fetch errors', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes(enrollmentDatasetUUID)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockEnrollmentRecords),
          });
        }
        if (url.includes(orderReferDatasetUUID)) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({ ok: false });
      });
      const result = await service.lookupByNPI('1234567890');
      expect(result.found).toBe(true);
      expect(result.orderingPrivileges).toBeUndefined();
    });

    it('returns no orderingPrivileges when ordering fetch returns non-ok', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes(enrollmentDatasetUUID)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockEnrollmentRecords),
          });
        }
        if (url.includes(orderReferDatasetUUID)) {
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.resolve({ ok: false });
      });
      const result = await service.lookupByNPI('1234567890');
      expect(result.found).toBe(true);
      expect(result.orderingPrivileges).toBeUndefined();
    });
  });

  describe('isEnrolledInMedicare', () => {
    it('returns true when found with enrollments', async () => {
      setupSuccessMocks();
      const enrolled = await service.isEnrolledInMedicare('1234567890');
      expect(enrolled).toBe(true);
    });

    it('returns false when not found', async () => {
      setupSuccessMocks([], []);
      const enrolled = await service.isEnrolledInMedicare('0000000000');
      expect(enrolled).toBe(false);
    });
  });

  describe('getEnrollmentStates', () => {
    it('returns unique states', async () => {
      setupSuccessMocks();
      const states = await service.getEnrollmentStates('1234567890');
      expect(states).toEqual(expect.arrayContaining(['CA', 'TX']));
      expect(states).toHaveLength(2);
    });

    it('returns empty array when not found', async () => {
      setupSuccessMocks([], []);
      const states = await service.getEnrollmentStates('0000000000');
      expect(states).toEqual([]);
    });

    it('deduplicates states', async () => {
      const records = [
        { ...mockEnrollmentRecords[0], STATE_CD: 'TX' },
        { ...mockEnrollmentRecords[1], STATE_CD: 'TX' },
      ];
      setupSuccessMocks(records, []);
      const states = await service.getEnrollmentStates('1234567890');
      expect(states).toEqual(['TX']);
    });
  });

  describe('getSpecialties', () => {
    it('returns unique specialties', async () => {
      const records = [
        { ...mockEnrollmentRecords[0], PROVIDER_TYPE_DESC: 'Clinical Psychologist' },
        { ...mockEnrollmentRecords[1], PROVIDER_TYPE_DESC: 'Licensed Clinical Social Worker' },
      ];
      setupSuccessMocks(records, []);
      const specialties = await service.getSpecialties('1234567890');
      expect(specialties).toHaveLength(2);
      expect(specialties).toEqual(
        expect.arrayContaining(['Clinical Psychologist', 'Licensed Clinical Social Worker']),
      );
    });

    it('returns empty array when not found', async () => {
      setupSuccessMocks([], []);
      const specialties = await service.getSpecialties('0000000000');
      expect(specialties).toEqual([]);
    });

    it('deduplicates specialties', async () => {
      setupSuccessMocks();
      const specialties = await service.getSpecialties('1234567890');
      // Both records have 'Clinical Psychologist'
      expect(specialties).toEqual(['Clinical Psychologist']);
    });
  });

  describe('batchLookup', () => {
    it('processes multiple NPIs and returns a Map', async () => {
      setupSuccessMocks();
      const npis = ['1234567890', '1234567891'];
      const results = await service.batchLookup(npis);
      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(2);
      expect(results.has('1234567890')).toBe(true);
      expect(results.has('1234567891')).toBe(true);
    });

    it('respects concurrency limit of 5 (processes in batches)', async () => {
      setupSuccessMocks();
      const npis = ['1', '2', '3', '4', '5', '6', '7'];
      const results = await service.batchLookup(npis);
      expect(results.size).toBe(7);
      // With 7 NPIs and batch size 5, there should be 2 batches
      // Each NPI triggers 2 fetch calls (enrollment + ordering)
      // Total = 7 NPIs * 2 calls = 14 fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(14);
    });

    it('returns empty Map for empty input', async () => {
      const results = await service.batchLookup([]);
      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(0);
    });
  });
});
