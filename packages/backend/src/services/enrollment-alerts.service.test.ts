import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./notification.service.js', () => ({
  notificationService: {
    getPracticeAdminRecipients: vi.fn().mockResolvedValue([]),
    createNotification: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('./email.service.js', () => ({
  emailService: { isConfigured: vi.fn(() => false), sendEmail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('./email-templates.js', () => ({
  renderProviderActionEmail: vi.fn(() => '<html></html>'),
}));

import { notifyEnrollmentStatusChange } from './enrollment-alerts.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { notificationService } from './notification.service.js';

const mockedRecipients = vi.mocked(notificationService.getPracticeAdminRecipients);

function mockLoadedEnrollment() {
  prismaMock.enrollment.findUnique.mockResolvedValue({
    id: 'enr-1',
    practiceId: null,
    nextFollowUpDate: null,
    payer: { name: 'Aetna' },
    provider: {
      firstName: 'Jane',
      lastName: 'Doe',
      practiceId: 'practice-1',
      practice: { id: 'practice-1', name: 'Test Practice', isDemo: false, deletedAt: null },
    },
    practice: null,
    createdBy: { email: 'owner@realpractice.com' },
    payerTrack: null,
  } as any);
}

const recipient = { id: 'admin-2', email: 'other-admin@realpractice.com', firstName: 'Ada', preferences: null };

describe('notifyEnrollmentStatusChange dedup claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRecipients.mockResolvedValue([recipient as any]);
  });

  it('claims the status atomically before sending, once a recipient exists', async () => {
    prismaMock.enrollment.updateMany.mockResolvedValue({ count: 1 } as any);
    mockLoadedEnrollment();

    await notifyEnrollmentStatusChange({
      enrollmentId: 'enr-1',
      oldStatus: 'submitted',
      newStatus: 'approved',
      actorUserId: 'user-1',
    });

    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith({
      where: { id: 'enr-1', NOT: { notifiedStatuses: { has: 'approved' } } },
      data: { notifiedStatuses: { push: 'approved' } },
    });
    // Claim succeeded → the in-app notification goes out
    expect(vi.mocked(notificationService.createNotification)).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the status was already announced (claim count 0)', async () => {
    prismaMock.enrollment.updateMany.mockResolvedValue({ count: 0 } as any);
    mockLoadedEnrollment();

    await notifyEnrollmentStatusChange({
      enrollmentId: 'enr-1',
      oldStatus: 'submitted',
      newStatus: 'approved',
      actorUserId: 'user-1',
    });

    expect(vi.mocked(notificationService.createNotification)).not.toHaveBeenCalled();
  });

  it('does NOT claim when there is no one to notify (lone-admin self-change)', async () => {
    mockLoadedEnrollment();
    // Only recipient is the actor — filtered out, list becomes empty
    mockedRecipients.mockResolvedValue([{ ...recipient, id: 'user-1' } as any]);

    await notifyEnrollmentStatusChange({
      enrollmentId: 'enr-1',
      oldStatus: 'submitted',
      newStatus: 'approved',
      actorUserId: 'user-1',
    });

    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
    expect(vi.mocked(notificationService.createNotification)).not.toHaveBeenCalled();
  });

  it('never claims for non-alert statuses', async () => {
    await notifyEnrollmentStatusChange({
      enrollmentId: 'enr-1',
      oldStatus: 'submitted',
      newStatus: 'pending_review',
      actorUserId: 'user-1',
    });

    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('never claims when status is unchanged', async () => {
    await notifyEnrollmentStatusChange({
      enrollmentId: 'enr-1',
      oldStatus: 'approved',
      newStatus: 'approved',
      actorUserId: 'user-1',
    });

    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });
});
