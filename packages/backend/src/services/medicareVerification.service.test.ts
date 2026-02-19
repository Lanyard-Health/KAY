import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { mockProvider } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock PECOSService - IMPORTANT: vi.fn() used as constructor MUST use function() not arrow
const mockLookupByNPI = vi.fn();
vi.mock('./pecos.service.js', () => ({
  PECOSService: vi.fn().mockImplementation(function () {
    return { lookupByNPI: mockLookupByNPI, batchLookup: vi.fn() };
  }),
}));

// Mock logger to suppress output during tests
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import after mocks are set up
const { verifyProvider, verifyProviderBatch } = await import(
  './medicareVerification.service.js'
);

describe('medicareVerification.service', () => {
  beforeEach(() => {
    mockLookupByNPI.mockReset();
  });

  describe('verifyProvider', () => {
    it('upserts ENROLLED when CMS finds provider', async () => {
      const cmsResult = {
        found: true,
        npi: '1234567890',
        pacId: 'PAC-12345',
        enrollments: [
          { enrollmentId: 'I20091005000100', enrollmentDate: '2009-10-05', providerTypeCode: '20', providerTypeDesc: 'Psychiatry', state: 'CA' },
          { enrollmentId: 'I20101005000200', enrollmentDate: '2010-10-05', providerTypeCode: '20', providerTypeDesc: 'Psychiatry', state: 'NY' },
        ],
        verifiedAt: new Date().toISOString(),
      };

      prismaMock.provider.findUnique.mockResolvedValue({ id: mockProvider.id, npi: mockProvider.npi } as any);
      mockLookupByNPI.mockResolvedValue(cmsResult);

      const upsertedRecord = {
        id: 'mv-1',
        providerId: mockProvider.id,
        status: 'ENROLLED',
        verifiedAt: expect.any(Date),
        npi: '1234567890',
        pacId: 'PAC-12345',
        enrollmentCount: 2,
        enrollmentStates: ['CA', 'NY'],
        rawData: cmsResult,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.medicareVerification.upsert.mockResolvedValue(upsertedRecord as any);

      const result = await verifyProvider(mockProvider.id);

      expect(prismaMock.provider.findUnique).toHaveBeenCalledWith({
        where: { id: mockProvider.id },
        select: { npi: true },
      });
      expect(mockLookupByNPI).toHaveBeenCalledWith('1234567890');
      expect(prismaMock.medicareVerification.upsert).toHaveBeenCalledWith({
        where: { providerId: mockProvider.id },
        create: expect.objectContaining({
          providerId: mockProvider.id,
          status: 'ENROLLED',
          npi: '1234567890',
          pacId: 'PAC-12345',
          enrollmentCount: 2,
          enrollmentStates: ['CA', 'NY'],
        }),
        update: expect.objectContaining({
          status: 'ENROLLED',
          npi: '1234567890',
          pacId: 'PAC-12345',
          enrollmentCount: 2,
          enrollmentStates: ['CA', 'NY'],
        }),
      });
      expect(result).toEqual(upsertedRecord);
    });

    it('upserts NOT_ENROLLED when CMS does not find provider', async () => {
      const cmsResult = { found: false };

      prismaMock.provider.findUnique.mockResolvedValue({ id: mockProvider.id, npi: mockProvider.npi } as any);
      mockLookupByNPI.mockResolvedValue(cmsResult);

      const upsertedRecord = {
        id: 'mv-2',
        providerId: mockProvider.id,
        status: 'NOT_ENROLLED',
        verifiedAt: expect.any(Date),
        npi: '1234567890',
        pacId: null,
        enrollmentCount: 0,
        enrollmentStates: [],
        rawData: cmsResult,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.medicareVerification.upsert.mockResolvedValue(upsertedRecord as any);

      const result = await verifyProvider(mockProvider.id);

      expect(prismaMock.medicareVerification.upsert).toHaveBeenCalledWith({
        where: { providerId: mockProvider.id },
        create: expect.objectContaining({
          status: 'NOT_ENROLLED',
          enrollmentCount: 0,
          enrollmentStates: [],
        }),
        update: expect.objectContaining({
          status: 'NOT_ENROLLED',
          enrollmentCount: 0,
          enrollmentStates: [],
        }),
      });
      expect(result).toEqual(upsertedRecord);
    });

    it('throws when provider not found in DB', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      await expect(verifyProvider('non-existent-id')).rejects.toThrow('Provider not found');
      expect(mockLookupByNPI).not.toHaveBeenCalled();
    });

    it('throws when provider has no NPI', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({ id: mockProvider.id, npi: null } as any);

      await expect(verifyProvider(mockProvider.id)).rejects.toThrow('Provider has no NPI');
      expect(mockLookupByNPI).not.toHaveBeenCalled();
    });
  });

  describe('verifyProviderBatch', () => {
    it('verifies multiple providers and returns correct summary counts', async () => {
      const providers = [
        { id: 'p1', npi: '1111111111' },
        { id: 'p2', npi: '2222222222' },
        { id: 'p3', npi: '3333333333' },
        { id: 'p4', npi: null }, // no NPI — will be an error
      ];

      prismaMock.provider.findMany.mockResolvedValue(providers as any);

      // p1: enrolled
      mockLookupByNPI.mockImplementation(async (npi: string) => {
        if (npi === '1111111111') {
          return {
            found: true,
            npi: '1111111111',
            pacId: 'PAC-1',
            enrollments: [{ state: 'CA' }],
          };
        }
        if (npi === '2222222222') {
          return { found: false };
        }
        if (npi === '3333333333') {
          throw new Error('CMS API timeout');
        }
        return { found: false };
      });

      // Allow upsert to return a value for successful calls
      prismaMock.medicareVerification.upsert.mockResolvedValue({} as any);

      const result = await verifyProviderBatch(['p1', 'p2', 'p3', 'p4']);

      expect(prismaMock.provider.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['p1', 'p2', 'p3', 'p4'] } },
        select: { id: true, npi: true },
      });

      // p1 enrolled, p2 not enrolled, p3 CMS error, p4 no NPI
      expect(result).toEqual({
        verified: 2,
        enrolled: 1,
        notEnrolled: 1,
        errors: 2,
      });
    });
  });
});
