import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { recordEnrollmentOutcome, sweepStuckEnrollments } from './enrollment-outcome.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const TRANSITION = new Date('2026-05-20T00:00:00Z');

/**
 * Build a loaded enrollment matching the recorder's `outcomeInclude` shape.
 * Defaults to a real, recordable production enrollment (non-demo, non-dev creator).
 */
function makeEnrollment(overrides: Record<string, any> = {}): any {
  return {
    id: 'enr-1',
    payerId: 'payer-1',
    payerTrackId: 'track-1',
    providerId: 'prov-1',
    applicationDate: new Date('2026-04-01T00:00:00Z'),
    effectiveDate: new Date('2026-05-01T00:00:00Z'),
    recredentialingDate: null,
    payer: { name: 'Aetna' },
    payerTrack: { stateRegion: 'CA' },
    provider: {
      providerType: 'psychiatrist',
      practice: { id: 'practice-1', isDemo: false, state: 'NY' },
    },
    createdBy: { email: 'owner@realpractice.com' },
    ...overrides,
  };
}

describe('recordEnrollmentOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OUTCOME_RECORDER_EXCLUDE_PRACTICE_IDS'];
    prismaMock.enrollmentOutcome.upsert.mockResolvedValue({} as any);
  });

  it('is a no-op for non-terminal statuses (never loads or writes)', async () => {
    for (const status of ['not_started', 'in_progress', 'submitted', 'pending_review'] as const) {
      await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status });
    }
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentOutcome.upsert).not.toHaveBeenCalled();
  });

  it('writes exactly one row keyed on (enrollmentId, outcome) for an approved enrollment', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());

    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved', transitionAt: TRANSITION });

    expect(prismaMock.enrollmentOutcome.upsert).toHaveBeenCalledTimes(1);
    const arg = (prismaMock.enrollmentOutcome.upsert as any).mock.calls[0][0];
    // Natural key — the thing that makes replays idempotent.
    expect(arg.where).toEqual({ enrollmentId_outcome: { enrollmentId: 'enr-1', outcome: 'approved' } });
    // Overwrite contract: existing row is source of truth, never updated.
    expect(arg.update).toEqual({});
    // Tagging dimensions.
    expect(arg.create).toMatchObject({
      enrollmentId: 'enr-1',
      outcome: 'approved',
      payerName: 'Aetna',
      state: 'CA',
      providerType: 'psychiatrist',
      processType: 'initial',
      practiceId: 'practice-1',
    });
  });

  it('IDEMPOTENT: relies on update:{} so a replay can never overwrite the first row', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());

    // Two calls with DIFFERENT transition timestamps (the replay-with-fresh-ts case).
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved', transitionAt: new Date('2026-05-01T00:00:00Z') });
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved', transitionAt: new Date('2026-09-09T00:00:00Z') });

    // Both calls upsert on the SAME natural key with an empty update — the DB unique
    // index collapses them to one row; the second call's timestamp is discarded.
    expect(prismaMock.enrollmentOutcome.upsert).toHaveBeenCalledTimes(2);
    for (const call of (prismaMock.enrollmentOutcome.upsert as any).mock.calls) {
      expect(call[0].where).toEqual({ enrollmentId_outcome: { enrollmentId: 'enr-1', outcome: 'approved' } });
      expect(call[0].update).toEqual({});
    }
  });

  it('EXCLUDES demo tenants (Practice.isDemo) — writes nothing', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ provider: { providerType: 'psychiatrist', practice: { id: 'p', isDemo: true, state: 'NY' } } }),
    );
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved' });
    expect(prismaMock.enrollmentOutcome.upsert).not.toHaveBeenCalled();
  });

  it('EXCLUDES @dev.local creators — writes nothing', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ createdBy: { email: 'admin@dev.local' } }));
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved' });
    expect(prismaMock.enrollmentOutcome.upsert).not.toHaveBeenCalled();
  });

  it('EXCLUDES enrollments with no practice (not a real tenant)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ provider: { providerType: 'psychiatrist', practice: null } }),
    );
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved' });
    expect(prismaMock.enrollmentOutcome.upsert).not.toHaveBeenCalled();
  });

  it('EXCLUDES practices in the OUTCOME_RECORDER_EXCLUDE_PRACTICE_IDS denylist', async () => {
    process.env['OUTCOME_RECORDER_EXCLUDE_PRACTICE_IDS'] = 'other, practice-1 ,more';
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved' });
    expect(prismaMock.enrollmentOutcome.upsert).not.toHaveBeenCalled();
  });

  it('does NOT exclude beta testers using "Test" practice names (no name-matching)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ provider: { providerType: 'lcsw', practice: { id: 'p', isDemo: false, state: 'TX' } }, createdBy: { email: 'tester@realbeta.com' } }),
    );
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved' });
    expect(prismaMock.enrollmentOutcome.upsert).toHaveBeenCalledTimes(1);
  });

  it('days_to_outcome: approved uses applicationDate -> effectiveDate', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment()); // 04-01 -> 05-01 = 30
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved', transitionAt: TRANSITION });
    expect((prismaMock.enrollmentOutcome.upsert as any).mock.calls[0][0].create.daysToOutcome).toBe(30);
  });

  it('days_to_outcome: denied uses applicationDate -> transitionAt', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'denied', transitionAt: new Date('2026-04-11T00:00:00Z') });
    const arg = (prismaMock.enrollmentOutcome.upsert as any).mock.calls[0][0];
    expect(arg.create.outcome).toBe('denied');
    expect(arg.create.daysToOutcome).toBe(10); // 04-01 -> 04-11
  });

  it('processType is "recred" when recredentialingDate is set', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ recredentialingDate: new Date('2026-01-01') }));
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved' });
    expect((prismaMock.enrollmentOutcome.upsert as any).mock.calls[0][0].create.processType).toBe('recred');
  });

  it('state falls back payerTrack -> practice.state -> "unknown"', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ payerTrack: null, provider: { providerType: 'lpc', practice: { id: 'p', isDemo: false, state: 'TX' } } }),
    );
    await recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved' });
    expect((prismaMock.enrollmentOutcome.upsert as any).mock.calls[0][0].create.state).toBe('TX');
  });

  it('does nothing when the enrollment is not found', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    await recordEnrollmentOutcome({ enrollmentId: 'missing', status: 'approved' });
    expect(prismaMock.enrollmentOutcome.upsert).not.toHaveBeenCalled();
  });

  it('NEVER THROWS even if the DB load fails (fire-and-forget safe)', async () => {
    prismaMock.enrollment.findUnique.mockRejectedValue(new Error('db down'));
    await expect(recordEnrollmentOutcome({ enrollmentId: 'enr-1', status: 'approved' })).resolves.toBeUndefined();
  });
});

