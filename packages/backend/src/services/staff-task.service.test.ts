import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});
vi.mock('../utils/logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { assertAssignableUser, createStaffTask, claimTask, listStaffTasks, resolveGuidedEdit, getMyTaskCounts } from './staff-task.service.js';

const USER_ID = '00000000-0000-4000-a000-000000000001';
const TASK_ID = '00000000-0000-4000-a000-000000000002';

describe('assertAssignableUser', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects a practice-side credentialing_staff user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'credentialing_staff', isActive: true } as any);
    await expect(assertAssignableUser(USER_ID)).rejects.toThrow('ASSIGNEE_NOT_ALLOWED');
  });
  it('accepts an active lanyard_staff user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'lanyard_staff', isActive: true } as any);
    await expect(assertAssignableUser(USER_ID)).resolves.toBeUndefined();
  });
});

describe('createStaffTask (v2 guided)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects enrollment combined with a provider/practice link', async () => {
    await expect(createStaffTask(
      { taskGroup: 'FOLLOW_UP', priority: 'NORMAL', enrollmentId: TASK_ID, practiceId: TASK_ID },
      USER_ID,
    )).rejects.toThrow('ENROLLMENT_LINK_EXCLUSIVE');
  });

  it('rejects a provider that is not at the selected practice', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({ name: 'Sunrise Behavioral Health' } as any);
    prismaMock.providerProfile.findUnique.mockResolvedValue({ practiceId: 'a-different-practice' } as any);
    await expect(createStaffTask(
      { taskGroup: 'CALL_BACK', priority: 'NORMAL', practiceId: 'practice-1', providerId: 'provider-1' },
      USER_ID,
    )).rejects.toThrow('PROVIDER_PRACTICE_MISMATCH');
  });

  it('allows payer + practice + provider to coexist when the provider belongs to the practice', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ name: 'Aetna Better Health' } as any);
    prismaMock.practice.findUnique.mockResolvedValue({ name: 'Sunrise Behavioral Health' } as any);
    prismaMock.providerProfile.findUnique.mockResolvedValue({ practiceId: 'practice-1' } as any);
    prismaMock.task.create.mockResolvedValue({ id: TASK_ID } as any);
    await createStaffTask(
      { taskGroup: 'CALL_BACK', priority: 'NORMAL', payerId: 'payer-1', practiceId: 'practice-1', providerId: 'provider-1' },
      USER_ID,
    );
    expect(prismaMock.task.create.mock.calls[0][0].data.title)
      .toBe('Call Back — Aetna Better Health — Sunrise Behavioral Health');
  });

  it('composes group-only and group+payer titles (provider never in the title)', async () => {
    prismaMock.task.create.mockResolvedValue({ id: TASK_ID } as any);
    await createStaffTask({ taskGroup: 'ESCALATION', priority: 'NORMAL' }, USER_ID);
    expect(prismaMock.task.create.mock.calls[0][0].data.title).toBe('Escalation');

    prismaMock.payer.findUnique.mockResolvedValue({ name: 'Molina Healthcare of Texas' } as any);
    await createStaffTask({ taskGroup: 'FOLLOW_UP', priority: 'NORMAL', payerId: 'payer-1' }, USER_ID);
    expect(prismaMock.task.create.mock.calls[1][0].data.title).toBe('Follow Up — Molina Healthcare of Texas');
  });

  it('maps note to description, keeps auto-IN_PROGRESS on assignment, and notifies the assignee', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'assignee-1', role: 'lanyard_staff', isActive: true } as any);
    prismaMock.task.create.mockResolvedValue({ id: TASK_ID } as any);
    prismaMock.inAppNotification.create.mockResolvedValue({} as any);
    await createStaffTask(
      { taskGroup: 'REQUEST_DOCUMENTS', priority: 'NORMAL', note: 'Chase the W-9', assignedToId: 'assignee-1' },
      USER_ID,
    );
    const data = prismaMock.task.create.mock.calls[0][0].data;
    expect(data.description).toBe('Chase the W-9');
    expect(data.status).toBe('IN_PROGRESS');
    expect(data.taskGroup).toBe('REQUEST_DOCUMENTS');
    expect(prismaMock.inAppNotification.create).toHaveBeenCalled();
  });

  it('400-class error when the payer id does not exist', async () => {
    prismaMock.payer.findUnique.mockResolvedValue(null);
    await expect(createStaffTask({ taskGroup: 'FOLLOW_UP', priority: 'NORMAL', payerId: 'nope' }, USER_ID))
      .rejects.toThrow('PAYER_NOT_FOUND');
  });
});

