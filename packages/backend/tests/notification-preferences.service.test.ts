import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

import { prismaMock } from './helpers/mock-prisma.js';
import { notificationService, DEFAULT_PREFERENCES } from '../src/services/notification.service.js';

const ROW = {
  id: 'np1',
  userId: 'u1',
  enrollmentStatusChanges: false,
  credentialExpirations: true,
  followUpReminders: true,
  denialAlerts: true,
  weeklySummary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('notification preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when no row exists (weeklySummary off)', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValueOnce(null);

    const prefs = await notificationService.getPreferences('u1');

    expect(prefs).toEqual(DEFAULT_PREFERENCES);
    expect(prefs.weeklySummary).toBe(false);
  });

  it('returns the stored row when it exists', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValueOnce(ROW as any);

    const prefs = await notificationService.getPreferences('u1');

    expect(prefs).toEqual({
      enrollmentStatusChanges: false,
      credentialExpirations: true,
      followUpReminders: true,
      denialAlerts: true,
      weeklySummary: true,
    });
  });

  it('upserts on update and returns the saved values', async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValueOnce(ROW as any);
    const input = {
      enrollmentStatusChanges: false,
      credentialExpirations: true,
      followUpReminders: true,
      denialAlerts: true,
      weeklySummary: true,
    };

    const prefs = await notificationService.updatePreferences('u1', input);

    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', ...input },
      update: { ...input },
    });
    expect(prefs).toEqual(input);
  });
});

describe('getPracticeAdminRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries admin roles + active users and attaches prefs (defaults when none)', async () => {
    prismaMock.userPractice.findMany.mockResolvedValueOnce([
      { user: { id: 'u1', email: 'a@x.com', firstName: 'Ada', notificationPreference: null } },
      { user: { id: 'u2', email: 'b@x.com', firstName: 'Bo', notificationPreference: ROW } },
    ] as any);

    const recipients = await notificationService.getPracticeAdminRecipients('prac1');

    expect(prismaMock.userPractice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          practiceId: 'prac1',
          role: { in: ['SUPER_ADMIN', 'PRACTICE_ADMIN'] },
          user: { isActive: true },
        },
      }),
    );
    expect(recipients).toHaveLength(2);
    expect(recipients[0]).toEqual({ id: 'u1', email: 'a@x.com', firstName: 'Ada', preferences: DEFAULT_PREFERENCES });
    expect(recipients[1].preferences.enrollmentStatusChanges).toBe(false);
    expect(recipients[1].preferences.weeklySummary).toBe(true);
  });

  it('returns empty for a practice with no admin users', async () => {
    prismaMock.userPractice.findMany.mockResolvedValueOnce([] as any);

    const recipients = await notificationService.getPracticeAdminRecipients('prac1');

    expect(recipients).toEqual([]);
  });
});
