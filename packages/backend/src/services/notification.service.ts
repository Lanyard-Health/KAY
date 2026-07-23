import { InAppNotificationType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

interface CreateNotificationParams {
  userId: string;
  type: InAppNotificationType;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
}

interface NotifyAdminUsersParams {
  type: InAppNotificationType;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
}

interface GetNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface NotificationPreferences {
  enrollmentStatusChanges: boolean;
  credentialExpirations: boolean;
  followUpReminders: boolean;
  denialAlerts: boolean;
  weeklySummary: boolean;
}

// Absence of a DB row = these defaults. weeklySummary is opt-in (Kay 2026-07-04).
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  enrollmentStatusChanges: true,
  credentialExpirations: true,
  followUpReminders: true,
  denialAlerts: true,
  weeklySummary: false,
};

export interface PracticeAdminRecipient {
  id: string;
  email: string;
  firstName: string;
  preferences: NotificationPreferences;
}

export type SentHistoryCategory = 'enrollments' | 'reminders' | 'account';

export interface SentHistoryItem {
  id: string;
  channel: 'email' | 'in_app';
  /** 'sent' / 'failed' for emails; 'in_app' for bell-only notifications. */
  status: 'sent' | 'failed' | 'in_app';
  subject: string;
  recipientEmail: string | null;
  recipientName: string | null;
  errorMessage: string | null;
  enrollmentId: string | null;
  category: SentHistoryCategory;
  createdAt: Date;
}

function historyCategory(type: string): SentHistoryCategory {
  if (type.startsWith('enrollment')) return 'enrollments';
  if (
    type === 'expiration_reminder' ||
    type === 'credential_expiring' ||
    type === 'credential_expired' ||
    type === 'caqh_import_stalled'
  ) {
    return 'reminders';
  }
  return 'account';
}

