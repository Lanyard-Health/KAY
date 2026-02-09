import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PrismaClient — the portal service creates its own `new PrismaClient()`
// Mocks MUST be declared inline inside the factory to avoid TDZ issues (vi.mock is hoisted)
vi.mock('@prisma/client', () => {
  const mockProviderApplication = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  };
  const mockProvider = {
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const mockUser = {
    create: vi.fn(),
  };
  const mockAdminNotification = {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  };

  return {
    PrismaClient: vi.fn().mockImplementation(() => ({
      providerApplication: mockProviderApplication,
      provider: mockProvider,
      user: mockUser,
      adminNotification: mockAdminNotification,
      $transaction: vi.fn((fn: any) =>
        fn({
          provider: mockProvider,
          user: mockUser,
          providerApplication: mockProviderApplication,
        })
      ),
    })),
  };
});

vi.mock('../src/services/email.service.js', () => ({
  emailService: {
    isConfigured: vi.fn().mockReturnValue(false),
    sendEmail: vi.fn(() => Promise.resolve({ success: true })),
  },
}));

vi.mock('../src/services/cognitoUser.service.js', () => ({
  createCognitoUser: vi.fn(() => Promise.resolve({ cognitoId: 'test-cognito-id' })),
  deleteCognitoUser: vi.fn(() => Promise.resolve()),
}));

import { PrismaClient } from '@prisma/client';
import { emailService } from '../src/services/email.service.js';
import {
  createCognitoUser,
  deleteCognitoUser,
} from '../src/services/cognitoUser.service.js';
import {
  submitApplication,
  approveApplication,
  rejectApplication,
} from '../src/services/portal.service.js';

// Access the mock prisma instance created by the factory
const prismaInstance = (PrismaClient as any).mock.results[0]?.value;

const validInput = {
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@test.com',
  phone: '555-1234',
  dateOfBirth: '1985-06-15',
  gender: 'female',
  providerType: 'psychiatrist',
};

const mockApplication = {
  id: 'app-1-id',
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  middleName: null,
  suffix: null,
  email: 'jane@test.com',
  phone: '555-1234',
  dateOfBirth: new Date('1985-06-15'),
  gender: 'female',
  providerType: 'psychiatrist',
  taxonomy: null,
  specialties: [],
  status: 'pending',
  submittedAt: new Date(),
  reviewedAt: null,
  reviewedBy: null,
  reviewNotes: null,
  providerId: null,
};