describe('sweepStuckEnrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OUTCOME_RECORDER_EXCLUDE_PRACTICE_IDS'];
    prismaMock.enrollmentOutcome.upsert.mockResolvedValue({} as any);
  });

  it('queries only non-terminal, >60d-stale enrollments without an existing stuck row', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    await sweepStuckEnrollments(new Date('2026-06-13T00:00:00Z'));
    const where = (prismaMock.enrollment.findMany as any).mock.calls[0][0].where;
    expect(where.status.in).toEqual(['not_started', 'in_progress', 'submitted', 'pending_review']);
    expect(where.outcomes).toEqual({ none: { outcome: 'stuck' } });
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
  });

  it('upserts a stuck outcome for a real candidate and skips demo candidates', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment({ id: 'real', updatedAt: new Date('2026-01-01T00:00:00Z') }),
      makeEnrollment({ id: 'demo', updatedAt: new Date('2026-01-01T00:00:00Z'), provider: { providerType: 'pmhnp', practice: { id: 'd', isDemo: true, state: 'NY' } } }),
    ]);
    const written = await sweepStuckEnrollments(new Date('2026-06-13T00:00:00Z'));
    expect(written).toBe(1);
    expect(prismaMock.enrollmentOutcome.upsert).toHaveBeenCalledTimes(1);
    expect((prismaMock.enrollmentOutcome.upsert as any).mock.calls[0][0].where).toEqual({
      enrollmentId_outcome: { enrollmentId: 'real', outcome: 'stuck' },
    });
  });
});
