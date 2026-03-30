import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { generateTerminationLetter, maskTaxId } from './terminationLetter.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  mockProviderForTermination,
  mockPrimaryLocation,
  mockEnrollment1,
  mockDraftLetterTask,
} from '../../tests/helpers/termination-fixtures.js';

const PROVIDER_ID = mockProviderForTermination.id;
const ENROLLMENT_ID = mockEnrollment1.id;
const TASK_ID = mockDraftLetterTask.id;

describe('maskTaxId', () => {
  it('masks EIN format (XX-XXXXXXX)', () => {
    expect(maskTaxId('12-3456789')).toBe('XX-XXX6789');
  });

  it('masks EIN without dash', () => {
    expect(maskTaxId('123456789')).toBe('XX-XXX6789');
  });

  it('masks SSN format (XXX-XX-XXXX)', () => {
    expect(maskTaxId('123-45-6789')).toBe('***-**-6789');
  });

  it('handles short values with fallback', () => {
    expect(maskTaxId('123')).toBe('****');
  });

  it('masks arbitrary length with last 4 visible', () => {
    expect(maskTaxId('1234567')).toBe('***4567');
  });
});

describe('generateTerminationLetter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates letter with correct provider name, NPI, and group NPI', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(mockProviderForTermination as any);
    prismaMock.practiceLocation.findFirst.mockResolvedValue(mockPrimaryLocation as any);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment1 as any);
    prismaMock.terminationLetter.create.mockImplementation((args: any) => Promise.resolve({
      id: 'new-letter-id',
      ...args.data,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await generateTerminationLetter(PROVIDER_ID, ENROLLMENT_ID, TASK_ID);

    const createCall = prismaMock.terminationLetter.create.mock.calls[0]![0] as any;
    const data = createCall.data;

    expect(data.providerName).toBe('Sheree Ann Mitchell MD');
    expect(data.npi).toBe('9876543210');
    expect(data.groupNpi).toBe('1112223334');
    expect(data.payerName).toBe('Blue Cross Blue Shield');
  });

  it('masks Tax ID in the saved letter (only last 4 visible)', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(mockProviderForTermination as any);
    prismaMock.practiceLocation.findFirst.mockResolvedValue(mockPrimaryLocation as any);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment1 as any);
    prismaMock.terminationLetter.create.mockImplementation((args: any) => Promise.resolve({
      id: 'new-letter-id',
      ...args.data,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await generateTerminationLetter(PROVIDER_ID, ENROLLMENT_ID, TASK_ID);

    const createCall = prismaMock.terminationLetter.create.mock.calls[0]![0] as any;
    // taxIdEncrypted stores the masked value (plaintext in test — no ENCRYPTION_KEY)
    expect(createCall.data.taxIdEncrypted).toBe('XX-XXX6789');
    // Letter content should also contain the masked version
    expect(createCall.data.letterContent).toContain('XX-XXX6789');
    expect(createCall.data.letterContent).not.toContain('12-3456789');
  });

  it('includes effective and termination dates in letter content', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(mockProviderForTermination as any);
    prismaMock.practiceLocation.findFirst.mockResolvedValue(mockPrimaryLocation as any);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment1 as any);
    prismaMock.terminationLetter.create.mockImplementation((args: any) => Promise.resolve({
      id: 'new-letter-id',
      ...args.data,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await generateTerminationLetter(PROVIDER_ID, ENROLLMENT_ID, TASK_ID);

    const createCall = prismaMock.terminationLetter.create.mock.calls[0]![0] as any;
    const content = createCall.data.letterContent;

    // effectiveDate: 2023-01-15T12:00:00Z → "January 15, 2023"
    expect(content).toContain('January 15, 2023');
    // terminationDate: 2026-03-15T12:00:00Z → "March 15, 2026"
    expect(content).toContain('March 15, 2026');
  });

  it('creates letter with correct provider/task/payer references', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(mockProviderForTermination as any);
    prismaMock.practiceLocation.findFirst.mockResolvedValue(mockPrimaryLocation as any);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment1 as any);
    prismaMock.terminationLetter.create.mockImplementation((args: any) => Promise.resolve({
      id: 'new-letter-id',
      ...args.data,
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await generateTerminationLetter(PROVIDER_ID, ENROLLMENT_ID, TASK_ID);

    expect(prismaMock.terminationLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: PROVIDER_ID,
          taskId: TASK_ID,
          payerName: 'Blue Cross Blue Shield',
        }),
      })
    );
  });

  it('throws when provider not found', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(null);

    await expect(
      generateTerminationLetter('nonexistent-id', ENROLLMENT_ID, TASK_ID)
    ).rejects.toThrow('Provider nonexistent-id not found');
  });

  it('uses N/A when no practice location exists', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(mockProviderForTermination as any);
    prismaMock.practiceLocation.findFirst
      .mockResolvedValueOnce(null) // primary location
      .mockResolvedValueOnce(null); // fallback location
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollment1 as any);
    prismaMock.terminationLetter.create.mockImplementation((args: any) => Promise.resolve({
      id: 'new-letter-id',
      ...args.data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await generateTerminationLetter(PROVIDER_ID, ENROLLMENT_ID, TASK_ID);

    const createCall = prismaMock.terminationLetter.create.mock.calls[0]![0] as any;
    expect(createCall.data.taxIdEncrypted).toBe('N/A');
    expect(createCall.data.groupNpi).toBeNull();
    expect(createCall.data.letterContent).toContain('Group NPI: N/A');
    expect(createCall.data.letterContent).toContain('Tax ID: N/A');
  });
});
