import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma singleton — portal.service imports from utils/prisma.js
vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
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

vi.mock('../src/services/notification.service.js', () => ({
  notificationService: {
    createNotification: vi.fn(() => Promise.resolve({})),
    notifyAdminUsers: vi.fn(() => Promise.resolve({ count: 0 })),
  },
}));

import { prismaMock } from './helpers/mock-prisma.js';
import { emailService } from '../src/services/email.service.js';
import {
  createCognitoUser,
  deleteCognitoUser,
} from '../src/services/cognitoUser.service.js';
import { providerDob } from '../src/services/provider-dob.service.js';
import {
  submitApplication,
  approveApplication,
  rejectApplication,
} from '../src/services/portal.service.js';

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
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
    (emailService.isConfigured as any).mockReturnValue(false);
  });

  // ==========================================
  // SUBMIT APPLICATION
  // ==========================================
  describe('submitApplication', () => {
    it('creates application with valid data including DOB and gender', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(null);
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);
      prismaMock.providerApplication.create.mockResolvedValue(mockApplication);
      prismaMock.adminNotification.create.mockResolvedValue({});

      const result = await submitApplication(validInput);

      expect(result.id).toBe('app-1-id');
      expect(prismaMock.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirthEncrypted: expect.stringMatching(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/),
            gender: 'female',
          }),
        })
      );
    });

    it('throws for duplicate pending NPI', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(mockApplication);

      await expect(submitApplication(validInput)).rejects.toThrow('already pending');
    });

    it('throws for existing provider with same NPI', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(null);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'existing', npi: '1234567890' });

      await expect(submitApplication(validInput)).rejects.toThrow('already exists');
    });

    it('sends confirmation email to provider when email is configured', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(null);
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);
      prismaMock.providerApplication.create.mockResolvedValue(mockApplication);
      prismaMock.adminNotification.create.mockResolvedValue({});
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
      prismaMock.providerApplication.findFirst.mockResolvedValue(null);
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);
      prismaMock.providerApplication.create.mockResolvedValue(mockApplication);
      prismaMock.adminNotification.create.mockResolvedValue({});
      (emailService.isConfigured as any).mockReturnValue(true);
      // Email rejects — but submitApplication should NOT throw
      (emailService.sendEmail as any).mockImplementation(() => Promise.reject(new Error('SMTP down')));

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
      prismaMock.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaMock.providerProfile.create.mockResolvedValue({ id: 'new-provider-id' });
      prismaMock.user.create.mockResolvedValue({ id: 'new-user-id' });
      prismaMock.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
        providerId: 'new-provider-id',
      });
      prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 });

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
      expect(prismaMock.providerProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Jane',
            lastName: 'Doe',
            dateOfBirthEncrypted: expect.stringMatching(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/),
            gender: 'female',
            status: 'active',
          }),
        })
      );

      // The approve path copies the application's date of birth onto the new
      // provider. Assert the value survived the re-encryption, not just that
      // something ciphertext-shaped was written.
      const providerArg = prismaMock.providerProfile.create.mock.calls[0]![0] as any;
      expect(providerDob({ dateOfBirthEncrypted: providerArg.data.dateOfBirthEncrypted }))
        .toBe('1985-06-15');
      expect(providerArg.data).not.toHaveProperty('dateOfBirth');

      // User created with provider link
      expect(prismaMock.user.create).toHaveBeenCalledWith(
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
      expect(prismaMock.providerApplication.update).toHaveBeenCalledWith(
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
      prismaMock.providerApplication.findUnique.mockResolvedValue(null);

      await expect(
        approveApplication('bad-id', 'admin@test.com')
      ).rejects.toThrow('not found');
    });

    it('throws when application already reviewed', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
      });

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('already been reviewed');
    });

    it('deletes Cognito user if DB transaction fails', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(mockApplication);
      // Make the transaction callback throw (simulating DB failure)
      prismaMock.providerProfile.create.mockRejectedValue(new Error('DB constraint error'));

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('DB constraint error');

      // Cognito user should have been created, then cleaned up
      expect(createCognitoUser).toHaveBeenCalled();
      expect(deleteCognitoUser).toHaveBeenCalledWith('jane@test.com');
    });

    it('sends approval email when email is configured', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaMock.providerProfile.create.mockResolvedValue({ id: 'new-provider-id' });
      prismaMock.user.create.mockResolvedValue({ id: 'new-user-id' });
      prismaMock.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
        providerId: 'new-provider-id',
      });
      prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 });
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
      prismaMock.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaMock.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'rejected',
        reviewNotes: 'Incomplete docs',
      });
      prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      const result = await rejectApplication('app-1-id', 'admin@test.com', 'Incomplete docs');

      expect(result.status).toBe('rejected');

      // Should NOT create provider, user, or cognito
      expect(createCognitoUser).not.toHaveBeenCalled();
      expect(prismaMock.providerProfile.create).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('throws when application not found', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(null);

      await expect(
        rejectApplication('bad-id', 'admin@test.com', 'Notes')
      ).rejects.toThrow('not found');
    });
  });
});
