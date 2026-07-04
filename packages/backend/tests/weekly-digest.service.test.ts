import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env['UNSUBSCRIBE_TOKEN_SECRET'] = 'test-secret-for-unit-tests';
  process.env['FRONTEND_URL'] = 'http://localhost:5190';
});

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

const { mockSendEmail, mockGetRecipients } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
  mockGetRecipients: vi.fn(),
}));

vi.mock('../src/services/email.service.js', () => ({
  emailService: { sendEmail: mockSendEmail, isConfigured: () => true },
}));

vi.mock('../src/services/notification.service.js', () => ({
  notificationService: { getPracticeAdminRecipients: mockGetRecipients },
}));

import { prismaMock } from './helpers/mock-prisma.js';
import { buildDigestContent, runWeeklyDigest, type StatusChange } from '../src/services/weekly-digest.service.js';
import { assemblePracticeDashboard, type EnrollmentRow } from '../src/services/practice-dashboard.service.js';

const NOW = new Date('2026-07-06T12:00:00Z'); // a Monday
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function row(overrides: Partial<EnrollmentRow>): EnrollmentRow {
  return {
    id: 'e1',
    status: 'submitted',
    applicationDate: daysAgo(21),
    effectiveDate: null,
    lastFollowUpDate: null,
    nextFollowUpDate: null,
    updatedAt: daysAgo(2),
    payer: { id: 'pay1', name: 'Aetna' },
    provider: { id: 'prov1', firstName: 'Jane', lastName: 'Smith', providerType: 'MD', degree: 'MD' },
    timeline: { minDays: 30, maxDays: 60 },
    ...overrides,
  };
}

describe('buildDigestContent', () => {
  it('returns null when there is nothing to say', () => {
    const payload = assemblePracticeDashboard([], NOW);
    expect(buildDigestContent(payload, [], 'Greens Health')).toBeNull();
  });

  it('returns null for a practice with only settled, unchanged enrollments', () => {
    const payload = assemblePracticeDashboard([row({ status: 'approved', applicationDate: null })], NOW);
    expect(buildDigestContent(payload, [], 'Greens Health')).toBeNull();
  });

  it('builds sections with human labels and window context', () => {
    const payload = assemblePracticeDashboard([row({})], NOW);
    const changes: StatusChange[] = [{ subjectName: 'Jane Smith', payerName: 'Aetna', to: 'approved' }];

    const content = buildDigestContent(payload, changes, 'Greens Health')!;

    expect(content.subject).toBe('1 approval, 1 in flight — Greens Health');
    const lastWeek = content.sections.find((s) => s.heading === 'Last week')!;
    expect(lastWeek.rows[0]).toEqual({ title: 'Jane Smith — Aetna', detail: 'Approved' });
    const inFlight = content.sections.find((s) => s.heading === 'In flight')!;
    expect(inFlight.rows[0].detail).toBe('Submitted to payer — day 21 of a typical 30–60 day window');
  });

  it('gives attention rows the we-are-on-it line and NEVER says the staff word', () => {
    const payload = assemblePracticeDashboard([
      row({
        applicationDate: daysAgo(97),
        timeline: { minDays: 45, maxDays: 90 },
        lastFollowUpDate: daysAgo(5),
        nextFollowUpDate: daysAgo(-4),
      }),
      row({ id: 'e2', status: 'denied', payer: { id: 'pay2', name: 'Cigna' } }),
    ], NOW);

    const content = buildDigestContent(payload, [], 'Greens Health')!;
    const attention = content.sections.find((s) => s.heading === 'Needs attention')!;

    const runningLong = attention.rows.find((r) => r.detail === 'Running long')!;
    expect(runningLong.subDetail).toContain('Our team last followed up on');
    expect(runningLong.subDetail).toContain('Next check-in:');
    const denied = attention.rows.find((r) => r.detail === 'Denied')!;
    expect(denied.subDetail).toContain("We're reviewing the denial");

    // Vocabulary regression: the client-facing digest never says "Delayed".
    expect(JSON.stringify(content)).not.toContain('Delayed');
    expect(JSON.stringify(content)).not.toContain('pending_review');
  });
});

