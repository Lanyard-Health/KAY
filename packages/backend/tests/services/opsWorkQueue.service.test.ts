import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../helpers/mock-prisma.js';

// ==========================================
// Mocks
// ==========================================

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/utils/cache.js', () => ({
  getCached: vi.fn(() => undefined),
  setCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../../src/services/notification.service.js', () => ({
  notificationService: {
    notifyAdminUsers: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  createWorkItem,
  getWorkQueue,
  updateWorkItemStatus,
  assignWorkItem,
  bulkAssignWorkItems,
  checkSlaBreaches,
  autoCreateWorkItems,
} from '../../src/services/opsWorkQueue.service.js';

// ==========================================
// Shared fixtures
// ==========================================

const mockWorkItem = {
  id: 'wi-1',
  title: 'Test Work Item',
  description: null,
  category: 'general',
  priority: 'normal',
  status: 'backlog',
  practiceId: null,
  providerId: null,
  enrollmentId: null,
  assignedToId: null,
  dueDate: null,
  slaDeadline: null,
  estimatedMinutes: null,
  actualMinutes: null,
  blockerNotes: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  practice: null,
  provider: null,
  enrollment: null,
  assignedTo: null,
  comments: [],
};

// ==========================================
// 1. createWorkItem
// ==========================================

describe('createWorkItem', () => {
  beforeEach(() => {
    prismaMock.opsAssignment.findFirst.mockResolvedValue(null);
  });

  it('creates a work item with provided data', async () => {
    prismaMock.opsWorkItem.create.mockResolvedValue(mockWorkItem as any);

    const result = await createWorkItem({
      title: 'Test Work Item',
      category: 'general' as any,
    });

    expect(prismaMock.opsWorkItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Test Work Item',
          category: 'general',
          priority: 'normal',
        }),
      }),
    );
    expect(result.id).toBe('wi-1');
  });

  it('uses provided priority instead of default', async () => {
    prismaMock.opsWorkItem.create.mockResolvedValue({
      ...mockWorkItem,
      priority: 'urgent',
    } as any);

    await createWorkItem({
      title: 'Urgent Item',
      category: 'follow_up' as any,
      priority: 'urgent' as any,
    });

    expect(prismaMock.opsWorkItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 'urgent',
        }),
      }),
    );
  });

  it('auto-assigns to staff when no assignedToId is provided', async () => {
    prismaMock.opsAssignment.findFirst.mockResolvedValue({
      staffId: 'auto-staff-1',
    } as any);
    prismaMock.opsWorkItem.create.mockResolvedValue({
      ...mockWorkItem,
      assignedToId: 'auto-staff-1',
    } as any);

    await createWorkItem({
      title: 'Auto-assigned item',
      category: 'general' as any,
      practiceId: 'practice-1',
    });

    expect(prismaMock.opsWorkItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedToId: 'auto-staff-1',
        }),
      }),
    );
  });

  it('uses explicit assignedToId when provided', async () => {
    prismaMock.opsWorkItem.create.mockResolvedValue({
      ...mockWorkItem,
      assignedToId: 'explicit-staff',
    } as any);

    await createWorkItem({
      title: 'Explicit assignment',
      category: 'general' as any,
      assignedToId: 'explicit-staff',
    });

    expect(prismaMock.opsAssignment.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.opsWorkItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedToId: 'explicit-staff',
        }),
      }),
    );
  });
});

// ==========================================
// 2. getWorkQueue
// ==========================================

describe('getWorkQueue', () => {
  it('returns paginated results with default page and limit', async () => {
    prismaMock.opsWorkItem.findMany.mockResolvedValue([mockWorkItem] as any);
    prismaMock.opsWorkItem.count.mockResolvedValue(1);

    const result = await getWorkQueue({});

    expect(result).toEqual({
      items: [mockWorkItem],
      total: 1,
      page: 1,
      limit: 25,
    });
  });

  it('applies assigneeId filter', async () => {
    prismaMock.opsWorkItem.findMany.mockResolvedValue([]);
    prismaMock.opsWorkItem.count.mockResolvedValue(0);

    await getWorkQueue({ assigneeId: 'staff-1' });

    expect(prismaMock.opsWorkItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignedToId: 'staff-1',
        }),
      }),
    );
  });

  it('applies status filter as array', async () => {
    prismaMock.opsWorkItem.findMany.mockResolvedValue([]);
    prismaMock.opsWorkItem.count.mockResolvedValue(0);

    await getWorkQueue({ status: ['todo', 'in_progress'] });

    expect(prismaMock.opsWorkItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['todo', 'in_progress'] },
        }),
      }),
    );
  });

  it('applies search filter with OR conditions', async () => {
    prismaMock.opsWorkItem.findMany.mockResolvedValue([]);
    prismaMock.opsWorkItem.count.mockResolvedValue(0);

    await getWorkQueue({ search: 'test' });

    expect(prismaMock.opsWorkItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { title: { contains: 'test', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });

  it('paginates correctly with custom page and limit', async () => {
    prismaMock.opsWorkItem.findMany.mockResolvedValue([]);
    prismaMock.opsWorkItem.count.mockResolvedValue(100);

    const result = await getWorkQueue({ page: 3, limit: 10 });

    expect(prismaMock.opsWorkItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 10,
      }),
    );
    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
  });

  it('handles slaStatus filter by fetching all and filtering in JS', async () => {
    const now = new Date();
    const pastDeadline = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    prismaMock.opsWorkItem.findMany.mockResolvedValue([
      { ...mockWorkItem, id: 'wi-breached', slaDeadline: pastDeadline, priority: 'normal' },
      { ...mockWorkItem, id: 'wi-ok', slaDeadline: null, dueDate: null, priority: 'normal' },
    ] as any);

    const result = await getWorkQueue({ slaStatus: 'breached' });

    expect(result.items).toHaveLength(1);
    expect((result.items[0] as any).id).toBe('wi-breached');
  });
});

