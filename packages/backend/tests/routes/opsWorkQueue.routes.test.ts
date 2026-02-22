import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  UnauthorizedError,
  ForbiddenError,
} from '../../src/middleware/error.middleware.js';

// ==========================================
// Hoisted mocks
// ==========================================

const {
  mockCreateWorkItem,
  mockGetWorkQueue,
  mockGetMyWorkItems,
  mockUpdateWorkItemStatus,
  mockAssignWorkItem,
  mockBulkAssignWorkItems,
  mockAddComment,
  mockGetComments,
} = vi.hoisted(() => ({
  mockCreateWorkItem: vi.fn(),
  mockGetWorkQueue: vi.fn(),
  mockGetMyWorkItems: vi.fn(),
  mockUpdateWorkItemStatus: vi.fn(),
  mockAssignWorkItem: vi.fn(),
  mockBulkAssignWorkItems: vi.fn(),
  mockAddComment: vi.fn(),
  mockGetComments: vi.fn(),
}));

vi.mock('../../src/services/opsWorkQueue.service.js', () => ({
  createWorkItem: mockCreateWorkItem,
  getWorkQueue: mockGetWorkQueue,
  getMyWorkItems: mockGetMyWorkItems,
  updateWorkItemStatus: mockUpdateWorkItemStatus,
  assignWorkItem: mockAssignWorkItem,
  bulkAssignWorkItems: mockBulkAssignWorkItems,
  addComment: mockAddComment,
  getComments: mockGetComments,
}));

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  authorize:
    (...allowedRoles: string[]) =>
    (req: any, _res: any, next: any) => {
      if (!req.user) return next(new UnauthorizedError('Not authenticated'));
      if (!allowedRoles.includes(req.user.role))
        return next(new ForbiddenError('Insufficient permissions'));
      next();
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import opsWorkQueueRoutes from '../../src/routes/opsWorkQueue.routes.js';
import { createTestApp } from '../helpers/test-app.js';
import { adminUser, providerUser, staffUser } from '../helpers/fixtures.js';

// ==========================================
// Fixtures
// ==========================================

const opsStaffUser = {
  id: 'ops-staff-id',
  cognitoId: 'ops-cognito-id',
  email: 'ops@test.com',
  firstName: 'Ops',
  lastName: 'Staff',
  role: 'ops_staff' as const,
  isActive: true,
  providerId: undefined,
};

const mockWorkItem = {
  id: 'wi-1',
  title: 'Test Item',
  category: 'general',
  priority: 'normal',
  status: 'backlog',
  createdAt: new Date().toISOString(),
};

const validCreateBody = {
  title: 'New work item',
  category: 'general',
};

// ==========================================
// Tests
// ==========================================

describe('OpsWorkQueue Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWorkItem.mockResolvedValue(mockWorkItem);
    mockGetWorkQueue.mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
    mockBulkAssignWorkItems.mockResolvedValue(0);
  });

  // ==========================================
  // Authorization
  // ==========================================

  describe('Authorization', () => {
    it('returns 403 for provider role on GET /', async () => {
      const app = createTestApp(opsWorkQueueRoutes, providerUser);
      const res = await request(app).get('/');
      expect(res.status).toBe(403);
    });

    it('returns 403 for credentialing_staff role on GET /', async () => {
      const app = createTestApp(opsWorkQueueRoutes, staffUser);
      const res = await request(app).get('/');
      expect(res.status).toBe(403);
    });

    it('returns 403 for provider role on POST /', async () => {
      const app = createTestApp(opsWorkQueueRoutes, providerUser);
      const res = await request(app).post('/').send(validCreateBody);
      expect(res.status).toBe(403);
    });

    it('returns 200 for admin role on GET /', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('returns 200 for ops_staff role on GET /', async () => {
      const app = createTestApp(opsWorkQueueRoutes, opsStaffUser);
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('returns 401 when no user is set', async () => {
      const app = createTestApp(opsWorkQueueRoutes);
      const res = await request(app).get('/');
      expect(res.status).toBe(401);
    });
  });

  // ==========================================
  // POST / — create work item
  // ==========================================

  describe('POST /', () => {
    it('creates a work item with valid body and returns 201', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .post('/')
        .send(validCreateBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockWorkItem);
    });

    it('returns 400 when title is missing (Zod error)', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .post('/')
        .send({ category: 'general' }); // missing title

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when category is missing', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .post('/')
        .send({ title: 'Something' }); // missing category

      expect(res.status).toBe(400);
    });

    it('returns 400 when category is invalid enum value', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .post('/')
        .send({ title: 'Something', category: 'invalid_category' });

      expect(res.status).toBe(400);
    });

    it('accepts optional fields', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const body = {
        title: 'Full item',
        category: 'payer_outreach',
        priority: 'urgent',
        description: 'Some description',
        practiceId: '00000000-0000-0000-0000-000000000001',
        estimatedMinutes: 60,
      };
      const res = await request(app).post('/').send(body);

      expect(res.status).toBe(201);
      expect(mockCreateWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Full item',
          category: 'payer_outreach',
          priority: 'urgent',
          description: 'Some description',
          estimatedMinutes: 60,
        }),
      );
    });
  });

  // ==========================================
  // PATCH /:id — update work item
  // ==========================================

  describe('PATCH /:id', () => {
    it('validates status enum value', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .patch('/wi-1')
        .send({ status: 'invalid_status' });

      expect(res.status).toBe(400);
    });

    it('accepts valid status values', async () => {
      mockUpdateWorkItemStatus.mockResolvedValue(mockWorkItem);
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .patch('/wi-1')
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(mockUpdateWorkItemStatus).toHaveBeenCalledWith('wi-1', 'in_progress', undefined);
    });

    it('passes notes along with status change', async () => {
      mockUpdateWorkItemStatus.mockResolvedValue(mockWorkItem);
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .patch('/wi-1')
        .send({ status: 'done', notes: 'All complete' });

      expect(res.status).toBe(200);
      expect(mockUpdateWorkItemStatus).toHaveBeenCalledWith('wi-1', 'done', 'All complete');
    });

    it('accepts valid priority update without status', async () => {
      const { prismaMock } = await import('../helpers/mock-prisma.js');
      prismaMock.opsWorkItem.update.mockResolvedValue({ ...mockWorkItem, priority: 'high' } as any);

      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .patch('/wi-1')
        .send({ priority: 'high' });

      expect(res.status).toBe(200);
    });
  });

  // ==========================================
  // POST /bulk-assign
  // ==========================================

  describe('POST /bulk-assign', () => {
    it('validates workItemIds as UUID array', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .post('/bulk-assign')
        .send({
          workItemIds: ['not-a-uuid'],
          staffId: '00000000-0000-0000-0000-000000000001',
        });

      expect(res.status).toBe(400);
    });

    it('validates staffId as UUID', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .post('/bulk-assign')
        .send({
          workItemIds: ['00000000-0000-0000-0000-000000000001'],
          staffId: 'not-uuid',
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when workItemIds is empty', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .post('/bulk-assign')
        .send({
          workItemIds: [],
          staffId: '00000000-0000-0000-0000-000000000001',
        });

      expect(res.status).toBe(400);
    });

    it('returns 200 with count on valid bulk assign', async () => {
      mockBulkAssignWorkItems.mockResolvedValue(3);
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app)
        .post('/bulk-assign')
        .send({
          workItemIds: [
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000003',
          ],
          staffId: '00000000-0000-0000-0000-000000000099',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(3);
    });

    it('returns 403 for non-ops roles', async () => {
      const app = createTestApp(opsWorkQueueRoutes, providerUser);
      const res = await request(app)
        .post('/bulk-assign')
        .send({
          workItemIds: ['00000000-0000-0000-0000-000000000001'],
          staffId: '00000000-0000-0000-0000-000000000099',
        });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================
  // GET / — work queue list
  // ==========================================

  describe('GET /', () => {
    it('returns paginated work queue', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('items');
      expect(res.body.data).toHaveProperty('total');
    });

    it('passes query filters to service', async () => {
      const app = createTestApp(opsWorkQueueRoutes, adminUser);
      await request(app).get('/?status=todo&priority=urgent&page=2&limit=10');

      expect(mockGetWorkQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ['todo'],
          priority: ['urgent'],
          page: 2,
          limit: 10,
        }),
      );
    });
  });
});
