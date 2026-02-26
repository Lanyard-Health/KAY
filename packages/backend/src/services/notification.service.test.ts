import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { notificationService } from './notification.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { logger } from '../utils/logger.js';

const mockNotification = {
  id: 'notif-1',
  userId: 'user-1',
  type: 'PROVIDER_APPROVED' as const,
  title: 'Provider Approved',
  message: 'Your application was approved',
  actionUrl: '/providers/123',
  metadata: null,
  read: false,
  readAt: null,
  createdAt: new Date('2026-01-15'),
};

const mockNotification2 = {
  ...mockNotification,
  id: 'notif-2',
  userId: 'user-2',
};

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── createNotification ───────────────────────────────────────────────

  describe('createNotification', () => {
    it('creates a notification with all fields', async () => {
      prismaMock.inAppNotification.create.mockResolvedValue(mockNotification);

      const result = await notificationService.createNotification({
        userId: 'user-1',
        type: 'PROVIDER_APPROVED',
        title: 'Provider Approved',
        message: 'Your application was approved',
        actionUrl: '/providers/123',
        metadata: { providerId: 'prov-1' },
      });

      expect(result).toEqual(mockNotification);
      expect(prismaMock.inAppNotification.create).toHaveBeenCalledOnce();
      expect(prismaMock.inAppNotification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'PROVIDER_APPROVED',
          title: 'Provider Approved',
          message: 'Your application was approved',
          actionUrl: '/providers/123',
          metadata: { providerId: 'prov-1' },
        },
      });
    });

    it('creates a notification without optional fields', async () => {
      const notifWithoutOptionals = {
        ...mockNotification,
        actionUrl: null,
        metadata: null,
      };
      prismaMock.inAppNotification.create.mockResolvedValue(notifWithoutOptionals);

      const result = await notificationService.createNotification({
        userId: 'user-1',
        type: 'PROVIDER_APPROVED',
        title: 'Provider Approved',
        message: 'Your application was approved',
      });

      expect(result).toEqual(notifWithoutOptionals);
      expect(prismaMock.inAppNotification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'PROVIDER_APPROVED',
          title: 'Provider Approved',
          message: 'Your application was approved',
          actionUrl: undefined,
          metadata: undefined,
        },
      });
    });

    it('passes correct data shape to prisma.create', async () => {
      prismaMock.inAppNotification.create.mockResolvedValue(mockNotification);

      await notificationService.createNotification({
        userId: 'user-1',
        type: 'PROVIDER_APPROVED',
        title: 'Provider Approved',
        message: 'Your application was approved',
        actionUrl: '/providers/123',
      });

      const callArg = prismaMock.inAppNotification.create.mock.calls[0][0];
      expect(callArg).toHaveProperty('data.userId', 'user-1');
      expect(callArg).toHaveProperty('data.type', 'PROVIDER_APPROVED');
      expect(callArg).toHaveProperty('data.title', 'Provider Approved');
      expect(callArg).toHaveProperty('data.message', 'Your application was approved');
      expect(callArg).toHaveProperty('data.actionUrl', '/providers/123');
    });
  });

  // ─── notifyAdminUsers ─────────────────────────────────────────────────

  describe('notifyAdminUsers', () => {
    it('creates notifications for all active admin and staff users', async () => {
      const adminUsers = [{ id: 'admin-1' }, { id: 'staff-1' }, { id: 'staff-2' }];
      prismaMock.user.findMany.mockResolvedValue(adminUsers as any);
      prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 3 });

      const result = await notificationService.notifyAdminUsers({
        type: 'PROVIDER_APPROVED',
        title: 'New Provider',
        message: 'A provider was approved',
        actionUrl: '/providers/456',
      });

      expect(result).toEqual({ count: 3 });
      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: {
          role: { in: ['admin', 'credentialing_staff'] },
          isActive: true,
        },
        select: { id: true },
      });
      expect(prismaMock.inAppNotification.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'admin-1',
            type: 'PROVIDER_APPROVED',
            title: 'New Provider',
            message: 'A provider was approved',
            actionUrl: '/providers/456',
            metadata: undefined,
          },
          {
            userId: 'staff-1',
            type: 'PROVIDER_APPROVED',
            title: 'New Provider',
            message: 'A provider was approved',
            actionUrl: '/providers/456',
            metadata: undefined,
          },
          {
            userId: 'staff-2',
            type: 'PROVIDER_APPROVED',
            title: 'New Provider',
            message: 'A provider was approved',
            actionUrl: '/providers/456',
            metadata: undefined,
          },
        ],
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[Notifications] Created 3 admin notifications (type: PROVIDER_APPROVED)'
      );
    });

    it('returns empty array when no admin/staff users exist', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      const result = await notificationService.notifyAdminUsers({
        type: 'PROVIDER_APPROVED',
        title: 'New Provider',
        message: 'A provider was approved',
      });

      expect(result).toEqual([]);
      expect(prismaMock.inAppNotification.createMany).not.toHaveBeenCalled();
    });

    it('passes correct role filter for admin and staff users', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      await notificationService.notifyAdminUsers({
        type: 'PROVIDER_APPROVED',
        title: 'Test',
        message: 'Test message',
      });

      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: {
          role: { in: ['admin', 'credentialing_staff'] },
          isActive: true,
        },
        select: { id: true },
      });
    });
  });

  // ─── getNotifications ─────────────────────────────────────────────────

  describe('getNotifications', () => {
    it('returns notifications with pagination', async () => {
      const notifications = [mockNotification];
      prismaMock.inAppNotification.findMany.mockResolvedValue(notifications);
      prismaMock.inAppNotification.count
        .mockResolvedValueOnce(5)   // totalCount
        .mockResolvedValueOnce(3);  // unreadCount

      const result = await notificationService.getNotifications('user-1', {
        limit: 10,
        offset: 2,
      });

      expect(result).toEqual({
        notifications,
        totalCount: 5,
        unreadCount: 3,
      });
      expect(prismaMock.inAppNotification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 2,
      });
    });

    it('filters unread-only when unreadOnly is true', async () => {
      prismaMock.inAppNotification.findMany.mockResolvedValue([]);
      prismaMock.inAppNotification.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2);

      await notificationService.getNotifications('user-1', { unreadOnly: true });

      expect(prismaMock.inAppNotification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
      // totalCount query also gets the unreadOnly filter
      expect(prismaMock.inAppNotification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
      });
    });

    it('returns totalCount and unreadCount alongside notifications', async () => {
      prismaMock.inAppNotification.findMany.mockResolvedValue([mockNotification]);
      prismaMock.inAppNotification.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7);

      const result = await notificationService.getNotifications('user-1');

      expect(result).toHaveProperty('notifications');
      expect(result).toHaveProperty('totalCount', 10);
      expect(result).toHaveProperty('unreadCount', 7);
    });

    it('uses default limit=20 and offset=0', async () => {
      prismaMock.inAppNotification.findMany.mockResolvedValue([]);
      prismaMock.inAppNotification.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      await notificationService.getNotifications('user-1');

      expect(prismaMock.inAppNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
          skip: 0,
        })
      );
    });
  });

  // ─── getUnreadCount ───────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('returns count of unread notifications for a user', async () => {
      prismaMock.inAppNotification.count.mockResolvedValue(5);

      const result = await notificationService.getUnreadCount('user-1');

      expect(result).toBe(5);
      expect(prismaMock.inAppNotification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
      });
    });
  });

  // ─── markAsRead ───────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('marks specific notification IDs as read', async () => {
      prismaMock.inAppNotification.updateMany.mockResolvedValue({ count: 2 });

      const result = await notificationService.markAsRead('user-1', ['notif-1', 'notif-2']);

      expect(result).toEqual({ count: 2 });
      expect(prismaMock.inAppNotification.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['notif-1', 'notif-2'] },
          userId: 'user-1',
          read: false,
        },
        data: {
          read: true,
          readAt: expect.any(Date),
        },
      });
    });

    it('marks ALL unread notifications when no IDs provided', async () => {
      prismaMock.inAppNotification.updateMany.mockResolvedValue({ count: 5 });

      const result = await notificationService.markAsRead('user-1');

      expect(result).toEqual({ count: 5 });
      expect(prismaMock.inAppNotification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          read: false,
        },
        data: {
          read: true,
          readAt: expect.any(Date),
        },
      });
    });

    it('only updates notifications belonging to the given userId', async () => {
      prismaMock.inAppNotification.updateMany.mockResolvedValue({ count: 1 });

      await notificationService.markAsRead('user-1', ['notif-1']);

      const callArg = prismaMock.inAppNotification.updateMany.mock.calls[0][0];
      expect(callArg.where).toHaveProperty('userId', 'user-1');
    });

    it('marks all unread when given an empty array', async () => {
      prismaMock.inAppNotification.updateMany.mockResolvedValue({ count: 3 });

      await notificationService.markAsRead('user-1', []);

      // Empty array triggers the "mark all" branch
      expect(prismaMock.inAppNotification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          read: false,
        },
        data: {
          read: true,
          readAt: expect.any(Date),
        },
      });
    });
  });

  // ─── cleanupOldNotifications ──────────────────────────────────────────

  describe('cleanupOldNotifications', () => {
    it('deletes read notifications older than specified days', async () => {
      prismaMock.inAppNotification.deleteMany.mockResolvedValue({ count: 15 });

      const result = await notificationService.cleanupOldNotifications(30);

      expect(result).toEqual({ count: 15 });
      expect(prismaMock.inAppNotification.deleteMany).toHaveBeenCalledWith({
        where: {
          read: true,
          createdAt: { lt: expect.any(Date) },
        },
      });

      // Verify the cutoff date is approximately 30 days ago
      const callArg = prismaMock.inAppNotification.deleteMany.mock.calls[0][0];
      const cutoffDate = callArg.where.createdAt.lt as Date;
      const expectedCutoff = new Date();
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);
      // Allow 1 second tolerance
      expect(Math.abs(cutoffDate.getTime() - expectedCutoff.getTime())).toBeLessThan(1000);
    });

    it('uses default 90 days when no arg provided', async () => {
      prismaMock.inAppNotification.deleteMany.mockResolvedValue({ count: 0 });

      await notificationService.cleanupOldNotifications();

      const callArg = prismaMock.inAppNotification.deleteMany.mock.calls[0][0];
      const cutoffDate = callArg.where.createdAt.lt as Date;
      const expectedCutoff = new Date();
      expectedCutoff.setDate(expectedCutoff.getDate() - 90);
      expect(Math.abs(cutoffDate.getTime() - expectedCutoff.getTime())).toBeLessThan(1000);
    });

    it('returns the deletion result count', async () => {
      prismaMock.inAppNotification.deleteMany.mockResolvedValue({ count: 42 });

      const result = await notificationService.cleanupOldNotifications(60);

      expect(result).toEqual({ count: 42 });
    });

    it('logs when notifications are cleaned up', async () => {
      prismaMock.inAppNotification.deleteMany.mockResolvedValue({ count: 10 });

      await notificationService.cleanupOldNotifications();

      expect(logger.info).toHaveBeenCalledWith(
        '[Notifications] Cleaned up 10 old read notifications'
      );
    });

    it('does not log when no notifications are deleted', async () => {
      prismaMock.inAppNotification.deleteMany.mockResolvedValue({ count: 0 });

      await notificationService.cleanupOldNotifications();

      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
