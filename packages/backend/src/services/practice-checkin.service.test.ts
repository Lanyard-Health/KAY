import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});
vi.mock('../utils/logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { runPracticeCheckInSweep } from './practice-checkin.service.js';

const NOW = new Date('2026-07-17T06:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const PRACTICE = { id: 'prac-1', name: 'Lakeside Counseling', onboardedAt: daysAgo(60), createdAt: daysAgo(90) };

describe('runPracticeCheckInSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.practice.findMany.mockResolvedValue([PRACTICE] as any);
    prismaMock.task.findFirst.mockResolvedValue(null); // default: no completed task, no open check-in
    prismaMock.task.create.mockResolvedValue({ id: 'new-task' } as any);
  });

  it('only sweeps ACTIVE, non-demo, non-deleted practices (isDemo/INACTIVE exclusion)', async () => {
    await runPracticeCheckInSweep(NOW);
    expect(prismaMock.practice.findMany.mock.calls[0][0].where)
      .toEqual({ status: 'ACTIVE', isDemo: false, deletedAt: null });
  });

  it('creates a check-in when the practice is exactly 7 days quiet (boundary fires)', async () => {
    // last completed task 7 days ago → quietDays = 7 → fires
    prismaMock.task.findFirst
      .mockResolvedValueOnce({ completedAt: daysAgo(7) } as any) // last-touch lookup
      .mockResolvedValueOnce(null); // open check-in dedup lookup
    const result = await runPracticeCheckInSweep(NOW);
    expect(result).toEqual({ practicesChecked: 1, created: 1 });
    const data = prismaMock.task.create.mock.calls[0][0].data;
    expect(data.title).toBe('Weekly check-in — Lakeside Counseling'); // D17 exact format
    expect(data.description).toBe('No contact in 7 days');
    expect(data.taskGroup).toBe('CHECK_IN');
    expect(data.type).toBe('CUSTOM');
    expect(data.assignedToId).toBeNull(); // Task Pool
    expect(data.createdById).toBeNull(); // system convention
    expect(data.dueDate).toEqual(new Date(NOW.getTime() + 3 * 86_400_000)); // D20: due in 3 days
  });

  it('does NOT fire at 6 days quiet (D19: a recent completed task resets the clock)', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({ completedAt: daysAgo(6) } as any);
    const result = await runPracticeCheckInSweep(NOW);
    expect(result.created).toBe(0);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it('falls back to onboardedAt, then createdAt, as the baseline (first-touch solved)', async () => {
    // no completed tasks at all; onboardedAt 60 days ago → fires
    const result = await runPracticeCheckInSweep(NOW);
    expect(result.created).toBe(1);

    vi.clearAllMocks();
    prismaMock.practice.findMany.mockResolvedValue([{ ...PRACTICE, onboardedAt: null, createdAt: daysAgo(3) }] as any);
    prismaMock.task.findFirst.mockResolvedValue(null);
    const second = await runPracticeCheckInSweep(NOW);
    expect(second.created).toBe(0); // created 3 days ago → not quiet yet
  });

  it('dedup: skips when an open CHECK_IN already exists (at most one per practice)', async () => {
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null) // no completed task → quiet since onboardedAt (60d)
      .mockResolvedValueOnce({ id: 'existing-checkin' } as any); // open check-in exists
    const result = await runPracticeCheckInSweep(NOW);
    expect(result.created).toBe(0);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it('processes two eligible quiet practices in one sweep and creates a check-in for each', async () => {
    const practiceB = { id: 'prac-2', name: 'Riverside Therapy', onboardedAt: daysAgo(60), createdAt: daysAgo(90) };
    prismaMock.practice.findMany.mockResolvedValue([PRACTICE, practiceB] as any);
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null) // practice 1: no completed task → quiet since onboardedAt
      .mockResolvedValueOnce(null) // practice 1: no open check-in
      .mockResolvedValueOnce(null) // practice 2: no completed task → quiet since onboardedAt
      .mockResolvedValueOnce(null); // practice 2: no open check-in
    const result = await runPracticeCheckInSweep(NOW);
    expect(result).toEqual({ practicesChecked: 2, created: 2 });
    expect(prismaMock.task.create).toHaveBeenCalledTimes(2);
  });

  it('a practice whose only prior CHECK_IN task is SKIPPED still gets a new check-in (SKIPPED must not dedup)', async () => {
    // The dedup lookup only matches open statuses — a SKIPPED check-in falls
    // outside `status: { in: ['PENDING', 'IN_PROGRESS'] } }`, so Prisma would
    // return null here even though a SKIPPED CHECK_IN task exists in the DB.
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null) // no completed task → quiet since onboardedAt (60d)
      .mockResolvedValueOnce(null); // dedup lookup: SKIPPED doesn't match the open-status filter
    const result = await runPracticeCheckInSweep(NOW);
    expect(result.created).toBe(1);
    expect(prismaMock.task.create).toHaveBeenCalledTimes(1);
    const dedupWhere = prismaMock.task.findFirst.mock.calls[1][0].where;
    expect(dedupWhere.status).toEqual({ in: ['PENDING', 'IN_PROGRESS'] });
    expect(dedupWhere.status.in).not.toContain('SKIPPED');
  });
});
