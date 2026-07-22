import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((...allowedRoles: string[]) => (req: any, res: any, next: any) => {
    const role = req.user?.role;
    // Mirror production: lanyard_staff inherits anywhere credentialing_staff is allowed.
    const allowed = allowedRoles.includes(role) || (role === 'lanyard_staff' && allowedRoles.includes('credentialing_staff'));
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
    }
    next();
  }),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: vi.fn((_req: any, _res: any, next: any) => next()),
  getPracticeRelationFilter: vi.fn(() => ({})),
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/task.service.js', () => ({
  createTask: vi.fn(),
}));

vi.mock('../services/staff-task.service.js', () => ({
  listStaffTasks: vi.fn(),
  getMyTaskCounts: vi.fn(),
  listAssignees: vi.fn(),
  createStaffTask: vi.fn(),
  claimTask: vi.fn(),
  assertAssignableUser: vi.fn(),
  notifyAssignee: vi.fn(),
  getReviewStats: vi.fn(),
  listMyOverdueUnanswered: vi.fn(),
  ASSIGNABLE_ROLES: ['admin', 'lanyard_staff'],
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// after mocks:
import taskRoutes from './task.routes.js';
import * as staffSvc from '../services/staff-task.service.js';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, staffUser } from '../../tests/helpers/fixtures.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const TASK_ID = 'task-1-id';
const PROVIDER_ID = '11111111-1111-4111-a111-111111111111';
const STAFF_USER_UUID = '00000000-0000-4000-a000-000000000099';

describe('GET /tasks (staff list)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns tasks with meta for admin', async () => {
    vi.mocked(staffSvc.listStaffTasks).mockResolvedValue({ tasks: [{ id: 't1' }] as any, total: 1 });
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks?view=my');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });

  it('403s for practice-side credentialing_staff', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).get('/tasks?view=my');
    expect(res.status).toBe(403);
  });

  it('200s for lanyard_staff (internal team, not practice-side)', async () => {
    vi.mocked(staffSvc.listStaffTasks).mockResolvedValue({ tasks: [], total: 0 });
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get('/tasks?view=my');
    expect(res.status).toBe(200);
  });
});

describe('GET /tasks/counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns my open/overdue counts', async () => {
    vi.mocked(staffSvc.getMyTaskCounts).mockResolvedValue({ open: 4, overdue: 1 });
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks/counts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ open: 4, overdue: 1 });
  });

  it('403s for practice-side credentialing_staff', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).get('/tasks/counts');
    expect(res.status).toBe(403);
  });
});

describe('GET /tasks/assignees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns assignable users', async () => {
    vi.mocked(staffSvc.listAssignees).mockResolvedValue([
      { id: 'u1', firstName: 'A', lastName: 'B', role: 'admin' },
    ] as any);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks/assignees');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('403s for practice-side credentialing_staff', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).get('/tasks/assignees');
    expect(res.status).toBe(403);
  });
});