// ==========================================
// 3. updateWorkItemStatus
// ==========================================

describe('updateWorkItemStatus', () => {
  it('sets startedAt when status changes to in_progress', async () => {
    prismaMock.opsWorkItem.findUniqueOrThrow.mockResolvedValue({
      startedAt: null,
      completedAt: null,
    } as any);
    prismaMock.opsWorkItem.update.mockResolvedValue({
      ...mockWorkItem,
      status: 'in_progress',
    } as any);

    await updateWorkItemStatus('wi-1', 'in_progress' as any);

    expect(prismaMock.opsWorkItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'in_progress',
          startedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does not overwrite existing startedAt', async () => {
    const existingStart = new Date('2026-01-01');
    prismaMock.opsWorkItem.findUniqueOrThrow.mockResolvedValue({
      startedAt: existingStart,
      completedAt: null,
    } as any);
    prismaMock.opsWorkItem.update.mockResolvedValue({
      ...mockWorkItem,
      status: 'in_progress',
    } as any);

    await updateWorkItemStatus('wi-1', 'in_progress' as any);

    expect(prismaMock.opsWorkItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'in_progress' },
      }),
    );
  });

  it('sets completedAt when status changes to done', async () => {
    prismaMock.opsWorkItem.findUniqueOrThrow.mockResolvedValue({
      startedAt: new Date(),
      completedAt: null,
    } as any);
    prismaMock.opsWorkItem.update.mockResolvedValue({
      ...mockWorkItem,
      status: 'done',
    } as any);

    await updateWorkItemStatus('wi-1', 'done' as any);

    expect(prismaMock.opsWorkItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'done',
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('sets completedAt when status changes to cancelled', async () => {
    prismaMock.opsWorkItem.findUniqueOrThrow.mockResolvedValue({
      startedAt: null,
      completedAt: null,
    } as any);
    prismaMock.opsWorkItem.update.mockResolvedValue({
      ...mockWorkItem,
      status: 'cancelled',
    } as any);

    await updateWorkItemStatus('wi-1', 'cancelled' as any);

    expect(prismaMock.opsWorkItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('creates a comment when notes are provided', async () => {
    prismaMock.opsWorkItem.findUniqueOrThrow.mockResolvedValue({
      startedAt: null,
      completedAt: null,
    } as any);
    prismaMock.opsWorkItem.update.mockResolvedValue({
      ...mockWorkItem,
      assignedToId: 'staff-1',
    } as any);
    prismaMock.opsWorkItemComment.create.mockResolvedValue({} as any);

    await updateWorkItemStatus('wi-1', 'in_progress' as any, 'Starting work');

    expect(prismaMock.opsWorkItemComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workItemId: 'wi-1',
          content: expect.stringContaining('Starting work'),
          isInternal: true,
        }),
      }),
    );
  });
});

// ==========================================
// 4. assignWorkItem
// ==========================================

describe('assignWorkItem', () => {
  it('updates the assigned staff on a work item', async () => {
    prismaMock.opsWorkItem.update.mockResolvedValue({
      ...mockWorkItem,
      assignedToId: 'staff-2',
    } as any);

    const result = await assignWorkItem('wi-1', 'staff-2');

    expect(prismaMock.opsWorkItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wi-1' },
        data: { assignedToId: 'staff-2' },
      }),
    );
    expect(result.assignedToId).toBe('staff-2');
  });
});

// ==========================================
// 5. bulkAssignWorkItems
// ==========================================