describe('runWeeklyDigest', () => {
  const RECIPIENT_ON = {
    id: 'u1', email: 'a@greens.com', firstName: 'Ada',
    preferences: { enrollmentStatusChanges: true, credentialExpirations: true, followUpReminders: true, denialAlerts: true, weeklySummary: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ success: true });
    prismaMock.practice.findMany.mockResolvedValue([{ id: 'prac1', name: 'Greens Health' }] as any);
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: 'e1', status: 'submitted', applicationDate: daysAgo(21), effectiveDate: null,
        lastFollowUpDate: null, nextFollowUpDate: null, updatedAt: daysAgo(2),
        payer: { id: 'pay1', name: 'Aetna' },
        provider: { id: 'prov1', firstName: 'Jane', lastName: 'Smith', providerType: 'MD', degree: 'MD' },
        payerTrack: { timelines: [{ minDays: 30, maxDays: 60 }] },
      },
    ] as any);
    prismaMock.auditLog.findMany.mockResolvedValue([] as any);
    mockGetRecipients.mockResolvedValue([RECIPIENT_ON]);
  });

  it('sends one digest per opted-in recipient', async () => {
    const result = await runWeeklyDigest(NOW);

    expect(result).toMatchObject({ practicesScanned: 1, emailsSent: 1, failed: 0, skippedEmpty: 0 });
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.to).toBe('a@greens.com');
    expect(sent.notificationType).toBe('enrollment_status');
    expect(sent.html).toContain('Open your dashboard');
    expect(sent.html).toContain('unsubscribe?token=');
    expect(sent.html).not.toContain('Delayed');
  });

  it('skips opted-out and @dev.local recipients', async () => {
    mockGetRecipients.mockResolvedValue([
      { ...RECIPIENT_ON, preferences: { ...RECIPIENT_ON.preferences, weeklySummary: false } },
      { ...RECIPIENT_ON, id: 'u2', email: 'admin@dev.local' },
    ]);

    const result = await runWeeklyDigest(NOW);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(result.skippedNoRecipients).toBe(1);
  });

  it('skips practices with nothing to say', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([] as any);

    const result = await runWeeklyDigest(NOW);

    expect(result.skippedEmpty).toBe(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('queries only real, non-demo practices with enrollments', async () => {
    await runWeeklyDigest(NOW);

    expect(prismaMock.practice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isDemo: false, deletedAt: null }),
      }),
    );
  });

  it('one practice failing does not halt the loop', async () => {
    prismaMock.practice.findMany.mockResolvedValue([
      { id: 'bad', name: 'Broken' },
      { id: 'prac1', name: 'Greens Health' },
    ] as any);
    prismaMock.enrollment.findMany
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce([
        {
          id: 'e1', status: 'submitted', applicationDate: daysAgo(21), effectiveDate: null,
          lastFollowUpDate: null, nextFollowUpDate: null, updatedAt: daysAgo(2),
          payer: { id: 'pay1', name: 'Aetna' },
          provider: { id: 'prov1', firstName: 'Jane', lastName: 'Smith', providerType: 'MD', degree: 'MD' },
          payerTrack: { timelines: [{ minDays: 30, maxDays: 60 }] },
        },
      ] as any);

    const result = await runWeeklyDigest(NOW);

    expect(result.failed).toBe(1);
    expect(result.emailsSent).toBe(1);
  });

  it('includes audit-log status changes from the last week', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      { resourceId: 'e1', changes: { field: 'status', from: 'submitted', to: 'approved' } },
    ] as any);

    await runWeeklyDigest(NOW);

    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.subject).toContain('1 approval');
    expect(sent.html).toContain('Last week');
  });
});