class NotificationService {
  /**
   * Create a single notification for a user
   */
  async createNotification(params: CreateNotificationParams) {
    return prisma.inAppNotification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        actionUrl: params.actionUrl,
        metadata: params.metadata ?? undefined,
      },
    });
  }

  /**
   * Create notifications for all active admin/staff users
   */
  async notifyAdminUsers(params: NotifyAdminUsersParams) {
    const adminUsers = await prisma.user.findMany({
      where: {
        role: { in: ['admin', 'credentialing_staff'] },
        isActive: true,
      },
      select: { id: true },
    });

    if (adminUsers.length === 0) return [];

    const notifications = await prisma.inAppNotification.createMany({
      data: adminUsers.map((user) => ({
        userId: user.id,
        type: params.type,
        title: params.title,
        message: params.message,
        actionUrl: params.actionUrl,
        metadata: params.metadata ?? undefined,
      })),
    });

    logger.info(`[Notifications] Created ${notifications.count} admin notifications (type: ${params.type})`);
    return notifications;
  }

  /**
   * Get notifications for a user with pagination
   */
  async getNotifications(userId: string, options: GetNotificationsOptions = {}) {
    const { unreadOnly = false, limit = 20, offset = 0 } = options;

    const where = {
      userId,
      ...(unreadOnly && { read: false }),
    };

    const [notifications, totalCount, unreadCount] = await Promise.all([
      prisma.inAppNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.inAppNotification.count({ where }),
      prisma.inAppNotification.count({ where: { userId, read: false } }),
    ]);

    return { notifications, totalCount, unreadCount };
  }

  /**
   * Get unread count only (lightweight for badge polling)
   */
  async getUnreadCount(userId: string): Promise<number> {
    return prisma.inAppNotification.count({
      where: { userId, read: false },
    });
  }

  /**
   * Mark notifications as read (specific IDs or all for user)
   */
  async markAsRead(userId: string, notificationIds?: string[]) {
    const now = new Date();

    if (notificationIds && notificationIds.length > 0) {
      return prisma.inAppNotification.updateMany({
        where: {
          id: { in: notificationIds },
          userId,
          read: false,
        },
        data: { read: true, readAt: now },
      });
    }

    return prisma.inAppNotification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: now },
    });
  }

  /**
   * Get a user's email notification preferences (defaults when no row exists)
   */
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (!row) return { ...DEFAULT_PREFERENCES };
    return {
      enrollmentStatusChanges: row.enrollmentStatusChanges,
      credentialExpirations: row.credentialExpirations,
      followUpReminders: row.followUpReminders,
      denialAlerts: row.denialAlerts,
      weeklySummary: row.weeklySummary,
    };
  }

  /**
   * Upsert a user's email notification preferences
   */
  async updatePreferences(userId: string, prefs: NotificationPreferences): Promise<NotificationPreferences> {
    const row = await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...prefs },
      update: { ...prefs },
    });
    return {
      enrollmentStatusChanges: row.enrollmentStatusChanges,
      credentialExpirations: row.credentialExpirations,
      followUpReminders: row.followUpReminders,
      denialAlerts: row.denialAlerts,
      weeklySummary: row.weeklySummary,
    };
  }

  /**
   * All active practice-admin users of a practice, with their preferences.
   * Used to fan out enrollment status alerts and the weekly digest.
   */
  async getPracticeAdminRecipients(practiceId: string): Promise<PracticeAdminRecipient[]> {
    const memberships = await prisma.userPractice.findMany({
      where: {
        practiceId,
        role: { in: ['SUPER_ADMIN', 'PRACTICE_ADMIN'] },
        user: { isActive: true },
      },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            notificationPreference: true,
          },
        },
      },
    });

    return memberships.map(({ user }) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      preferences: user.notificationPreference
        ? {
            enrollmentStatusChanges: user.notificationPreference.enrollmentStatusChanges,
            credentialExpirations: user.notificationPreference.credentialExpirations,
            followUpReminders: user.notificationPreference.followUpReminders,
            denialAlerts: user.notificationPreference.denialAlerts,
            weeklySummary: user.notificationPreference.weeklySummary,
          }
        : { ...DEFAULT_PREFERENCES },
    }));
  }

  /**
   * Delete read notifications older than N days
   */
  /**
   * Everything a practice has been sent, across both channels: email log rows
   * (matched by member address or stamped practiceId metadata) merged with
   * in-app notifications for the practice's members. Read-only; never returns
   * email bodies. When an email and an in-app row announce the same enrollment
   * event to the same person on the same day, only the email row is kept.
   */
  // ponytail: fetch-latest-and-merge, no cursor pagination — total email volume
  // is tiny today; add cursors if a practice ever exceeds `limit` rows/day.
  async getPracticeSentHistory(practiceId: string, limit = 50): Promise<SentHistoryItem[]> {
    const memberships = await prisma.userPractice.findMany({
      where: { practiceId },
      select: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
    const members = memberships.map((m) => m.user);
    if (members.length === 0) return [];
    const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m]));
    const byId = new Map(members.map((m) => [m.id, m]));

    const [emailRows, inAppRows] = await Promise.all([
      prisma.notification.findMany({
        where: {
          status: { in: ['sent', 'failed'] },
          OR: [
            { recipientEmail: { in: members.map((m) => m.email), mode: 'insensitive' } },
            { metadata: { path: ['practiceId'], equals: practiceId } },
          ],
        },
        select: {
          id: true,
          recipientEmail: true,
          type: true,
          subject: true,
          status: true,
          errorMessage: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.inAppNotification.findMany({
        where: { userId: { in: members.map((m) => m.id) } },
        select: { id: true, userId: true, type: true, title: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const enrollmentIdOf = (metadata: unknown): string | null => {
      if (metadata && typeof metadata === 'object' && 'enrollmentId' in metadata) {
        const v = (metadata as Record<string, unknown>)['enrollmentId'];
        return typeof v === 'string' ? v : null;
      }
      return null;
    };
    const dayOf = (d: Date) => d.toISOString().slice(0, 10);

    const emailItems: SentHistoryItem[] = emailRows.map((row) => {
      const member = byEmail.get(row.recipientEmail.toLowerCase());
      return {
        id: row.id,
        channel: 'email',
        status: row.status === 'failed' ? 'failed' : 'sent',
        subject: row.subject,
        recipientEmail: row.recipientEmail,
        recipientName: member ? `${member.firstName} ${member.lastName}`.trim() : null,
        errorMessage: row.errorMessage,
        enrollmentId: enrollmentIdOf(row.metadata),
        category: historyCategory(row.type),
        createdAt: row.createdAt,
      };
    });

    // Suppress in-app rows that duplicate a successful email about the same
    // enrollment to the same person on the same day.
    const covered = new Set(
      emailItems
        .filter((e) => e.status === 'sent' && e.enrollmentId)
        .map((e) => `${e.enrollmentId}|${e.recipientEmail?.toLowerCase()}|${dayOf(e.createdAt)}`),
    );

    const inAppItems: SentHistoryItem[] = inAppRows
      .map((row): SentHistoryItem | null => {
        const member = byId.get(row.userId);
        const enrollmentId = enrollmentIdOf(row.metadata);
        if (
          enrollmentId &&
          member &&
          covered.has(`${enrollmentId}|${member.email.toLowerCase()}|${dayOf(row.createdAt)}`)
        ) {
          return null;
        }
        return {
          id: row.id,
          channel: 'in_app',
          status: 'in_app',
          subject: row.title,
          recipientEmail: member?.email ?? null,
          recipientName: member ? `${member.firstName} ${member.lastName}`.trim() : null,
          errorMessage: null,
          enrollmentId,
          category: historyCategory(row.type),
          createdAt: row.createdAt,
        };
      })
      .filter((item): item is SentHistoryItem => item !== null);

    return [...emailItems, ...inAppItems]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async cleanupOldNotifications(daysToKeep: number = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const result = await prisma.inAppNotification.deleteMany({
      where: {
        read: true,
        createdAt: { lt: cutoff },
      },
    });

    if (result.count > 0) {
      logger.info(`[Notifications] Cleaned up ${result.count} old read notifications`);
    }

    return result;
  }
}

export const notificationService = new NotificationService();