describe('bulkAssignWorkItems', () => {
  it('updates multiple work items and returns count', async () => {
    prismaMock.opsWorkItem.updateMany.mockResolvedValue({ count: 3 } as any);

    const result = await bulkAssignWorkItems(['wi-1', 'wi-2', 'wi-3'], 'staff-1');

    expect(prismaMock.opsWorkItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['wi-1', 'wi-2', 'wi-3'] } },
      data: { assignedToId: 'staff-1' },
    });
    expect(result).toBe(3);
  });
});

// ==========================================
// 6. checkSlaBreaches
// ==========================================

describe('checkSlaBreaches', () => {
  it('returns 0 when no enrollments have breached SLA', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

    const result = await checkSlaBreaches();

    expect(result).toBe(0);
  });

  it('marks breached enrollments and creates urgent work items', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([
      {
        id: 'enr-1',
        provider: { id: 'prov-1', firstName: 'Jane', lastName: 'Doe', practiceId: 'p1' },
        payer: { id: 'payer-1', name: 'Aetna' },
      },
    ] as any);
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);
    prismaMock.opsAssignment.findFirst.mockResolvedValue(null);
    prismaMock.opsWorkItem.create.mockResolvedValue(mockWorkItem as any);

    const result = await checkSlaBreaches();

    expect(result).toBe(1);
    expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'enr-1' },
        data: { slaBreachedAt: expect.any(Date) },
      }),
    );
    expect(prismaMock.opsWorkItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: expect.stringContaining('SLA Breached'),
          priority: 'urgent',
          category: 'follow_up',
          enrollmentId: 'enr-1',
        }),
      }),
    );
  });

  it('filters only non-terminal, non-breached enrollments past SLA date', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([]);

    await checkSlaBreaches();

    expect(prismaMock.payerEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slaTargetDate: { lt: expect.any(Date) },
          status: { notIn: ['approved', 'denied', 'terminated'] },
          slaBreachedAt: null,
        }),
      }),
    );
  });
});

// ==========================================
// 7. autoCreateWorkItems
// ==========================================

describe('autoCreateWorkItems', () => {
  it('returns 0 when no workflow steps exist', async () => {
    prismaMock.payerEnrollment.findUniqueOrThrow.mockResolvedValue({
      id: 'enr-1',
      createdAt: new Date(),
      provider: { id: 'prov-1', firstName: 'Jane', lastName: 'Doe', practiceId: 'p1' },
      payer: { id: 'payer-1', name: 'Aetna' },
    } as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([]);

    const result = await autoCreateWorkItems('enr-1');

    expect(result).toBe(0);
    expect(prismaMock.opsWorkItem.createMany).not.toHaveBeenCalled();
  });

  it('creates work items from workflow steps', async () => {
    prismaMock.payerEnrollment.findUniqueOrThrow.mockResolvedValue({
      id: 'enr-1',
      createdAt: new Date('2026-02-01'),
      provider: { id: 'prov-1', firstName: 'Jane', lastName: 'Doe', practiceId: 'p1' },
      payer: { id: 'payer-1', name: 'Aetna' },
    } as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([
      { name: 'Step 1', description: 'First step', actionType: 'form_submission', estimatedDays: 3, stepOrder: 1 },
      { name: 'Step 2', description: 'Second step', actionType: 'phone_call', estimatedDays: 7, stepOrder: 2 },
    ] as any);
    prismaMock.opsAssignment.findFirst.mockResolvedValue(null);
    prismaMock.opsWorkItem.createMany.mockResolvedValue({ count: 2 } as any);

    const result = await autoCreateWorkItems('enr-1');

    expect(result).toBe(2);
    expect(prismaMock.opsWorkItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          title: 'Step 1',
          category: 'data_entry',
          enrollmentId: 'enr-1',
          providerId: 'prov-1',
          practiceId: 'p1',
        }),
        expect.objectContaining({
          title: 'Step 2',
          category: 'payer_outreach',
        }),
      ]),
    });
  });

  it('auto-assigns work items to staff from assignment lookup', async () => {
    prismaMock.payerEnrollment.findUniqueOrThrow.mockResolvedValue({
      id: 'enr-1',
      createdAt: new Date(),
      provider: { id: 'prov-1', firstName: 'Jane', lastName: 'Doe', practiceId: 'p1' },
      payer: { id: 'payer-1', name: 'Aetna' },
    } as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([
      { name: 'Step 1', description: null, actionType: 'follow_up', estimatedDays: 5, stepOrder: 1 },
    ] as any);
    prismaMock.opsAssignment.findFirst.mockResolvedValue({ staffId: 'auto-staff' } as any);
    prismaMock.opsWorkItem.createMany.mockResolvedValue({ count: 1 } as any);

    await autoCreateWorkItems('enr-1');

    expect(prismaMock.opsWorkItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          assignedToId: 'auto-staff',
        }),
      ]),
    });
  });
});
