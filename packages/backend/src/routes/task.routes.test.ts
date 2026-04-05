import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import {
  adminUser,
  staffUser,
  providerUser,
} from '../../tests/helpers/fixtures.js';
import {
  mockProviderForTermination,
  mockTask,
  mockDraftLetterTask,
} from '../../tests/helpers/termination-fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
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

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import taskRoutes from './task.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { createTask } from '../services/task.service.js';

const PROVIDER_ID = mockProviderForTermination.id;
const TASK_ID = mockTask.id;
// Valid UUID for assignedToId (Zod requires UUID format)
const STAFF_USER_UUID = '00000000-0000-4000-a000-000000000099';

describe('Task Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // GET /providers/:providerId/tasks
  // ==========================================
  describe('GET /providers/:providerId/tasks', () => {
    const app = createTestApp(taskRoutes, adminUser);

    it('returns list of tasks for a provider', async () => {
      prismaMock.task.findMany.mockResolvedValue([mockTask] as any);

      const res = await request(app).get(`/providers/${PROVIDER_ID}/tasks`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].type).toBe('TERMINATE_ENROLLMENT');
    });

    it('filters by status query parameter', async () => {
      prismaMock.task.findMany.mockResolvedValue([]);

      await request(app).get(`/providers/${PROVIDER_ID}/tasks?status=COMPLETED`);

      expect(prismaMock.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            providerId: PROVIDER_ID,
            status: 'COMPLETED',
          }),
        })
      );
    });

    it('filters by type query parameter', async () => {
      prismaMock.task.findMany.mockResolvedValue([]);

      await request(app).get(`/providers/${PROVIDER_ID}/tasks?type=DRAFT_TERM_LETTER`);

      expect(prismaMock.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            providerId: PROVIDER_ID,
            type: 'DRAFT_TERM_LETTER',
          }),
        })
      );
    });

    it('provider user can GET their own tasks', async () => {
      const providerApp = createTestApp(taskRoutes, providerUser);
      prismaMock.task.findMany.mockResolvedValue([]);

      const res = await request(providerApp).get('/providers/provider-record-id/tasks');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================
  // POST /providers/:providerId/tasks
  // ==========================================
  describe('POST /providers/:providerId/tasks', () => {
    const app = createTestApp(taskRoutes, adminUser);

    it('creates a custom task (admin)', async () => {
      const mockedCreateTask = vi.mocked(createTask);
      mockedCreateTask.mockResolvedValue({
        ...mockTask,
        type: 'CUSTOM',
        title: 'Follow up with provider',
      } as any);

      const res = await request(app)
        .post(`/providers/${PROVIDER_ID}/tasks`)
        .send({
          title: 'Follow up with provider',
          description: 'Call provider about termination status',
          type: 'CUSTOM',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(mockedCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: PROVIDER_ID,
          title: 'Follow up with provider',
          type: 'CUSTOM',
        }),
        'admin-user-id',
      );
    });

    it('returns 403 when provider role tries to create task', async () => {
      const providerApp = createTestApp(taskRoutes, providerUser);

      const res = await request(providerApp)
        .post(`/providers/${PROVIDER_ID}/tasks`)
        .send({ title: 'Should not work' });

      expect(res.status).toBe(403);
    });

    it('returns 404 when provider does not exist', async () => {
      const { NotFoundError } = await import('../middleware/error.middleware.js');
      vi.mocked(createTask).mockRejectedValue(new NotFoundError('Provider'));

      const res = await request(app)
        .post(`/providers/${PROVIDER_ID}/tasks`)
        .send({ title: 'Test task' });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Provider not found');
    });

    it('returns 400 on validation failure', async () => {

      const res = await request(app)
        .post(`/providers/${PROVIDER_ID}/tasks`)
        .send({}); // Missing required title

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // GET /tasks/:taskId
  // ==========================================
  describe('GET /tasks/:taskId', () => {
    const app = createTestApp(taskRoutes, adminUser);

    it('returns a single task with details', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...mockTask,
        provider: { id: PROVIDER_ID, firstName: 'Sheree', lastName: 'Mitchell', npi: '9876543210' },
        enrollment: { payer: { name: 'Blue Cross Blue Shield' } },
        assignedTo: null,
        completedBy: null,
        terminationLetters: [],
      } as any);

      const res = await request(app).get(`/tasks/${TASK_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(TASK_ID);
    });

    it('returns 404 when task does not exist', async () => {
      prismaMock.task.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/tasks/nonexistent-id');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // PATCH /tasks/:taskId
  // ==========================================
  describe('PATCH /tasks/:taskId', () => {
    const app = createTestApp(taskRoutes, adminUser);

    it('updates task status and auto-sets completedAt/completedById on COMPLETED', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...mockTask,
        status: 'IN_PROGRESS',
      } as any);
      prismaMock.task.update.mockResolvedValue({
        ...mockTask,
        status: 'COMPLETED',
        completedAt: new Date(),
        completedById: adminUser.id,
      } as any);

      const res = await request(app)
        .patch(`/tasks/${TASK_ID}`)
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(200);
      expect(prismaMock.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETED',
            completedAt: expect.any(Date),
            completedById: 'admin-user-id',
          }),
        })
      );
    });

    it('clears completedAt/completedById when reverting from COMPLETED', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...mockTask,
        status: 'COMPLETED',
        completedAt: new Date(),
        completedById: 'admin-user-id',
      } as any);
      prismaMock.task.update.mockResolvedValue({
        ...mockTask,
        status: 'IN_PROGRESS',
        completedAt: null,
        completedById: null,
      } as any);

      const res = await request(app)
        .patch(`/tasks/${TASK_ID}`)
        .send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(200);
      expect(prismaMock.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'IN_PROGRESS',
            completedAt: null,
            completedById: null,
          }),
        })
      );
    });

    it('returns 403 when provider role tries to PATCH', async () => {
      const providerApp = createTestApp(taskRoutes, providerUser);

      const res = await request(providerApp)
        .patch(`/tasks/${TASK_ID}`)
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(403);
    });

    it('updates assignedToId and dueDate', async () => {
      prismaMock.task.findUnique.mockResolvedValue(mockTask as any);
      prismaMock.task.update.mockResolvedValue({
        ...mockTask,
        assignedToId: STAFF_USER_UUID,
        dueDate: new Date('2026-03-15'),
      } as any);

      const res = await request(app)
        .patch(`/tasks/${TASK_ID}`)
        .send({
          assignedToId: STAFF_USER_UUID,
          dueDate: '2026-03-15T00:00:00.000Z',
        });

      expect(res.status).toBe(200);
      expect(prismaMock.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedToId: STAFF_USER_UUID,
            dueDate: expect.any(Date),
          }),
        })
      );
    });

    it('returns 404 when task does not exist', async () => {
      prismaMock.task.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/tasks/nonexistent-id')
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(404);
    });

    it('staff user can update tasks', async () => {
      const staffApp = createTestApp(taskRoutes, staffUser);
      prismaMock.task.findUnique.mockResolvedValue(mockTask as any);
      prismaMock.task.update.mockResolvedValue({
        ...mockTask,
        title: 'Updated title',
      } as any);

      const res = await request(staffApp)
        .patch(`/tasks/${TASK_ID}`)
        .send({ title: 'Updated title' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
