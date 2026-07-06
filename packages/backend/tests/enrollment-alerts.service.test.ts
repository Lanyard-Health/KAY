import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env['UNSUBSCRIBE_TOKEN_SECRET'] = 'test-secret-for-unit-tests';
  process.env['FRONTEND_URL'] = 'http://localhost:5190';
});

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

const { mockCreateNotification, mockGetRecipients, mockSendEmail, mockIsConfigured } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn(),
  mockGetRecipients: vi.fn(),
  mockSendEmail: vi.fn(),
  mockIsConfigured: vi.fn(),
}));

vi.mock('../src/services/notification.service.js', () => ({
  notificationService: {
    createNotification: mockCreateNotification,
    getPracticeAdminRecipients: mockGetRecipients,
  },
}));

vi.mock('../src/services/email.service.js', () => ({
  emailService: {
    sendEmail: mockSendEmail,
    isConfigured: mockIsConfigured,
  },
}));

import { prismaMock } from './helpers/mock-prisma.js';
import {
  notifyEnrollmentStatusChange,
  buildUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../src/services/enrollment-alerts.service.js';

const PREFS_ON = {
  enrollmentStatusChanges: true,
  credentialExpirations: true,
  followUpReminders: true,
  denialAlerts: true,
  weeklySummary: false,
};

function enrollmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    practiceId: 'prac1',
    nextFollowUpDate: null,
    payer: { name: 'Aetna' },
    provider: {
      firstName: 'Jane',
      lastName: 'Smith',
      practiceId: 'prac1',
      practice: { id: 'prac1', name: 'Greens Health', isDemo: false, deletedAt: null },
    },
    practice: { id: 'prac1', name: 'Greens Health', isDemo: false, deletedAt: null },
    createdBy: { email: 'kay@greens.com' },
    payerTrack: { timelines: [{ minDays: 30, maxDays: 60 }] },
    ...overrides,
  };
}

const RECIPIENTS = [
  { id: 'u1', email: 'a@greens.com', firstName: 'Ada', preferences: { ...PREFS_ON } },
  { id: 'u2', email: 'b@greens.com', firstName: 'Bo', preferences: { ...PREFS_ON } },
];

describe('notifyEnrollmentStatusChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    mockCreateNotification.mockResolvedValue({});
    mockSendEmail.mockResolvedValue({ success: true });
    mockGetRecipients.mockResolvedValue(RECIPIENTS.map((r) => ({ ...r, preferences: { ...r.preferences } })));
    prismaMock.enrollment.findUnique.mockResolvedValue(enrollmentRow() as any);
  });

  it('does nothing for non-alert statuses or unchanged status', async () => {
    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'not_started', newStatus: 'in_progress', actorUserId: null });
    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'submitted', newStatus: 'submitted', actorUserId: null });
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('creates in-app + email for every practice admin, excluding the actor', async () => {
    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'in_progress', newStatus: 'submitted', actorUserId: 'u1' });

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        type: 'enrollment_status_change',
        actionUrl: '/enrollments/e1',
      }),
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.to).toBe('b@greens.com');
    expect(sent.subject).toBe('Submitted to payer: Jane Smith — Aetna');
    expect(sent.notificationType).toBe('enrollment_status');
    // Typical-window context and human labels; never a raw enum.
    expect(sent.html).toContain('30–60 days');
    expect(sent.html).not.toContain('pending_review');
    expect(sent.html).toContain('unsubscribe?token=');
  });

  it('gates denied emails on denialAlerts and others on enrollmentStatusChanges', async () => {
    mockGetRecipients.mockResolvedValue([
      { id: 'u1', email: 'a@greens.com', firstName: 'Ada', preferences: { ...PREFS_ON, denialAlerts: false } },
      { id: 'u2', email: 'b@greens.com', firstName: 'Bo', preferences: { ...PREFS_ON, enrollmentStatusChanges: false } },
    ]);

    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'pending_review', newStatus: 'denied', actorUserId: null });

    // In-app always fires for both.
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    // Email only to u2 (denialAlerts on; their enrollmentStatusChanges=false is irrelevant for denied).
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe('b@greens.com');
    expect(mockSendEmail.mock.calls[0][0].subject).toContain('Needs attention');
  });

  it('skips email but keeps in-app for demo practices', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      enrollmentRow({ practice: { id: 'prac1', name: 'Demo', isDemo: true, deletedAt: null } }) as any,
    );

    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'in_progress', newStatus: 'approved', actorUserId: null });

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('skips email for @dev.local creators and soft-deleted practices', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      enrollmentRow({ createdBy: { email: 'admin@dev.local' } }) as any,
    );
    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'in_progress', newStatus: 'approved', actorUserId: null });
    expect(mockSendEmail).not.toHaveBeenCalled();

    prismaMock.enrollment.findUnique.mockResolvedValue(
      enrollmentRow({ practice: { id: 'prac1', name: 'Gone', isDemo: false, deletedAt: new Date() } }) as any,
    );
    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'submitted', newStatus: 'approved', actorUserId: null });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('uses the practice name for practice-wide (provider-less) enrollments', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(enrollmentRow({ provider: null }) as any);

    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'submitted', newStatus: 'approved', actorUserId: null });

    expect(mockSendEmail.mock.calls[0][0].subject).toBe('Approved: Greens Health is in network with Aetna');
  });

  it('includes the next check-in date in denied emails when scheduled', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      enrollmentRow({ nextFollowUpDate: new Date('2026-07-15T00:00:00Z') }) as any,
    );

    await notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'submitted', newStatus: 'denied', actorUserId: null });

    expect(mockSendEmail.mock.calls[0][0].html).toContain('Jul 15');
  });

  it('never throws — email service failure is swallowed and logged', async () => {
    mockSendEmail.mockRejectedValue(new Error('resend down'));
    await expect(
      notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'in_progress', newStatus: 'submitted', actorUserId: null }),
    ).resolves.toBeUndefined();
  });

  it('never throws — enrollment load failure is swallowed', async () => {
    prismaMock.enrollment.findUnique.mockRejectedValue(new Error('db down'));
    await expect(
      notifyEnrollmentStatusChange({ enrollmentId: 'e1', oldStatus: 'in_progress', newStatus: 'submitted', actorUserId: null }),
    ).resolves.toBeUndefined();
  });
});

describe('unsubscribe tokens', () => {
  it('round-trips a valid token', () => {
    const token = buildUnsubscribeToken('u1', 'denialAlerts');
    expect(token).toBeTruthy();
    expect(verifyUnsubscribeToken(token!)).toEqual({ userId: 'u1', prefKey: 'denialAlerts' });
  });

  it('rejects tampered tokens', () => {
    const token = buildUnsubscribeToken('u1', 'denialAlerts')!;
    const [payload] = token.split('.');
    const forged = Buffer.from(`u2|denialAlerts|${Date.now() + 10_000}`).toString('base64url');
    expect(verifyUnsubscribeToken(`${forged}.${token.split('.')[1]}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${payload}.AAAA`)).toBeNull();
    expect(verifyUnsubscribeToken('garbage')).toBeNull();
  });

  it('rejects expired tokens', () => {
    const secret = process.env['UNSUBSCRIBE_TOKEN_SECRET']!;
    const crypto = require('crypto');
    const payload = Buffer.from(`u1|denialAlerts|${Date.now() - 1000}`).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    expect(verifyUnsubscribeToken(`${payload}.${sig}`)).toBeNull();
  });

  it('rejects unknown pref keys even when signed', () => {
    const secret = process.env['UNSUBSCRIBE_TOKEN_SECRET']!;
    const crypto = require('crypto');
    const payload = Buffer.from(`u1|isActive|${Date.now() + 10_000}`).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    expect(verifyUnsubscribeToken(`${payload}.${sig}`)).toBeNull();
  });
});
