import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((...allowedRoles: string[]) => (req: any, res: any, next: any) => {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        error: { message: 'Forbidden' },
      });
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
