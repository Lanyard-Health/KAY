import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./terminationLetter.service.js', () => ({
  generateTerminationLetter: vi.fn().mockResolvedValue({}),
}));

import { triggerTerminationWorkflow } from './terminationWorkflow.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { generateTerminationLetter } from './terminationLetter.service.js';
import {
  mockProviderForTermination,
  mockEnrollment1,
  mockEnrollment2,
} from '../../tests/helpers/termination-fixtures.js';

const PROVIDER_ID = mockProviderForTermination.id;

describe('triggerTerminationWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates correct tasks for each enrollment with effectiveDate', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([
      mockEnrollment1,
      mockEnrollment2,
    ] as any);

    // No existing tasks
    prismaMock.task.findMany
      .mockResolvedValueOnce([]) // existing tasks query
      .mockResolvedValueOnce([ // newLetterTasks query
        { id: 'new-task-1', enrollmentId: mockEnrollment1.id },
        { id: 'new-task-2', enrollmentId: mockEnrollment2.id },
      ] as any);

    prismaMock.task.createMany.mockResolvedValue({ count: 6 } as any);

    await triggerTerminationWorkflow(PROVIDER_ID, mockEnrollment1.id);

    // Should create 6 tasks: 2 TERMINATE_ENROLLMENT + 2 DRAFT_TERM_LETTER + CHECK_AVAILITY + UPDATE_CAQH
    expect(prismaMock.task.createMany).toHaveBeenCalledOnce();
    const createCall = prismaMock.task.createMany.mock.calls[0]![0];
    const tasks = (createCall as any).data;

    expect(tasks).toHaveLength(6);

    const types = tasks.map((t: any) => t.type);
    expect(types.filter((t: string) => t === 'TERMINATE_ENROLLMENT')).toHaveLength(2);
    expect(types.filter((t: string) => t === 'DRAFT_TERM_LETTER')).toHaveLength(2);
    expect(types.filter((t: string) => t === 'CHECK_AVAILITY')).toHaveLength(1);
    expect(types.filter((t: string) => t === 'UPDATE_CAQH')).toHaveLength(1);

    // Enrollment-specific tasks should have enrollmentId set
    const termTasks = tasks.filter((t: any) => t.type === 'TERMINATE_ENROLLMENT');
    expect(termTasks.every((t: any) => t.enrollmentId !== null)).toBe(true);

    // Provider-level tasks should have enrollmentId = null
    const checkAvaility = tasks.find((t: any) => t.type === 'CHECK_AVAILITY');
    expect(checkAvaility.enrollmentId).toBeNull();
    const updateCaqh = tasks.find((t: any) => t.type === 'UPDATE_CAQH');
    expect(updateCaqh.enrollmentId).toBeNull();
  });

  it('does not create duplicate tasks (idempotency)', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollment1] as any);

    // All tasks already exist
    prismaMock.task.findMany.mockResolvedValueOnce([
      { type: 'TERMINATE_ENROLLMENT', enrollmentId: mockEnrollment1.id },
      { type: 'DRAFT_TERM_LETTER', enrollmentId: mockEnrollment1.id },
      { type: 'CHECK_AVAILITY', enrollmentId: null },
      { type: 'UPDATE_CAQH', enrollmentId: null },
    ] as any);

    await triggerTerminationWorkflow(PROVIDER_ID, mockEnrollment1.id);

    expect(prismaMock.task.createMany).not.toHaveBeenCalled();
  });

  it('skips enrollments without effectiveDate', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

    await triggerTerminationWorkflow(PROVIDER_ID, 'some-enrollment-id');

    expect(prismaMock.task.createMany).not.toHaveBeenCalled();
  });

  it('auto-generates draft letters for new DRAFT_TERM_LETTER tasks', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollment1] as any);
    prismaMock.task.findMany
      .mockResolvedValueOnce([]) // existing tasks query
      .mockResolvedValueOnce([ // newLetterTasks query
        { id: 'new-letter-task-id', enrollmentId: mockEnrollment1.id },
      ] as any);
    prismaMock.task.createMany.mockResolvedValue({ count: 4 } as any);

    await triggerTerminationWorkflow(PROVIDER_ID, mockEnrollment1.id);

    // Wait for fire-and-forget promises
    await new Promise((r) => setTimeout(r, 50));

    expect(generateTerminationLetter).toHaveBeenCalledWith(
      PROVIDER_ID,
      mockEnrollment1.id,
      'new-letter-task-id'
    );
  });

  it('does not throw on error (fire-and-forget)', async () => {
    prismaMock.payerEnrollment.findMany.mockRejectedValue(new Error('DB connection failed'));

    await expect(
      triggerTerminationWorkflow(PROVIDER_ID, 'some-enrollment-id')
    ).resolves.toBeUndefined();
  });

  it('only creates missing tasks when some already exist', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollment1] as any);

    prismaMock.task.findMany
      .mockResolvedValueOnce([
        { type: 'TERMINATE_ENROLLMENT', enrollmentId: mockEnrollment1.id },
        { type: 'CHECK_AVAILITY', enrollmentId: null },
      ] as any)
      .mockResolvedValueOnce([ // newLetterTasks query
        { id: 'new-draft-task', enrollmentId: mockEnrollment1.id },
      ] as any);

    prismaMock.task.createMany.mockResolvedValue({ count: 2 } as any);

    await triggerTerminationWorkflow(PROVIDER_ID, mockEnrollment1.id);

    expect(prismaMock.task.createMany).toHaveBeenCalledOnce();
    const tasks = (prismaMock.task.createMany.mock.calls[0]![0] as any).data;

    expect(tasks).toHaveLength(2);
    const types = tasks.map((t: any) => t.type);
    expect(types).toContain('DRAFT_TERM_LETTER');
    expect(types).toContain('UPDATE_CAQH');
    expect(types).not.toContain('TERMINATE_ENROLLMENT');
    expect(types).not.toContain('CHECK_AVAILITY');
  });
});
