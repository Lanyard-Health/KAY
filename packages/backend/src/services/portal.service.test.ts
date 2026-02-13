import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PrismaClient before importing portal.service
// The service creates its own `new PrismaClient()` instance
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
    PrismaClient: vi.fn().mockImplementation(function () { return {
      providerApplication: mockProviderApplication,
      provider: mockProvider,
      user: mockUser,
      adminNotification: mockAdminNotification,
      $transaction: vi.fn((fn: any) => fn({
        provider: mockProvider,
        user: mockUser,
        providerApplication: mockProviderApplication,
      })),
    }; }),
  };
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

import { PrismaClient } from '@prisma/client';
import {
  submitApplication,
  approveApplication,
  rejectApplication,
  getApplications,
  getApplicationStatusByNpi,
  getApplicationById,
  getPendingApplicationCount,
  getAdminNotifications,
  markNotificationsAsRead,
} from './portal.service.js';

// Access the mock prisma instance
const prismaInstance = (PrismaClient as any).mock.results[0]?.value;

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
};

describe('Portal Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitApplication', () => {
    it('creates application and notification', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);
      prismaInstance.provider.findUnique.mockResolvedValue(null);
      prismaInstance.providerApplication.create.mockResolvedValue(mockApplication);
      prismaInstance.adminNotification.create.mockResolvedValue({});

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
      expect(prismaInstance.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Jane',
            lastName: 'Doe',
          }),
        })
      );
      expect(prismaInstance.adminNotification.create).toHaveBeenCalled();
    });

    it('throws for duplicate pending NPI', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(mockApplication);

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
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);
      prismaInstance.provider.findUnique.mockResolvedValue({ id: 'existing-id', npi: '1234567890' });

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
  });

  describe('approveApplication', () => {
    it('creates provider, user, and updates application status', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaInstance.provider.create.mockResolvedValue({ id: 'new-provider-id' });
      prismaInstance.user.create.mockResolvedValue({ id: 'new-user-id' });
      prismaInstance.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
        providerId: 'new-provider-id',
      });
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      const result = await approveApplication('app-1-id', 'admin@test.com', 'Approved');

      expect(result.status).toBe('approved');
      expect(prismaInstance.provider.create).toHaveBeenCalled();
      expect(prismaInstance.user.create).toHaveBeenCalled();
    });

    it('throws when application not found', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(null);

      await expect(
        approveApplication('bad-id', 'admin@test.com')
      ).rejects.toThrow('not found');
    });

    it('throws when already reviewed', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
      });

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('already been reviewed');
    });
  });

  describe('rejectApplication', () => {
    it('updates status to rejected with notes', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaInstance.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'rejected',
      });
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      const result = await rejectApplication('app-1-id', 'admin@test.com', 'Incomplete');

      expect(result.status).toBe('rejected');
      expect(prismaInstance.providerApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'rejected',
            reviewNotes: 'Incomplete',
          }),
        })
      );
    });

    it('throws when not found', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(null);

      await expect(
        rejectApplication('bad-id', 'admin@test.com', 'Notes')
      ).rejects.toThrow('not found');
    });
  });

  describe('getApplications', () => {
    it('returns all applications when no status filter', async () => {
      prismaInstance.providerApplication.findMany.mockResolvedValue([mockApplication]);

      const result = await getApplications();

      expect(result).toHaveLength(1);
      expect(prismaInstance.providerApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
          orderBy: { submittedAt: 'desc' },
        })
      );
    });

    it('filters by status', async () => {
      prismaInstance.providerApplication.findMany.mockResolvedValue([]);

      await getApplications('pending');

      expect(prismaInstance.providerApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'pending' },
        })
      );
    });
  });

  describe('getApplicationStatusByNpi', () => {
    it('returns most recent application status', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue({
        id: 'app-1-id',
        status: 'pending',
        submittedAt: new Date(),
      });

      const result = await getApplicationStatusByNpi('1234567890');

      expect(result).toBeDefined();
      expect(result!.status).toBe('pending');
      expect(prismaInstance.providerApplication.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { npi: '1234567890' },
          orderBy: { submittedAt: 'desc' },
        })
      );
    });

    it('returns null when no application', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);

      const result = await getApplicationStatusByNpi('9999999999');

      expect(result).toBeNull();
    });
  });

  describe('markNotificationsAsRead', () => {
    it('marks specific notifications as read', async () => {
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 2 });

      await markNotificationsAsRead(['notif-1', 'notif-2']);

      expect(prismaInstance.adminNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['notif-1', 'notif-2'] } },
          data: { read: true },
        })
      );
    });

    it('marks all unread when no IDs provided', async () => {
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 5 });

      await markNotificationsAsRead();

      expect(prismaInstance.adminNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { read: false },
          data: { read: true },
        })
      );
    });
  });
});
