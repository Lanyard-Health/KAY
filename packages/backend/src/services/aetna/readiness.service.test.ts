import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { checkAetnaReadiness } from './readiness.service.js';
import { prismaMock } from '../../../tests/helpers/mock-prisma.js';

function makeFullProvider() {
  return {
    id: 'provider-1',
    npi: '1234567890',
    firstName: 'Jane',
    lastName: 'Doe',
    middleName: 'M',
    dateOfBirth: new Date(1980, 4, 15),
    gender: 'female',
    email: 'jane@test.com',
    phone: '555-123-4567',
    fax: '555-123-4568',
    providerType: 'psychiatrist',
    specialties: ['Psychiatry'],
    languages: ['English'],
    caqhProviderId: 'CAQH-12345',
    acceptingMedicare: true,
    acceptingMedicaid: false,
    ePrescribing: true,
    practiceId: 'practice-1',
    practice: { id: 'practice-1', name: 'Test Practice', phone: '555-999-0000', email: 'office@test.com', website: 'https://test.com' },
    practiceLocations: [{
      isPrimary: true,
      isActive: true,
      addressLine1: '123 Main St',
      addressLine2: null,
      city: 'Hartford',
      state: 'CT',
      zipCode: '06101',
      county: 'Hartford',
      phone: '555-111-2222',
      fax: '555-111-2223',
      taxIdEncrypted: '12-3456789',
      groupNpi: '9876543210',
      acceptingNewPatients: true,
      languagesSpoken: ['English'],
      officeHours: null,
      billingAddressLine1: null,
      billingCity: null,
      billingState: null,
      billingZipCode: null,
    }],
    licenses: [{ licenseType: 'state_medical', licenseNumber: 'MD-12345', state: 'CT', expirationDate: new Date('2027-12-31'), status: 'active' }],
    educations: [{ degree: 'md', educationType: 'MEDICAL_SCHOOL' }],
    hospitalAffiliations: [{ facilityName: 'Hartford Hospital', privilegeType: 'admitting', status: 'active' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkAetnaReadiness', () => {
  it('returns ready=true when all required fields are present', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(makeFullProvider() as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(true);
    expect(result.pages.every(p => p.ready)).toBe(true);
  });

  it('returns ready=false when NPI is missing', async () => {
    const provider = makeFullProvider();
    provider.npi = '';
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page2 = result.pages.find(p => p.page === 2)!;
    expect(page2.ready).toBe(false);
    expect(page2.missing.some(m => m.field === 'npi')).toBe(true);
  });

  it('returns ready=false when primary location is missing', async () => {
    const provider = makeFullProvider();
    provider.practiceLocations = [];
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page7 = result.pages.find(p => p.page === 7)!;
    expect(page7.ready).toBe(false);
  });

  it('returns ready=false when no active license exists', async () => {
    const provider = makeFullProvider();
    provider.licenses = [];
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page5 = result.pages.find(p => p.page === 5)!;
    expect(page5.missing.some(m => m.field === 'medicalLicenseNumber')).toBe(true);
  });

  it('returns ready=false when CAQH ID is missing', async () => {
    const provider = makeFullProvider();
    provider.caqhProviderId = null;
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page5 = result.pages.find(p => p.page === 5)!;
    expect(page5.missing.some(m => m.field === 'caqhID')).toBe(true);
  });

  it('returns ready=false when tax ID is missing from primary location', async () => {
    const provider = makeFullProvider();
    provider.practiceLocations[0]!.taxIdEncrypted = null;
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page3 = result.pages.find(p => p.page === 3)!;
    expect(page3.missing.some(m => m.field === 'taxID')).toBe(true);
  });

  it('returns ready=false when education/degree is missing', async () => {
    const provider = makeFullProvider();
    provider.educations = [];
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    expect(result.ready).toBe(false);
    const page4 = result.pages.find(p => p.page === 4)!;
    expect(page4.missing.some(m => m.field === 'degreeType')).toBe(true);
  });

  it('includes fixPath for each missing field', async () => {
    const provider = makeFullProvider();
    provider.caqhProviderId = null;
    prismaMock.provider.findUnique.mockResolvedValue(provider as any);

    const result = await checkAetnaReadiness('provider-1');

    const missing = result.pages.flatMap(p => p.missing);
    const caqhMissing = missing.find(m => m.field === 'caqhID');
    expect(caqhMissing?.fixPath).toContain('/providers/provider-1');
  });

  it('throws when provider not found', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(null);

    await expect(checkAetnaReadiness('nonexistent')).rejects.toThrow('Provider not found');
  });
});