describe('Provider Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (emailService.isConfigured as any).mockReturnValue(false);
  });

  // ==========================================
  // SUBMIT APPLICATION
  // ==========================================
  describe('submitApplication', () => {
    it('creates application with valid data including DOB and gender', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);
      prismaInstance.provider.findUnique.mockResolvedValue(null);
      prismaInstance.providerApplication.create.mockResolvedValue(mockApplication);
      prismaInstance.adminNotification.create.mockResolvedValue({});

      const result = await submitApplication(validInput);

      expect(result.id).toBe('app-1-id');
      expect(prismaInstance.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirth: new Date('1985-06-15'),
            gender: 'female',
          }),
        })
      );
    });

    it('throws for duplicate pending NPI', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(mockApplication);

      await expect(submitApplication(validInput)).rejects.toThrow('already pending');
    });

    it('throws for existing provider with same NPI', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);
      prismaInstance.provider.findUnique.mockResolvedValue({ id: 'existing', npi: '1234567890' });

      await expect(submitApplication(validInput)).rejects.toThrow('already exists');
    });

    it('sends confirmation email to provider when email is configured', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);
      prismaInstance.provider.findUnique.mockResolvedValue(null);
      prismaInstance.providerApplication.create.mockResolvedValue(mockApplication);
      prismaInstance.adminNotification.create.mockResolvedValue({});
      (emailService.isConfigured as any).mockReturnValue(true);

      await submitApplication(validInput);

      // Should have been called for provider confirmation email
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@test.com',
          subject: expect.stringContaining('Application Received'),
          notificationType: 'application_submitted',
        })
      );
    });

    it('does not fail if confirmation email throws', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);
      prismaInstance.provider.findUnique.mockResolvedValue(null);
      prismaInstance.providerApplication.create.mockResolvedValue(mockApplication);
      prismaInstance.adminNotification.create.mockResolvedValue({});
      (emailService.isConfigured as any).mockReturnValue(true);
      // Email rejects — but submitApplication should NOT throw
      (emailService.sendEmail as any).mockReturnValue(Promise.reject(new Error('SMTP down')));

      const result = await submitApplication(validInput);

      // Should still succeed
      expect(result.id).toBe('app-1-id');
    });
  });

  // ==========================================
  // APPROVE APPLICATION
  // ==========================================
  describe('approveApplication', () => {
    it('creates Provider + User records and links application', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaInstance.provider.create.mockResolvedValue({ id: 'new-provider-id' });
      prismaInstance.user.create.mockResolvedValue({ id: 'new-user-id' });
      prismaInstance.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
        providerId: 'new-provider-id',
      });
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      const result = await approveApplication('app-1-id', 'admin@test.com', 'Looks good');

      expect(result.status).toBe('approved');
      expect(result.providerId).toBe('new-provider-id');

      // Cognito user created
      expect(createCognitoUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'jane@test.com',
          firstName: 'Jane',
          lastName: 'Doe',
        })
      );

      // Provider created with correct data
      expect(prismaInstance.provider.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirth: mockApplication.dateOfBirth,
            gender: 'female',
            status: 'active',
          }),
        })
      );

      // User created with provider link
      expect(prismaInstance.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cognitoId: 'test-cognito-id',
            email: 'jane@test.com',
            role: 'provider',
            providerId: 'new-provider-id',
          }),
        })
      );

      // Application updated with providerId
      expect(prismaInstance.providerApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'app-1-id' },
          data: expect.objectContaining({
            status: 'approved',
            providerId: 'new-provider-id',
          }),
        })
      );
    });

    it('throws when application not found', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(null);

      await expect(
        approveApplication('bad-id', 'admin@test.com')
      ).rejects.toThrow('not found');
    });

    it('throws when application already reviewed', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
      });

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('already been reviewed');
    });

    it('deletes Cognito user if DB transaction fails', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(mockApplication);
      // Make the transaction callback throw (simulating DB failure)
      prismaInstance.provider.create.mockRejectedValue(new Error('DB constraint error'));

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('DB constraint error');

      // Cognito user should have been created, then cleaned up
      expect(createCognitoUser).toHaveBeenCalled();
      expect(deleteCognitoUser).toHaveBeenCalledWith('jane@test.com');
    });

    it('sends approval email when email is configured', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaInstance.provider.create.mockResolvedValue({ id: 'new-provider-id' });
      prismaInstance.user.create.mockResolvedValue({ id: 'new-user-id' });
      prismaInstance.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
        providerId: 'new-provider-id',
      });
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 1 });
      (emailService.isConfigured as any).mockReturnValue(true);

      await approveApplication('app-1-id', 'admin@test.com');

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@test.com',
          subject: expect.stringContaining('Application Approved'),
          notificationType: 'application_approved',
        })
      );
    });
  });

  // ==========================================
  // REJECT APPLICATION
  // ==========================================
  describe('rejectApplication', () => {
    it('updates status to rejected without creating provider or user', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaInstance.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'rejected',
        reviewNotes: 'Incomplete docs',
      });
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      const result = await rejectApplication('app-1-id', 'admin@test.com', 'Incomplete docs');

      expect(result.status).toBe('rejected');

      // Should NOT create provider, user, or cognito
      expect(createCognitoUser).not.toHaveBeenCalled();
      expect(prismaInstance.provider.create).not.toHaveBeenCalled();
      expect(prismaInstance.user.create).not.toHaveBeenCalled();
    });

    it('throws when application not found', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(null);

      await expect(
        rejectApplication('bad-id', 'admin@test.com', 'Notes')
      ).rejects.toThrow('not found');
    });
  });
});