// ==========================================
// Provider-less (internal/pool) task fail-closed behavior
//
// Note on the mock: the authorize() mock above checks literal role membership
// against the route's ('admin', 'credentialing_staff') list, so a lanyard_staff
// request would 403 at the authorize step here even though production authorize()
// (src/middleware/auth.middleware.ts) makes lanyard_staff inherit credentialing_staff
// route access. That inheritance can't be exercised faithfully under this literal
// mock, so these tests cover admin-allowed + credentialing_staff-denied only.
// ==========================================
describe('Provider-less tasks (null providerId) fail closed to internal roles', () => {
  const NULL_PROVIDER_TASK_ID = 'task-null-provider-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /tasks/:taskId with a provider-less task returns 404 for credentialing_staff', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: NULL_PROVIDER_TASK_ID,
      providerId: null,
    } as any);

    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).get(`/tasks/${NULL_PROVIDER_TASK_ID}`);

    expect(res.status).toBe(404);
  });

  it('GET /tasks/:taskId with a provider-less task returns 200 for admin', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: NULL_PROVIDER_TASK_ID,
      providerId: null,
      enrollment: null,
      assignedTo: null,
      completedBy: null,
      terminationLetters: [],
    } as any);

    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get(`/tasks/${NULL_PROVIDER_TASK_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(NULL_PROVIDER_TASK_ID);
  });

  it('PATCH /tasks/:taskId with a provider-less task returns 404 for credentialing_staff and does not update', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: NULL_PROVIDER_TASK_ID,
      providerId: null,
      status: 'PENDING',
    } as any);

    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app)
      .patch(`/tasks/${NULL_PROVIDER_TASK_ID}`)
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(404);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });
});

describe('POST /tasks (guided create)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a guided task and returns 201', async () => {
    vi.mocked(staffSvc.createStaffTask).mockResolvedValue({ id: 't1', title: 'Follow Up — Aetna Better Health' } as any);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'FOLLOW_UP', payerId: PROVIDER_ID });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Follow Up — Aetna Better Health');
  });

  it('400s on taskGroup CHECK_IN (system-only)', async () => {
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'CHECK_IN' });
    expect(res.status).toBe(400);
    expect(vi.mocked(staffSvc.createStaffTask)).not.toHaveBeenCalled();
  });

  it('ignores a stray title (deploy-skew tolerance) — 201, composed title wins', async () => {
    vi.mocked(staffSvc.createStaffTask).mockResolvedValue({ id: 't1', title: 'Escalation' } as any);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'ESCALATION', title: 'typed title from a stale client' });
    expect(res.status).toBe(201);
    const svcInput = vi.mocked(staffSvc.createStaffTask).mock.calls[0][0] as Record<string, unknown>;
    expect(svcInput['title']).toBeUndefined();
  });

  it('400s when the provider is not at the selected practice', async () => {
    vi.mocked(staffSvc.createStaffTask).mockRejectedValue(new Error('PROVIDER_PRACTICE_MISMATCH'));
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'CALL_BACK', practiceId: PROVIDER_ID, providerId: STAFF_USER_UUID });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("That provider isn't at the selected practice");
  });

  it('400s when assignee is not admin/lanyard_staff (v1 rule unchanged)', async () => {
    vi.mocked(staffSvc.createStaffTask).mockRejectedValue(new Error('ASSIGNEE_NOT_ALLOWED'));
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'FOLLOW_UP', assignedToId: STAFF_USER_UUID });
    expect(res.status).toBe(400);
  });

  it('403s for practice-side credentialing_staff (fail closed)', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).post('/tasks').send({ taskGroup: 'FOLLOW_UP' });
    expect(res.status).toBe(403);
  });
});

describe('POST /tasks/:taskId/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('409s when already claimed', async () => {
    vi.mocked(staffSvc.claimTask).mockResolvedValue(false);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post(`/tasks/${TASK_ID}/claim`);
    expect(res.status).toBe(409);
  });

  it('200s and returns the claim when successful', async () => {
    vi.mocked(staffSvc.claimTask).mockResolvedValue(true);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post(`/tasks/${TASK_ID}/claim`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ taskId: TASK_ID, assignedToId: adminUser.id });
  });
});

describe('DELETE /tasks/:taskId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403s when a lanyard_staff user deletes a task they did not create', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: TASK_ID, createdById: 'someone-else' } as any);
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).delete(`/tasks/${TASK_ID}`);
    expect(res.status).toBe(403);
  });

  it('204s when the creator deletes their own task', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: TASK_ID, createdById: staffUser.id } as any);
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).delete(`/tasks/${TASK_ID}`);
    expect(res.status).toBe(204);
    expect(prismaMock.task.delete).toHaveBeenCalledWith({ where: { id: TASK_ID } });
  });

  it('204s when an admin deletes a task created by someone else', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: TASK_ID, createdById: 'someone-else' } as any);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).delete(`/tasks/${TASK_ID}`);
    expect(res.status).toBe(204);
  });

  it('404s when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).delete(`/tasks/${TASK_ID}`);
    expect(res.status).toBe(404);
  });
});

// ==========================================
// PATCH /tasks/:taskId — staff-only field guard + assignee validation/auto-status
// (staff/pool tasks only — providerId null; provider-linked tasks keep their
// pre-existing assignedToId behavior, covered by task.routes.test.ts)
// ==========================================
describe('PATCH /tasks/:taskId (staff/pool task assignment)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403s when credentialing_staff touches a staff-only field (priority)', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ priority: 'HIGH' });
    expect(res.status).toBe(403);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('auto-sets IN_PROGRESS and notifies when assigning a pending pool task', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID, providerId: null, status: 'PENDING', assignedToId: null, title: 'Pool task',
    } as any);
    prismaMock.task.update.mockResolvedValue({ id: TASK_ID, status: 'IN_PROGRESS', assignedToId: STAFF_USER_UUID } as any);
    vi.mocked(staffSvc.assertAssignableUser).mockResolvedValue(undefined);

    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ assignedToId: STAFF_USER_UUID });

    expect(res.status).toBe(200);
    expect(staffSvc.assertAssignableUser).toHaveBeenCalledWith(STAFF_USER_UUID);
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedToId: STAFF_USER_UUID, status: 'IN_PROGRESS' }),
      })
    );
    expect(staffSvc.notifyAssignee).toHaveBeenCalledWith(STAFF_USER_UUID, TASK_ID, 'Pool task');
  });

  it('auto-sets PENDING when unassigning back to the pool', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID, providerId: null, status: 'IN_PROGRESS', assignedToId: 'some-user-id', title: 'Pool task',
    } as any);
    prismaMock.task.update.mockResolvedValue({ id: TASK_ID, status: 'PENDING', assignedToId: null } as any);

    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ assignedToId: null });

    expect(res.status).toBe(200);
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedToId: null, status: 'PENDING' }),
      })
    );
    expect(staffSvc.notifyAssignee).not.toHaveBeenCalled();
  });

  it('400s when the new assignee is not an allowed staff user', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID, providerId: null, status: 'PENDING', assignedToId: null, title: 'Pool task',
    } as any);
    vi.mocked(staffSvc.assertAssignableUser).mockRejectedValue(new Error('ASSIGNEE_NOT_ALLOWED'));

    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ assignedToId: STAFF_USER_UUID });

    expect(res.status).toBe(400);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  // Proves the assignee-role rule is now GLOBAL, not just for provider-less
  // pool tasks: a provider-linked task reassigned to a non-admin/lanyard_staff
  // user must also 400.
  it('400s when reassigning a provider-linked task to a non-admin/lanyard_staff user', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID, providerId: PROVIDER_ID, status: 'PENDING', assignedToId: null, title: 'Provider task',
    } as any);
    vi.mocked(staffSvc.assertAssignableUser).mockRejectedValue(new Error('ASSIGNEE_NOT_ALLOWED'));

    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ assignedToId: STAFF_USER_UUID });

    expect(res.status).toBe(400);
    expect(staffSvc.assertAssignableUser).toHaveBeenCalledWith(STAFF_USER_UUID);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });
});

describe('admin gates (the recurring role-gate 403 bug class)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('403s lanyard_staff on view=needs_review', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get('/tasks?view=needs_review');
    expect(res.status).toBe(403);
    expect(vi.mocked(staffSvc.listStaffTasks)).not.toHaveBeenCalled();
  });

  it('200s admin on view=needs_review', async () => {
    vi.mocked(staffSvc.listStaffTasks).mockResolvedValue({ tasks: [], total: 0 });
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks?view=needs_review');
    expect(res.status).toBe(200);
  });

  it('403s lanyard_staff on /tasks/review-stats', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get('/tasks/review-stats');
    expect(res.status).toBe(403);
  });

  it('200s admin on /tasks/review-stats', async () => {
    vi.mocked(staffSvc.getReviewStats).mockResolvedValue({ needsReviewCount: 3, missedLast30: 7, mostMissedBy: { name: 'Dana R', count: 4 }, slowestPayer: { name: 'Molina TX', count: 3 } });
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks/review-stats');
    expect(res.status).toBe(200);
    expect(res.body.data.needsReviewCount).toBe(3);
  });
});

describe('GET /tasks/overdue-mine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200s for lanyard_staff (their own dialog feed)', async () => {
    vi.mocked(staffSvc.listMyOverdueUnanswered).mockResolvedValue([{ id: 't1', title: 'Call Back — Aetna Better Health — Sunrise', description: null, dueDate: new Date('2026-07-10') }] as any);
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get('/tasks/overdue-mine');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('403s practice-side credentialing_staff', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).get('/tasks/overdue-mine');
    expect(res.status).toBe(403);
  });
});

describe('PATCH /tasks/:taskId — overdue reasons', () => {
  beforeEach(() => vi.clearAllMocks());
  const baseTask = { id: TASK_ID, providerId: null, status: 'IN_PROGRESS', assignedToId: 'staff-user-id', title: 'Call Back — Aetna', overdueReason: null } as any;

  it('assignee sets a reason; overdueReasonAt is stamped', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask);
    prismaMock.task.update.mockResolvedValue({ ...baseTask, overdueReason: 'Payer portal was down all week' } as any);
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' }); // fixture id = 'staff-user-id' = assignee
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ overdueReason: 'Payer portal was down all week' });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBe('Payer portal was down all week');
    expect(data.overdueReasonAt).toBeInstanceOf(Date);
  });

  it('admin can set a reason on anyone\'s task', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask);
    prismaMock.task.update.mockResolvedValue(baseTask);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ overdueReason: 'Resolved by email' });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBe('Resolved by email');
    expect(data.overdueReasonAt).toBeInstanceOf(Date);
  });

  it('assignee clears a reason with an explicit null — overdueReason and overdueReasonAt both cleared', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, overdueReason: 'was down' });
    prismaMock.task.update.mockResolvedValue({ ...baseTask, overdueReason: null } as any);
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' }); // fixture id = 'staff-user-id' = assignee
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ overdueReason: null });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBeNull();
    expect(data.overdueReasonAt).toBeNull();
  });

  it('a future dueDate WITH an overdueReason in the same body writes the reason, not the auto-clear', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, overdueReason: 'was down' });
    prismaMock.task.update.mockResolvedValue(baseTask);
    const app = createTestApp(taskRoutes, adminUser);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const res = await request(app)
      .patch(`/tasks/${TASK_ID}`)
      .send({ dueDate: future, overdueReason: 'Payer confirmed new deadline' });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBe('Payer confirmed new deadline');
    expect(data.overdueReasonAt).toBeInstanceOf(Date);
  });

  it('403s a lanyard_staff user who is NOT the assignee', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, assignedToId: 'someone-else' });
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ overdueReason: 'not my task' });
    expect(res.status).toBe(403);
  });

  it('a FUTURE dueDate clears reason + timestamp (New deadline re-arms the dialog)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, overdueReason: 'was down' });
    prismaMock.task.update.mockResolvedValue(baseTask);
    const app = createTestApp(taskRoutes, adminUser);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ dueDate: future });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBeNull();
    expect(data.overdueReasonAt).toBeNull();
  });

  it('a PAST dueDate does NOT clear the reason', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, overdueReason: 'was down' });
    prismaMock.task.update.mockResolvedValue(baseTask);
    const app = createTestApp(taskRoutes, adminUser);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ dueDate: past });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBeUndefined(); // untouched
  });
});
