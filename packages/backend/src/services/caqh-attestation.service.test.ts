/**
 * B1 attestation tracker tests — the binding list from the plan:
 * date boundaries/timezones, diff normalization (false-alarm killer),
 * baseline capture exactly on attestation-date change, cycle reset,
 * same-night re-run idempotency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('./notification.service.js', () => ({
  notificationService: { notifyAdminUsers: vi.fn().mockResolvedValue(undefined) },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { notificationService } from './notification.service.js';
import {
  parseYyyymmddUTC,
  cycleDaysForState,
  computeNextDueDate,
  normalizeForDiff,
  diffSnapshots,
  updateAttestationTracker,
  daysUntil,
  evaluateAdminAttestationAlerts,
  ATTESTED_STATUSES,
  EXPIRED_STATUS,
} from './caqh-attestation.service.js';

// ---------------------------------------------------------------------------
// Date parsing — boundary + timezone safety
// ---------------------------------------------------------------------------
describe('parseYyyymmddUTC', () => {
  it('parses a valid date at UTC midnight', () => {
    const d = parseYyyymmddUTC('20260422');
    expect(d?.toISOString()).toBe('2026-04-22T00:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(parseYyyymmddUTC('2026-04-22')).toBeNull();
    expect(parseYyyymmddUTC('2026042')).toBeNull();
    expect(parseYyyymmddUTC('')).toBeNull();
    expect(parseYyyymmddUTC(null)).toBeNull();
    expect(parseYyyymmddUTC(undefined)).toBeNull();
  });

  it('rejects calendar rollovers instead of silently shifting (20260231 ≠ Mar 2)', () => {
    expect(parseYyyymmddUTC('20260231')).toBeNull();
    expect(parseYyyymmddUTC('20261301')).toBeNull();
    expect(parseYyyymmddUTC('20260400')).toBeNull();
  });

  it('handles year boundaries', () => {
    expect(parseYyyymmddUTC('20251231')?.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    expect(parseYyyymmddUTC('20260101')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('accepts leap day on leap years only', () => {
    expect(parseYyyymmddUTC('20280229')).not.toBeNull();
    expect(parseYyyymmddUTC('20260229')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cycle length — IL = 180, everyone else = 120 (verified spec semantics)
// ---------------------------------------------------------------------------
describe('cycleDaysForState', () => {
  it('returns 180 for Illinois, case/whitespace-insensitive', () => {
    expect(cycleDaysForState('IL')).toBe(180);
    expect(cycleDaysForState('il')).toBe(180);
    expect(cycleDaysForState(' IL ')).toBe(180);
  });

  it('returns 120 for everything else, including missing', () => {
    expect(cycleDaysForState('AZ')).toBe(120);
    expect(cycleDaysForState('NY')).toBe(120);
    expect(cycleDaysForState(null)).toBe(120);
    expect(cycleDaysForState(undefined)).toBe(120);
  });
});

describe('computeNextDueDate', () => {
  it('adds 120 days across month boundaries (demo provider: Apr 22 → Aug 20)', () => {
    const last = parseYyyymmddUTC('20260422')!;
    expect(computeNextDueDate(last, 'AZ').toISOString()).toBe('2026-08-20T00:00:00.000Z');
  });

  it('adds 180 days for IL', () => {
    const last = parseYyyymmddUTC('20260422')!;
    expect(computeNextDueDate(last, 'IL').toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('crosses year boundaries correctly', () => {
    const last = parseYyyymmddUTC('20251015')!;
    expect(computeNextDueDate(last, 'CA').toISOString()).toBe('2026-02-12T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Normalization + diff — the false-alarm killer
// ---------------------------------------------------------------------------
describe('normalizeForDiff', () => {
  it('sorts object keys deterministically', () => {
    expect(JSON.stringify(normalizeForDiff({ b: 1, a: 2 })))
      .toBe(JSON.stringify({ a: 2, b: 1 }));
  });

  it('makes array order irrelevant (CAQH list ordering is unstable)', () => {
    const a = normalizeForDiff([{ State: 'AZ' }, { State: 'CA' }]);
    const b = normalizeForDiff([{ State: 'CA' }, { State: 'AZ' }]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('strips volatile envelope keys at any depth', () => {
    const noisy = { RequestID: 'r-1', Provider: { ExtractDate: '20260612', NPI: '123' } };
    const quiet = { Provider: { NPI: '123' } };
    expect(JSON.stringify(normalizeForDiff(noisy))).toBe(JSON.stringify(normalizeForDiff(quiet)));
  });
});

describe('diffSnapshots', () => {
  const baseline = {
    ProviderLicense: [{ State: 'AZ', Number: 'L-1' }, { State: 'CA', Number: 'L-2' }],
    Education: [{ School: 'ASU' }],
    NPI: '1234567890',
  };

  it('identical content → unchanged', () => {
    expect(diffSnapshots(baseline, structuredClone(baseline)))
      .toEqual({ verdict: 'unchanged', changedSections: [] });
  });

  it('reordered lists only → unchanged (no false alarm)', () => {
    const reordered = {
      ...structuredClone(baseline),
      ProviderLicense: [{ State: 'CA', Number: 'L-2' }, { State: 'AZ', Number: 'L-1' }],
    };
    expect(diffSnapshots(baseline, reordered))
      .toEqual({ verdict: 'unchanged', changedSections: [] });
  });

  it('volatile-key-only differences → unchanged', () => {
    const noisy = { ...structuredClone(baseline), RequestDate: '20260612' };
    expect(diffSnapshots(baseline, noisy).verdict).toBe('unchanged');
  });

  it('a real change → changed with the section named', () => {
    const changed = structuredClone(baseline);
    changed.ProviderLicense[0].Number = 'L-99';
    expect(diffSnapshots(baseline, changed))
      .toEqual({ verdict: 'changed', changedSections: ['ProviderLicense'] });
  });

  it('added and removed sections are both flagged', () => {
    const { Education: _dropped, ...withoutEducation } = structuredClone(baseline);
    const withExtra = { ...withoutEducation, WorkHistory: [{ Employer: 'X' }] };
    const result = diffSnapshots(baseline, withExtra);
    expect(result.verdict).toBe('changed');
    expect(result.changedSections).toEqual(['Education', 'WorkHistory']);
  });
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
describe('updateAttestationTracker', () => {
  const providerProfileId = 'prov-1';
  const rawJson = { Provider: { NPI: '123', ProviderLicense: [{ State: 'AZ' }] } };
  const statusBase = {
    caqh_provider_id: '16174500',
    provider_practice_state: 'AZ',
  };

  beforeEach(() => {
    prismaMock.caqhAttestationTracker.findUnique.mockResolvedValue(null);
  });

  it('non-cycle status (New Provider) records status only', async () => {
    await updateAttestationTracker({
      providerProfileId,
      status: { ...statusBase, provider_status: 'New Provider', provider_status_date: '20260601' },
      rawJson,
    });
    expect(prismaMock.caqhAttestationTracker.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { providerProfileId, providerStatus: 'New Provider' },
        update: { providerStatus: 'New Provider' },
      }),
    );
  });

  it('first observation of an attested provider → no_baseline, dates set, NO snapshot', async () => {
    await updateAttestationTracker({
      providerProfileId,
      status: { ...statusBase, provider_status: 'Re-Attestation', provider_status_date: '20260422' },
      rawJson,
    });
    const call = prismaMock.caqhAttestationTracker.upsert.mock.calls[0][0];
    expect(call.create.diffVerdict).toBe('no_baseline');
    expect(call.create.lastAttestationDate?.toISOString()).toBe('2026-04-22T00:00:00.000Z');
    expect(call.create.nextDueDate?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(call.create.baselineSnapshot).toBeUndefined();
  });

  it('observed attestation-date change → new cycle: baseline captured, reminders reset', async () => {
    prismaMock.caqhAttestationTracker.findUnique.mockResolvedValue({
      id: 't-1',
      providerProfileId,
      lastAttestationDate: parseYyyymmddUTC('20260422'),
      baselineSnapshot: { NPI: 'old' },
      remindersSent: { '21': '2026-08-01T00:00:00.000Z' },
    } as never);

    await updateAttestationTracker({
      providerProfileId,
      status: { ...statusBase, provider_status: 'Re-Attestation', provider_status_date: '20260818' },
      rawJson,
    });

    const call = prismaMock.caqhAttestationTracker.update.mock.calls[0][0];
    expect(call.data.lastAttestationDate?.toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(call.data.baselineSnapshot).toBeDefined();
    expect(call.data.remindersSent).toBe(Prisma.DbNull);
    expect(call.data.diffVerdict).toBe('unchanged');
    expect(call.data.cycleAnchor?.toISOString()).toBe('2026-08-18T00:00:00.000Z');
  });

  it('mid-cycle pull with baseline → diffs and stores the verdict', async () => {
    prismaMock.caqhAttestationTracker.findUnique.mockResolvedValue({
      id: 't-1',
      providerProfileId,
      lastAttestationDate: parseYyyymmddUTC('20260422'),
      baselineSnapshot: normalizeForDiff(rawJson.Provider),
    } as never);

    const changedRaw = structuredClone(rawJson);
    changedRaw.Provider.ProviderLicense[0].State = 'CA';

    await updateAttestationTracker({
      providerProfileId,
      status: { ...statusBase, provider_status: 'Re-Attestation', provider_status_date: '20260422' },
      rawJson: changedRaw,
    });

    const call = prismaMock.caqhAttestationTracker.update.mock.calls[0][0];
    expect(call.data.diffVerdict).toBe('changed');
    expect(call.data.changedSections).toEqual(['ProviderLicense']);
  });

  it('same-night re-run with identical data is idempotent (verdict unchanged, same writes)', async () => {
    const stored = {
      id: 't-1',
      providerProfileId,
      lastAttestationDate: parseYyyymmddUTC('20260422'),
      baselineSnapshot: normalizeForDiff(rawJson.Provider),
    } as never;
    prismaMock.caqhAttestationTracker.findUnique.mockResolvedValue(stored);

    const input = {
      providerProfileId,
      status: { ...statusBase, provider_status: 'Re-Attestation', provider_status_date: '20260422' },
      rawJson,
    };
    await updateAttestationTracker(input);
    await updateAttestationTracker(input);

    const calls = prismaMock.caqhAttestationTracker.update.mock.calls;
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[0][0])).toBe(JSON.stringify(calls[1][0]));
    expect(calls[0][0].data.diffVerdict).toBe('unchanged');
  });

  it('Expired Attestation never overwrites known dates; sets due date when none known', async () => {
    // No prior tracker: expiry date becomes the (past) due date.
    await updateAttestationTracker({
      providerProfileId,
      status: { ...statusBase, provider_status: EXPIRED_STATUS, provider_status_date: '20260810' },
      rawJson,
    });
    const create = prismaMock.caqhAttestationTracker.upsert.mock.calls[0][0];
    expect(create.create.nextDueDate?.toISOString()).toBe('2026-08-10T00:00:00.000Z');

    // Prior tracker with a known due date: kept, not clobbered by the expiry date.
    prismaMock.caqhAttestationTracker.findUnique.mockResolvedValue({
      id: 't-1',
      providerProfileId,
      nextDueDate: parseYyyymmddUTC('20260820'),
    } as never);
    await updateAttestationTracker({
      providerProfileId,
      status: { ...statusBase, provider_status: EXPIRED_STATUS, provider_status_date: '20260821' },
      rawJson,
    });
    const update = prismaMock.caqhAttestationTracker.upsert.mock.calls[1][0];
    expect(update.update).toEqual({ providerStatus: EXPIRED_STATUS });
  });

  it('attested status with unparseable date degrades to status-only write', async () => {
    await updateAttestationTracker({
      providerProfileId,
      status: { ...statusBase, provider_status: 'Re-Attestation', provider_status_date: 'garbage' },
      rawJson,
    });
    expect(prismaMock.caqhAttestationTracker.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { providerStatus: 'Re-Attestation' } }),
    );
  });

  it('sanity: status sets match the verified spec', () => {
    expect(ATTESTED_STATUSES.has('Re-Attestation')).toBe(true);
    expect(ATTESTED_STATUSES.has('Initial Profile Complete')).toBe(true);
    expect(ATTESTED_STATUSES.has('Profile Data Submitted')).toBe(true);
    expect(ATTESTED_STATUSES.has(EXPIRED_STATUS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin alerts (PR 3)
// ---------------------------------------------------------------------------
describe('daysUntil', () => {
  it('computes whole UTC days, sign-correct', () => {
    const now = new Date('2026-06-12T23:59:00Z');
    expect(daysUntil(new Date('2026-06-19T00:00:00Z'), now)).toBe(7);
    expect(daysUntil(new Date('2026-06-12T01:00:00Z'), now)).toBe(0);
    expect(daysUntil(new Date('2026-05-29T00:00:00Z'), now)).toBe(-14);
  });
});

describe('evaluateAdminAttestationAlerts', () => {
  const base = {
    providerProfileId: 'prov-1',
    providerName: 'Dr. Jane Doe',
    practiceId: 'prac-1',
  };
  const notifyMock = vi.mocked(notificationService.notifyAdminUsers);

  function trackerWith(overrides: Record<string, unknown>) {
    prismaMock.caqhAttestationTracker.findUnique.mockResolvedValue({
      id: 't-1',
      providerProfileId: 'prov-1',
      providerStatus: 'Re-Attestation',
      nextDueDate: new Date('2026-06-19T00:00:00Z'),
      remindersSent: null,
      ...overrides,
    } as never);
  }

  beforeEach(() => {
    notifyMock.mockClear();
    prismaMock.practiceSettings.findUnique.mockResolvedValue({ caqhRemindersEnabled: true } as never);
  });

  it('fires the day-7 heads-up inside the window, once', async () => {
    trackerWith({});
    await evaluateAdminAttestationAlerts({ ...base, now: new Date('2026-06-12T08:00:00Z') });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0].title).toContain('due within 7 days');
    const write = prismaMock.caqhAttestationTracker.update.mock.calls[0][0];
    expect(Object.keys(write.data.remindersSent as object)).toEqual(['admin7']);
  });

  it('does not re-fire an alert already recorded this cycle', async () => {
    trackerWith({ remindersSent: { admin7: '2026-06-12T08:00:00.000Z' } });
    await evaluateAdminAttestationAlerts({ ...base, now: new Date('2026-06-13T08:00:00Z') });
    expect(notifyMock).not.toHaveBeenCalled();
    expect(prismaMock.caqhAttestationTracker.update).not.toHaveBeenCalled();
  });

  it('fires the expiry alert on Expired Attestation status', async () => {
    trackerWith({ providerStatus: EXPIRED_STATUS, nextDueDate: new Date('2026-06-10T00:00:00Z') });
    await evaluateAdminAttestationAlerts({ ...base, now: new Date('2026-06-12T08:00:00Z') });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0].title).toBe('CAQH attestation expired');
  });

  it('fires the +14d escalation (alongside expiry if both unsent)', async () => {
    trackerWith({ nextDueDate: new Date('2026-05-29T00:00:00Z') });
    await evaluateAdminAttestationAlerts({ ...base, now: new Date('2026-06-12T08:00:00Z') });
    const titles = notifyMock.mock.calls.map((c) => c[0].title);
    expect(titles).toContain('CAQH attestation expired');
    expect(titles).toContain('CAQH attestation 2+ weeks overdue');
  });

  it('respects the practice-level toggle (decision Q7)', async () => {
    prismaMock.practiceSettings.findUnique.mockResolvedValue({ caqhRemindersEnabled: false } as never);
    trackerWith({ providerStatus: EXPIRED_STATUS });
    await evaluateAdminAttestationAlerts({ ...base, now: new Date('2026-06-12T08:00:00Z') });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('defaults to enabled when the practice has no settings row', async () => {
    prismaMock.practiceSettings.findUnique.mockResolvedValue(null);
    trackerWith({});
    await evaluateAdminAttestationAlerts({ ...base, now: new Date('2026-06-12T08:00:00Z') });
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a due date', async () => {
    trackerWith({ nextDueDate: null });
    await evaluateAdminAttestationAlerts({ ...base, now: new Date('2026-06-12T08:00:00Z') });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('quiet zone: nothing fires when due far in the future', async () => {
    trackerWith({ nextDueDate: new Date('2026-09-01T00:00:00Z') });
    await evaluateAdminAttestationAlerts({ ...base, now: new Date('2026-06-12T08:00:00Z') });
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