describe('listStaffTasks taskGroup filter', () => {
  it('passes taskGroup into the where clause', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
    prismaMock.task.count.mockResolvedValue(0);
    await listStaffTasks({ view: 'all', userId: USER_ID, taskGroup: 'CHECK_IN', limit: 50, offset: 0 });
    expect(prismaMock.task.findMany.mock.calls[0][0].where.taskGroup).toBe('CHECK_IN');
  });
});

describe('claimTask', () => {
  it('returns false when someone else already claimed (atomic guard)', async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 } as any);
    expect(await claimTask(TASK_ID, USER_ID)).toBe(false);
    expect(prismaMock.task.updateMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ assignedToId: null })
    );
  });
});

describe('listStaffTasks', () => {
  beforeEach(() => vi.clearAllMocks());
  it('sorts the full window before paginating (urgent no-due-date beats normal with due date)', async () => {
    const normal = { id: 'n1', priority: 'NORMAL', status: 'PENDING', dueDate: new Date(Date.now() + 5 * 86_400_000), createdAt: new Date() };
    const urgent = { id: 'u1', priority: 'URGENT', status: 'PENDING', dueDate: null, createdAt: new Date() };
    const overdue = { id: 'o1', priority: 'LOW', status: 'PENDING', dueDate: new Date(Date.now() - 14 * 86_400_000), createdAt: new Date() };
    prismaMock.task.findMany.mockResolvedValue([normal, urgent, overdue] as any);
    prismaMock.task.count.mockResolvedValue(3 as any);
    const { tasks } = await listStaffTasks({ view: 'all', userId: 'u', limit: 2, offset: 0 });
    expect(tasks.map((t: any) => t.id)).toEqual(['o1', 'u1']); // overdue first, then urgent; NORMAL pushed to page 2
    expect(prismaMock.task.findMany.mock.calls[0][0]).not.toHaveProperty('skip'); // slicing happens after the sort, not in the DB
  });
});

describe('resolveGuidedEdit', () => {
  beforeEach(() => vi.clearAllMocks());
  const existing = {
    taskGroup: 'FOLLOW_UP', payerId: 'payer-1', practiceId: null, providerId: null, enrollmentId: null,
  };

  it('keeps absent keys, applies present keys, and recomposes the title', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ name: 'Aetna Better Health' } as any);
    const result = await resolveGuidedEdit(existing, { taskGroup: 'CALL_BACK' });
    expect(result.data).toEqual({ taskGroup: 'CALL_BACK', payerId: 'payer-1', practiceId: null, providerId: null });
    expect(result.title).toBe('Call Back — Aetna Better Health');
  });

  it('explicit null clears a link and drops it from the recomposed title', async () => {
    const result = await resolveGuidedEdit(existing, { payerId: null });
    expect(result.data.payerId).toBeNull();
    expect(result.title).toBe('Follow Up');
    expect(prismaMock.payer.findUnique).not.toHaveBeenCalled();
  });

  it('re-validates provider-practice membership on the merged state', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ name: 'Aetna Better Health' } as any);
    prismaMock.practice.findUnique.mockResolvedValue({ name: 'Sunrise' } as any);
    prismaMock.providerProfile.findUnique.mockResolvedValue({ practiceId: 'other-practice' } as any);
    await expect(resolveGuidedEdit(existing, { practiceId: 'practice-1', providerId: 'provider-1' }))
      .rejects.toThrow('PROVIDER_PRACTICE_MISMATCH');
  });

  it('legacy task without a group: no title recomposition', async () => {
    const legacy = { taskGroup: null, payerId: null, practiceId: null, providerId: null, enrollmentId: null };
    const result = await resolveGuidedEdit(legacy, { practiceId: null });
    expect(result.title).toBeUndefined();
  });
});

describe('getMyTaskCounts', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns open/overdue scoped to me plus the unassigned pool count', async () => {
    prismaMock.task.count
      .mockResolvedValueOnce(3)  // my open
      .mockResolvedValueOnce(1)  // my overdue
      .mockResolvedValueOnce(5); // pool
    const counts = await getMyTaskCounts(USER_ID);
    expect(counts).toEqual({ open: 3, overdue: 1, pool: 5 });
    expect(prismaMock.task.count).toHaveBeenNthCalledWith(3, {
      where: { assignedToId: null, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
  });
});
