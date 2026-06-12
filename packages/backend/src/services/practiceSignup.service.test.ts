import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('./cognitoUser.service.js', () => ({
  createCognitoUser: vi.fn(async () => ({ cognitoId: 'cog-123' })),
  setCognitoUserPassword: vi.fn(async () => {}),
  deleteCognitoUser: vi.fn(async () => {}),
}));

vi.mock('./automatedEmail.service.js', () => ({
  triggerAutomatedEmail: vi.fn(async () => {}),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Deterministic, inspectable encryption so the test can assert ciphertext vs last-4.
vi.mock('../utils/crypto.js', () => ({
  encryptSafe: (v: string) => `enc:${v}`,
  decryptSafe: (v: string) => (v.startsWith('enc:') ? v.slice(4) : v),
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { registerPractice } from './practiceSignup.service.js';

const baseInput = {
  practiceName: 'Owner Test Group',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.owner@example.com',
  phone: '555-123-4567',
  password: 'SecureP@ss1234',
  addressLine1: '123 Main St',
  city: 'Boston',
  state: 'MA',
  zipCode: '02101',
  operatingStates: ['MA'],
  targetPayerIds: ['00000000-0000-4000-a000-000000000001'],
  isEnterprise: false,
} as any;

describe('registerPractice — ownership disclosure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.practice.create.mockResolvedValue({ id: 'practice-1' } as any);
    prismaMock.user.create.mockResolvedValue({ id: 'user-1', email: baseInput.email } as any);
  });

  it('encrypts owner SSN and DOB, keeps SSN last-4, and stamps createdById', async () => {
    await registerPractice({
      ...baseInput,
      owners: [
        {
          name: 'Jane Doe',
          ssn: '123-45-6789',
          ownershipPercentage: 60,
          dateOfBirth: '1985-04-12',
          homeAddressLine1: '9 Home Ln',
          homeCity: 'Boston',
          homeState: 'MA',
          homeZipCode: '02110',
        },
      ],
    });

    expect(prismaMock.practiceOwner.createMany).toHaveBeenCalledTimes(1);
    const arg = (prismaMock.practiceOwner.createMany as any).mock.calls[0][0];
    expect(arg.data).toHaveLength(1);
    const owner = arg.data[0];
    expect(owner).toMatchObject({
      practiceId: 'practice-1',
      name: 'Jane Doe',
      ssnEncrypted: 'enc:123456789',
      ssnLast4: '6789',
      dateOfBirthEncrypted: 'enc:1985-04-12',
      ownershipPercentage: 60,
      homeAddressLine1: '9 Home Ln',
      createdById: 'user-1',
    });
    // The raw SSN/DOB must never be stored in clear.
    expect(owner.ssn).toBeUndefined();
    expect(JSON.stringify(owner)).not.toContain('123-45-6789');
  });

  it('does not create owners when none are provided', async () => {
    await registerPractice({ ...baseInput });
    expect(prismaMock.practiceOwner.createMany).not.toHaveBeenCalled();
  });

  it('caps persisted owners at 3', async () => {
    const owners = Array.from({ length: 5 }, (_, i) => ({ name: `Owner ${i + 1}` }));
    await registerPractice({ ...baseInput, owners });
    const arg = (prismaMock.practiceOwner.createMany as any).mock.calls[0][0];
    expect(arg.data).toHaveLength(3);
  });
});
