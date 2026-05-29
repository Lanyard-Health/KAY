import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma singleton (must come before service import)
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('./email.service.js', () => ({
  emailService: {
    isConfigured: vi.fn().mockReturnValue(false),
    sendEmail: vi.fn(),
  },
}));

vi.mock('./cognitoUser.service.js', () => ({
  createCognitoUser: vi.fn(() => Promise.resolve({ cognitoId: 'dev-test-cognito-id' })),
  deleteCognitoUser: vi.fn(() => Promise.resolve()),
}));

vi.mock('./notification.service.js', () => ({
  notificationService: {
    createNotification: vi.fn(() => Promise.resolve({})),
    notifyAdminUsers: vi.fn(() => Promise.resolve({ count: 0 })),
  },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { createCognitoUser, deleteCognitoUser } from './cognitoUser.service.js';
import {
  submitApplication,
  approveApplication,
  rejectApplication,
  getApplications,
  getApplicationStatusByNpi,
  getPendingApplicationCount,
  getAdminNotifications,
  markNotificationsAsRead,
} from './portal.service.js';

const mockApplication = {
  id: 'app-1-id',
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@test.com',
  phone: '555-1234',
  dateOfBirth: new Date('1985-06-15'),
  gender: 'female',
  providerType: 'psychiatrist',
  taxonomy: null,
  specialties: [],
  middleName: null,
  suffix: null,
  status: 'pending',
  submittedAt: new Date(),
  reviewedAt: null,
  reviewedBy: null,
  reviewNotes: null,
  practiceId: null,
  previousApplicationId: null,
  providerId: null,
};

describe('Portal Service', () => {
  beforeEach(() => {
    // Clear call counts on all mocks (cognitoUser, email, notification, etc.)
    vi.clearAllMocks();
    // prismaMock is auto-reset by mock-prisma.ts beforeEach (runs first)
    // Re-setup $transaction to call callback with prismaMock
    (prismaMock.$transaction as any).mockImplementation((fn: any) => fn(prismaMock));
  });

  describe('submitApplication', () => {
    it('creates application and notification', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(null);
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.providerApplication.create.mockResolvedValue(mockApplication as any);
      prismaMock.adminNotification.create.mockResolvedValue({} as any);

      const result = await submitApplication({
        npi: '1234567890',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@test.com',
        phone: '555-1234',
        dateOfBirth: '1985-06-15',
        gender: 'female',
      });

      expect(result.id).toBe('app-1-id');
      expect(prismaMock.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Jane',
            lastName: 'Doe',
          }),
        })
      );
      expect(prismaMock.adminNotification.create).toHaveBeenCalled();
    });

    it('throws for duplicate pending NPI', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(mockApplication as any);

      await expect(
        submitApplication({
          npi: '1234567890',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@test.com',
          phone: '555-1234',
          dateOfBirth: '1985-06-15',
          gender: 'female',
        })
      ).rejects.toThrow('already pending');
    });

    it('throws for existing provider NPI', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(null);
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'existing-id', npi: '1234567890' } as any);

      await expect(
        submitApplication({
          npi: '1234567890',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@test.com',
          phone: '555-1234',
          dateOfBirth: '1985-06-15',
          gender: 'female',
        })
      ).rejects.toThrow('already exists');
    });

    it('throws when email already has a user account', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(null);
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user', email: 'jane@test.com' } as any);

      await expect(
        submitApplication({
          npi: '1234567890',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@test.com',
          phone: '555-1234',
          dateOfBirth: '1985-06-15',
          gender: 'female',
        })
      ).rejects.toThrow('email address already exists');
    });
  });

  describe('approveApplication', () => {
    it('creates provider, user, and updates application status', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(mockApplication as any);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.providerProfile.create.mockResolvedValue({ id: 'new-provider-id' } as any);
      prismaMock.user.create.mockResolvedValue({ id: 'new-user-id' } as any);
      prismaMock.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
        providerId: 'new-provider-id',
      } as any);
      prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      const result = await approveApplication('app-1-id', 'admin@test.com', 'Approved');

      expect(result.status).toBe('approved');
      expect(prismaMock.providerProfile.create).toHaveBeenCalled();
      expect(prismaMock.user.create).toHaveBeenCalled();
    });

    it('creates UserPractice when application has practiceId', async () => {
      const appWithPractice = { ...mockApplication, practiceId: 'practice-123' };
      prismaMock.providerApplication.findUnique.mockResolvedValue(appWithPractice as any);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.providerProfile.create.mockResolvedValue({ id: 'new-provider-id' } as any);
      prismaMock.user.create.mockResolvedValue({ id: 'new-user-id' } as any);
      prismaMock.userPractice.create.mockResolvedValue({} as any);
      prismaMock.providerApplication.update.mockResolvedValue({
        ...appWithPractice,
        status: 'approved',
        providerId: 'new-provider-id',
      } as any);
      prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      await approveApplication('app-1-id', 'admin@test.com');

      expect(prismaMock.userPractice.create).toHaveBeenCalledWith({
        data: {
          userId: 'new-user-id',
          practiceId: 'practice-123',
          role: 'PROVIDER',
        },
      });
    });

    it('throws when email already has a user account (before Cognito)', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(mockApplication as any);
      prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user', email: 'jane@test.com' } as any);

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('email address already exists');

      // Should NOT have created a Cognito user
      expect(createCognitoUser).not.toHaveBeenCalled();
    });

    it('rolls back Cognito user if DB transaction fails', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(mockApplication as any);
      prismaMock.user.findUnique.mockResolvedValue(null);
      (prismaMock.$transaction as any).mockRejectedValue(new Error('DB error'));

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('DB error');

      expect(deleteCognitoUser).toHaveBeenCalledWith('jane@test.com');
    });

    it('throws when application not found', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(null);

      await expect(
        approveApplication('bad-id', 'admin@test.com')
      ).rejects.toThrow('not found');
    });

    it('throws when already reviewed', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
      } as any);

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('already been reviewed');
    });
  });

  describe('rejectApplication', () => {
    it('updates status to rejected with notes', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(mockApplication as any);
      prismaMock.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'rejected',
      } as any);
      prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      const result = await rejectApplication('app-1-id', 'admin@test.com', 'Incomplete');

      expect(result.status).toBe('rejected');
      expect(prismaMock.providerApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'rejected',
            reviewNotes: 'Incomplete',
          }),
        })
      );
    });

    it('throws when not found', async () => {
      prismaMock.providerApplication.findUnique.mockResolvedValue(null);

      await expect(
        rejectApplication('bad-id', 'admin@test.com', 'Notes')
      ).rejects.toThrow('not found');
    });
  });

  describe('getApplications', () => {
    it('returns all applications when no status filter', async () => {
      prismaMock.providerApplication.findMany.mockResolvedValue([mockApplication] as any);

      const result = await getApplications();

      expect(result).toHaveLength(1);
      expect(prismaMock.providerApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
          orderBy: { submittedAt: 'desc' },
        })
      );
    });

    it('filters by status', async () => {
      prismaMock.providerApplication.findMany.mockResolvedValue([]);

      await getApplications('pending');

      expect(prismaMock.providerApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'pending' },
        })
      );
    });
  });

  describe('getApplicationStatusByNpi', () => {
    it('returns most recent application status', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue({
        id: 'app-1-id',
        status: 'pending',
        submittedAt: new Date(),
      } as any);

      const result = await getApplicationStatusByNpi('1234567890');

      expect(result).toBeDefined();
      expect(result!.status).toBe('pending');
      expect(prismaMock.providerApplication.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { npi: '1234567890' },
          orderBy: { submittedAt: 'desc' },
        })
      );
    });

    it('returns null when no application', async () => {
      prismaMock.providerApplication.findFirst.mockResolvedValue(null);

      const result = await getApplicationStatusByNpi('9999999999');

      expect(result).toBeNull();
    });
  });

  describe('markNotificationsAsRead', () => {
    it('marks specific notifications as read', async () => {
      prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 2 });

      await markNotificationsAsRead(['notif-1', 'notif-2']);

      expect(prismaMock.adminNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['notif-1', 'notif-2'] } },
          data: { read: true },
        })
      );
    });

    it('marks all unread when no IDs provided', async () => {
      prismaMock.adminNotification.updateMany.mockResolvedValue({ count: 5 });

      await markNotificationsAsRead();

      expect(prismaMock.adminNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { read: false },
          data: { read: true },
        })
      );
    });
  });
});
