import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks
const {
  mockCreateCognitoUser,
  mockSetCognitoUserPassword,
  mockDeleteCognitoUser,
  mockEmailService,
  mockNotificationService,
} = vi.hoisted(() => ({
  mockCreateCognitoUser: vi.fn(),
  mockSetCognitoUserPassword: vi.fn(),
  mockDeleteCognitoUser: vi.fn(),
  mockEmailService: {
    isConfigured: vi.fn().mockReturnValue(false),
    sendEmail: vi.fn(),
  },
  mockNotificationService: {
    notifyAdminUsers: vi.fn().mockResolvedValue(undefined),
    createNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../../services/cognitoUser.service.js', () => ({
  createCognitoUser: mockCreateCognitoUser,
  setCognitoUserPassword: mockSetCognitoUserPassword,
  deleteCognitoUser: mockDeleteCognitoUser,
}));

vi.mock('../../services/email.service.js', () => ({
  emailService: mockEmailService,
}));

vi.mock('../../services/notification.service.js', () => ({
  notificationService: mockNotificationService,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { selfServeSignup } from '../portal.service.js';
import type { SelfServeSignupInput } from '../portal.service.js';

const validInput: SelfServeSignupInput = {
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '(555) 123-4567',
  dateOfBirth: '1985-06-15',
  gender: 'female',
  providerType: 'psychiatrist',
  password: 'StrongPass123!',
};

describe('selfServeSignup', () => {
  beforeEach(() => {
    mockCreateCognitoUser.mockReset();
    mockSetCognitoUserPassword.mockReset();
    mockDeleteCognitoUser.mockReset().mockResolvedValue(undefined);
    mockNotificationService.notifyAdminUsers.mockReset().mockResolvedValue(undefined);
  });

  it('creates Cognito user, sets password, creates Provider/User/Application in transaction', async () => {
    // No existing application or provider
    prismaMock.providerApplication.findFirst.mockResolvedValue(null);
    prismaMock.providerProfile.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);

    mockCreateCognitoUser.mockResolvedValue({ cognitoId: 'cognito-123' });
    mockSetCognitoUserPassword.mockResolvedValue(undefined);

    const txResult = {
      provider: { id: 'provider-1' },
      application: { id: 'app-1' },
      newUser: { id: 'user-1', email: 'jane@example.com' },
    };
    prismaMock.$transaction.mockResolvedValue(txResult);
    prismaMock.adminNotification.create.mockResolvedValue({} as any);

    const result = await selfServeSignup(validInput);

    expect(result).toEqual({
      userId: 'user-1',
      providerId: 'provider-1',
      email: 'jane@example.com',
    });

    expect(mockCreateCognitoUser).toHaveBeenCalledWith({
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      suppressInviteEmail: true,
    });

    expect(mockSetCognitoUserPassword).toHaveBeenCalledWith(
      'jane@example.com',
      'StrongPass123!',
      true,
    );

    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(prismaMock.adminNotification.create).toHaveBeenCalled();
  });

  it('rejects duplicate NPI when a provider already exists', async () => {
    prismaMock.providerApplication.findFirst.mockResolvedValue(null);
    prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'existing-provider', npi: '1234567890' } as any);

    await expect(selfServeSignup(validInput)).rejects.toThrow('already exists');
    expect(mockCreateCognitoUser).not.toHaveBeenCalled();
  });

  it('rejects duplicate NPI when a pending application exists', async () => {
    prismaMock.providerApplication.findFirst.mockResolvedValue({ id: 'existing-app' } as any);

    await expect(selfServeSignup(validInput)).rejects.toThrow('already pending');
    expect(mockCreateCognitoUser).not.toHaveBeenCalled();
  });

  it('rejects duplicate email', async () => {
    prismaMock.providerApplication.findFirst.mockResolvedValue(null);
    prismaMock.providerProfile.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user' } as any);

    await expect(selfServeSignup(validInput)).rejects.toThrow('already exists');
    expect(mockCreateCognitoUser).not.toHaveBeenCalled();
  });

  it('rolls back Cognito on DB transaction failure', async () => {
    prismaMock.providerApplication.findFirst.mockResolvedValue(null);
    prismaMock.providerProfile.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);

    mockCreateCognitoUser.mockResolvedValue({ cognitoId: 'cognito-123' });
    mockSetCognitoUserPassword.mockResolvedValue(undefined);
    prismaMock.$transaction.mockRejectedValue(new Error('DB failure'));

    await expect(selfServeSignup(validInput)).rejects.toThrow('DB failure');
    expect(mockDeleteCognitoUser).toHaveBeenCalledWith('jane@example.com');
  });

  it('rolls back Cognito on setCognitoUserPassword failure', async () => {
    prismaMock.providerApplication.findFirst.mockResolvedValue(null);
    prismaMock.providerProfile.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);

    mockCreateCognitoUser.mockResolvedValue({ cognitoId: 'cognito-123' });
    mockSetCognitoUserPassword.mockRejectedValue(new Error('Password set failed'));

    await expect(selfServeSignup(validInput)).rejects.toThrow('Password set failed');
    expect(mockDeleteCognitoUser).toHaveBeenCalledWith('jane@example.com');
  });
});
