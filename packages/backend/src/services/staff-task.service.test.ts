import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});
vi.mock('../utils/logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { assertAssignableUser, createStaffTask, claimTask, listStaffTasks } from './staff-task.service.js';

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

describe('createStaffTask', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects more than one linked record', async () => {
    await expect(createStaffTask({ title: 'x', priority: 'NORMAL', providerId: USER_ID, practiceId: USER_ID }, USER_ID))
      .rejects.toThrow('MULTIPLE_LINKS');
  });
  it('sets IN_PROGRESS when created with an assignee', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'admin', isActive: true } as any);
    prismaMock.task.create.mockResolvedValue({ id: TASK_ID, title: 'x' } as any);
    prismaMock.inAppNotification.create.mockResolvedValue({} as any);
    await createStaffTask({ title: 'x', priority: 'NORMAL', assignedToId: USER_ID }, USER_ID);
    expect(prismaMock.task.create.mock.calls[0][0].data.status).toBe('IN_PROGRESS');
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
    const normal = { id: 'n1', priority: 'NORMAL', status: 'PENDING', dueDate: new Date('2026-07-20'), createdAt: new Date() };
    const urgent = { id: 'u1', priority: 'URGENT', status: 'PENDING', dueDate: null, createdAt: new Date() };
    const overdue = { id: 'o1', priority: 'LOW', status: 'PENDING', dueDate: new Date('2026-07-01'), createdAt: new Date() };
    prismaMock.task.findMany.mockResolvedValue([normal, urgent, overdue] as any);
    prismaMock.task.count.mockResolvedValue(3 as any);
    const { tasks } = await listStaffTasks({ view: 'all', userId: 'u', limit: 2, offset: 0 });
    expect(tasks.map((t: any) => t.id)).toEqual(['o1', 'u1']); // overdue first, then urgent; NORMAL pushed to page 2
    expect(prismaMock.task.findMany.mock.calls[0][0]).not.toHaveProperty('skip'); // slicing happens after the sort, not in the DB
  });
});
