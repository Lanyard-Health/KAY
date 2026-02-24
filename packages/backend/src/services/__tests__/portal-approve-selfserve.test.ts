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
  return { prisma: prismaMock };
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
import { approveApplication } from '../portal.service.js';

const selfServeApplication = {
  id: 'app-1',
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '(555) 123-4567',
  dateOfBirth: new Date('1985-06-15'),
  gender: 'female',
  providerType: 'psychiatrist',
  status: 'pending',
  providerId: 'provider-1', // Non-null = self-serve
  createdAt: new Date(),
  updatedAt: new Date(),
};

const traditionalApplication = {
  ...selfServeApplication,
  id: 'app-2',
  providerId: null, // Null = traditional path
};

describe('approveApplication — self-serve vs traditional', () => {
  beforeEach(() => {
    mockCreateCognitoUser.mockReset();
    mockDeleteCognitoUser.mockReset().mockResolvedValue(undefined);
    mockNotificationService.createNotification.mockReset().mockResolvedValue(undefined);
  });

  it('self-serve path: updates Provider to active, does NOT call createCognitoUser', async () => {
    prismaMock.providerApplication.findUnique.mockResolvedValue(selfServeApplication as any);

    const updatedApp = { ...selfServeApplication, status: 'approved', reviewedBy: 'admin-1' };
    prismaMock.$transaction.mockResolvedValue(updatedApp);
    prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.user.findFirst.mockResolvedValue({ id: 'user-1' } as any);

    const result = await approveApplication('app-1', 'admin-1', 'Looks good');

    expect(result.status).toBe('approved');
    expect(mockCreateCognitoUser).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('self-serve approval sends in-app notification to provider', async () => {
    prismaMock.providerApplication.findUnique.mockResolvedValue(selfServeApplication as any);

    const updatedApp = { ...selfServeApplication, status: 'approved' };
    prismaMock.$transaction.mockResolvedValue(updatedApp);
    prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.user.findFirst.mockResolvedValue({ id: 'user-1' } as any);

    await approveApplication('app-1', 'admin-1');

    expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'application_approved',
        title: 'Account Verified',
      }),
    );
  });

  it('traditional path: calls createCognitoUser when providerId is null', async () => {
    prismaMock.providerApplication.findUnique.mockResolvedValue(traditionalApplication as any);
    prismaMock.user.findUnique.mockResolvedValue(null); // No existing user

    mockCreateCognitoUser.mockResolvedValue({ cognitoId: 'cognito-new' });

    const txResult = {
      provider: { id: 'new-provider-1' },
      updatedApplication: { ...traditionalApplication, status: 'approved' },
      newUser: { id: 'new-user-1', email: 'jane@example.com' },
    };
    prismaMock.$transaction.mockResolvedValue(txResult);
    prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 } as any);
    mockNotificationService.createNotification.mockResolvedValue(undefined);

    const result = await approveApplication('app-2', 'admin-1');

    expect(result.status).toBe('approved');
    expect(mockCreateCognitoUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane@example.com',
      }),
    );
  });

  it('throws when application not found', async () => {
    prismaMock.providerApplication.findUnique.mockResolvedValue(null);

    await expect(approveApplication('nonexistent', 'admin-1')).rejects.toThrow('Application not found');
  });

  it('throws when application already reviewed', async () => {
    prismaMock.providerApplication.findUnique.mockResolvedValue({
      ...selfServeApplication,
      status: 'approved',
    } as any);

    await expect(approveApplication('app-1', 'admin-1')).rejects.toThrow('already been reviewed');
  });
});
