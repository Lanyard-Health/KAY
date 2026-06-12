/**
 * PR 4 binding tests (plan): flag-off provably inert; practice toggle;
 * variant selection (unchanged→magic, no_baseline/changed→neutral);
 * most-urgent-unsent crossed-threshold; overdue cap 4; confirmation exactly
 * once and never on first observation; claim-before-send ordering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('./email.service.js', () => ({
  emailService: {
    isConfigured: vi.fn(() => true),
    sendEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { emailService } from './email.service.js';
import {
  selectReminder,
  sentKeyFor,
  buildReminderEmail,
  evaluateProviderReminder,
} from './caqh-reminder.service.js';

const NOW = new Date('2026-06-12T08:00:00Z');
const dayOffset = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

function tracker(overrides: Record<string, unknown> = {}) {
  return {
    providerStatus: 'Re-Attestation',
    lastAttestationDate: dayOffset(-106), // due in 14 days on a 120-day cycle
    nextDueDate: dayOffset(14),
    baselineCapturedAt: null,
    diffVerdict: 'unchanged',
    remindersSent: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectReminder — the cadence brain
// ---------------------------------------------------------------------------
describe('selectReminder', () => {
  it('picks the most urgent unsent pre-due threshold (crossed, not exact)', () => {
    // 10 days out crosses 21 and 14; most urgent unsent is 14.
    const r = selectReminder(tracker({ nextDueDate: dayOffset(10) }), NOW);
    expect(r).toEqual({ kind: 'preDue', threshold: 14, variant: 'unchanged' });
  });

  it('never back-fills stale thresholds once a more urgent one was sent', () => {
    const r = selectReminder(
      tracker({ nextDueDate: dayOffset(10), remindersSent: { '14': 'sent' } }),
      NOW,
    );
    expect(r).toBeNull(); // 21 crossed but staler than the already-sent 14
  });

  it('mid-cycle import at 5 days out gets exactly the 7-day reminder, no burst', () => {
    const r = selectReminder(tracker({ nextDueDate: dayOffset(5) }), NOW);
    expect(r).toEqual({ kind: 'preDue', threshold: 7, variant: 'unchanged' });
  });

  it('verdict selects the variant: changed/no_baseline get neutral', () => {
    expect(selectReminder(tracker({ diffVerdict: 'changed' }), NOW))
      .toMatchObject({ variant: 'neutral' });
    expect(selectReminder(tracker({ diffVerdict: 'no_baseline' }), NOW))
      .toMatchObject({ variant: 'neutral' });
    expect(selectReminder(tracker({ diffVerdict: 'unchanged' }), NOW))
      .toMatchObject({ variant: 'unchanged' });
  });

  it('day after expiry → the expired email, once', () => {
    expect(selectReminder(tracker({ nextDueDate: dayOffset(-1) }), NOW))
      .toEqual({ kind: 'expired' });
    expect(selectReminder(
      tracker({ nextDueDate: dayOffset(-1), remindersSent: { expired1: 'sent' } }), NOW,
    )).toBeNull();
  });

  it('"Expired Attestation" status forces the expired path even with a future-looking date', () => {
    expect(selectReminder(
      tracker({ providerStatus: 'Expired Attestation', nextDueDate: dayOffset(-2) }), NOW,
    )).toEqual({ kind: 'expired' });
  });

  it('weekly overdue ladder fires the latest crossed week', () => {
    const sent = { expired1: 'x', overdue7: 'x' };
    expect(selectReminder(
      tracker({ nextDueDate: dayOffset(-15), remindersSent: sent }), NOW,
    )).toEqual({ kind: 'overdue', week: 14 });
  });

  it('hard-caps overdue emails at 4 even far past due', () => {
    const sent = { expired1: 'x', overdue7: 'x', overdue14: 'x', overdue21: 'x', overdue28: 'x' };
    expect(selectReminder(
      tracker({ nextDueDate: dayOffset(-90), remindersSent: sent }), NOW,
    )).toBeNull();
  });

  it('confirmation fires when a baseline was just captured, exactly once', () => {
    const fresh = tracker({ baselineCapturedAt: dayOffset(-1), nextDueDate: dayOffset(119) });
    expect(selectReminder(fresh, NOW)).toEqual({ kind: 'confirmation' });
    expect(selectReminder(
      { ...fresh, remindersSent: { confirmation: 'sent' } }, NOW,
    )).toBeNull(); // and nothing else is due 119 days out
  });

  it('NEVER confirms on first observation (no baseline = attestation predates us)', () => {
    expect(selectReminder(
      tracker({ baselineCapturedAt: null, diffVerdict: 'no_baseline', nextDueDate: dayOffset(100) }),
      NOW,
    )).toBeNull();
  });

  it('stale baselineCapturedAt does not re-confirm later in the cycle', () => {
    expect(selectReminder(
      tracker({ baselineCapturedAt: dayOffset(-30), nextDueDate: dayOffset(90), remindersSent: {} }),
      NOW,
    )).toBeNull();
  });

  it('no due date → nothing', () => {
    expect(selectReminder(tracker({ nextDueDate: null }), NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildReminderEmail — approved copy, verified link, derived cycle length
// ---------------------------------------------------------------------------
describe('buildReminderEmail', () => {
  it('every CTA uses the verified ProView URL', () => {
    for (const r of [
      { kind: 'preDue', threshold: 14, variant: 'unchanged' },
      { kind: 'preDue', threshold: 14, variant: 'neutral' },
      { kind: 'expired' },
      { kind: 'overdue', week: 14 },
    ] as const) {
      const { html } = buildReminderEmail(r, { firstName: 'Jane', tracker: tracker() });
      expect(html).toContain('https://proview.caqh.org/pr');
    }
  });

  it('unchanged variant carries the "nothing has changed" promise; neutral does not', () => {
    const magic = buildReminderEmail(
      { kind: 'preDue', threshold: 14, variant: 'unchanged' },
      { firstName: 'Jane', tracker: tracker() },
    );
    const neutral = buildReminderEmail(
      { kind: 'preDue', threshold: 14, variant: 'neutral' },
      { firstName: 'Jane', tracker: tracker() },
    );
    expect(magic.html).toContain('nothing has changed');
    expect(neutral.html).not.toContain('nothing has changed');
    expect(neutral.html).toContain('review your profile');
  });

  it('expired email derives the cycle from the tracked dates: 180 for an IL cadence', () => {
    const il = tracker({
      lastAttestationDate: new Date('2026-01-01T00:00:00Z'),
      nextDueDate: new Date('2026-06-30T00:00:00Z'), // 180 days later
    });
    const { html } = buildReminderEmail({ kind: 'expired' }, { firstName: 'Jane', tracker: il });
    expect(html).toContain('every 180 days');
  });

  it('confirmation has no CTA button and names the next due date', () => {
    const t = tracker({ nextDueDate: new Date('2026-10-18T00:00:00Z') });
    const { html, subject } = buildReminderEmail({ kind: 'confirmation' }, { firstName: 'Jane', tracker: t });
    expect(subject).toContain('all set');
    expect(html).not.toContain('proview.caqh.org');
    expect(html).toContain('October 18, 2026');
  });

  it('login-help link: account-holders get the in-app locker, account-less get DataSpring reset (Q2)', () => {
    const withAccount = buildReminderEmail(
      { kind: 'preDue', threshold: 14, variant: 'unchanged' },
      { firstName: 'Jane', tracker: tracker(), hasAccount: true },
    );
    expect(withAccount.html).toContain('/portal/caqh-login');
    expect(withAccount.html).toContain("Can't remember your CAQH login?");

    const withoutAccount = buildReminderEmail(
      { kind: 'preDue', threshold: 14, variant: 'unchanged' },
      { firstName: 'Jane', tracker: tracker(), hasAccount: false },
    );
    expect(withoutAccount.html).toContain('Login/ForgotPassword?Type=PR');
    expect(withoutAccount.html).not.toContain('/portal/caqh-login');
  });

  it('confirmation email carries no login-help link', () => {
    const { html } = buildReminderEmail(
      { kind: 'confirmation' },
      { firstName: 'Jane', tracker: tracker(), hasAccount: true },
    );
    expect(html).not.toContain('/portal/caqh-login');
    expect(html).not.toContain('ForgotPassword');
  });

  it('1-day variants append the last-reminder line', () => {
    const { html } = buildReminderEmail(
      { kind: 'preDue', threshold: 1, variant: 'neutral' },
      { firstName: 'Jane', tracker: tracker({ nextDueDate: dayOffset(1) }) },
    );
    expect(html).toContain('last reminder');
  });
});

// ---------------------------------------------------------------------------
// evaluateProviderReminder — gates and delivery semantics
// ---------------------------------------------------------------------------
describe('evaluateProviderReminder', () => {
  const input = {
    providerProfileId: 'prov-1',
    firstName: 'Jane',
    email: 'jane@example.com',
    practiceId: 'prac-1',
    now: NOW,
  };
  const sendMock = vi.mocked(emailService.sendEmail);
  const configuredMock = vi.mocked(emailService.isConfigured);

  beforeEach(() => {
    sendMock.mockClear();
    configuredMock.mockReturnValue(true);
    prismaMock.caqhAttestationTracker.findUnique.mockResolvedValue(tracker() as never);
    prismaMock.practiceSettings.findUnique.mockResolvedValue({ caqhRemindersEnabled: true } as never);
    process.env['CAQH_REMINDER_EMAILS_ENABLED'] = 'true';
  });

  afterEach(() => {
    delete process.env['CAQH_REMINDER_EMAILS_ENABLED'];
  });

  it('dry-run (flag unset) is provably inert: no send, no state write', async () => {
    delete process.env['CAQH_REMINDER_EMAILS_ENABLED'];
    await evaluateProviderReminder(input);
    expect(sendMock).not.toHaveBeenCalled();
    expect(prismaMock.caqhAttestationTracker.update).not.toHaveBeenCalled();
  });

  it('live: claims the sent-key BEFORE sending (at-most-once)', async () => {
    const order: string[] = [];
    prismaMock.caqhAttestationTracker.update.mockImplementation((() => {
      order.push('claim');
      return Promise.resolve({});
    }) as never);
    sendMock.mockImplementation((() => {
      order.push('send');
      return Promise.resolve();
    }) as never);

    await evaluateProviderReminder(input);

    expect(order).toEqual(['claim', 'send']);
    const write = prismaMock.caqhAttestationTracker.update.mock.calls[0][0];
    expect(Object.keys(write.data.remindersSent as object)).toEqual(['14']);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      to: 'jane@example.com',
      notificationType: 'enrollment_follow_up',
    });
  });

  it('practice toggle off → silence', async () => {
    prismaMock.practiceSettings.findUnique.mockResolvedValue({ caqhRemindersEnabled: false } as never);
    await evaluateProviderReminder(input);
    expect(sendMock).not.toHaveBeenCalled();
    expect(prismaMock.caqhAttestationTracker.update).not.toHaveBeenCalled();
  });

  it('no provider email → skip without claiming', async () => {
    await evaluateProviderReminder({ ...input, email: null });
    expect(sendMock).not.toHaveBeenCalled();
    expect(prismaMock.caqhAttestationTracker.update).not.toHaveBeenCalled();
  });

  it('email service unconfigured → skip without claiming', async () => {
    configuredMock.mockReturnValue(false);
    await evaluateProviderReminder(input);
    expect(sendMock).not.toHaveBeenCalled();
    expect(prismaMock.caqhAttestationTracker.update).not.toHaveBeenCalled();
  });

  it('a send failure does not throw (sync must survive)', async () => {
    sendMock.mockRejectedValue(new Error('SES down'));
    await expect(evaluateProviderReminder(input)).resolves.toBeUndefined();
  });

  it('nothing due → no claim, no send', async () => {
    prismaMock.caqhAttestationTracker.findUnique.mockResolvedValue(
      tracker({ nextDueDate: dayOffset(60) }) as never,
    );
    await evaluateProviderReminder(input);
    expect(sendMock).not.toHaveBeenCalled();
    expect(prismaMock.caqhAttestationTracker.update).not.toHaveBeenCalled();
  });

  it('sentKeyFor maps every kind to a stable key', () => {
    expect(sentKeyFor({ kind: 'preDue', threshold: 7, variant: 'neutral' })).toBe('7');
    expect(sentKeyFor({ kind: 'expired' })).toBe('expired1');
    expect(sentKeyFor({ kind: 'overdue', week: 21 })).toBe('overdue21');
    expect(sentKeyFor({ kind: 'confirmation' })).toBe('confirmation');
  });
});
