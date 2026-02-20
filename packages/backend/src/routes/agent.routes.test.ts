import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../agents/coordinator.service.js', () => ({
  createWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  getWorkflowEvents: vi.fn(),
  cancelWorkflow: vi.fn(),
}));

vi.mock('../agents/queues.js', () => ({
  getQueue: vi.fn(),
  QUEUE_NAMES: { AGENT_TASKS: 'agent-tasks' },
}));

import { agentRoutes } from './agent.routes.js';
import {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  getWorkflowEvents,
} from '../agents/coordinator.service.js';

describe('Agent Routes', () => {
  const app = createTestApp(agentRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /workflows', () => {
    it('creates a workflow and returns 201', async () => {
      const mockWorkflow = {
        id: 'wf-1',
        goal: 'Enroll provider with Aetna',
        providerId: '00000000-0000-0000-0000-000000000001',
        status: 'planning',
        createdAt: new Date().toISOString(),
      };
      (createWorkflow as any).mockResolvedValue(mockWorkflow);

      const res = await request(app)
        .post('/workflows')
        .send({
          goal: 'Enroll provider with Aetna',
          providerId: '00000000-0000-0000-0000-000000000001',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockWorkflow);
      expect(createWorkflow).toHaveBeenCalledWith({
        goal: 'Enroll provider with Aetna',
        providerId: '00000000-0000-0000-0000-000000000001',
        requestedBy: adminUser.id,
      });
    });

    it('returns 400 for missing goal', async () => {
      const res = await request(app)
        .post('/workflows')
        .send({ providerId: '00000000-0000-0000-0000-000000000001' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid providerId', async () => {
      const res = await request(app)
        .post('/workflows')
        .send({ goal: 'Test', providerId: 'not-a-uuid' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /workflows', () => {
    it('returns an array of workflows', async () => {
      const mockList = [
        { id: 'wf-1', goal: 'Goal 1', status: 'active' },
        { id: 'wf-2', goal: 'Goal 2', status: 'completed' },
      ];
      (listWorkflows as any).mockResolvedValue(mockList);

      const res = await request(app).get('/workflows');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockList);
      expect(listWorkflows).toHaveBeenCalledWith({});
    });

    it('passes query params to listWorkflows', async () => {
      (listWorkflows as any).mockResolvedValue([]);

      const res = await request(app)
        .get('/workflows')
        .query({ status: 'active', limit: '10', offset: '5' });

      expect(res.status).toBe(200);
      expect(listWorkflows).toHaveBeenCalledWith({
        status: 'active',
        limit: 10,
        offset: 5,
      });
    });
  });

  describe('GET /workflows/:id', () => {
    it('returns 404 when workflow not found', async () => {
      (getWorkflow as any).mockResolvedValue(null);

      const res = await request(app).get('/workflows/wf-nonexistent');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Workflow not found' });
    });

    it('returns 200 with workflow when found', async () => {
      const mockWorkflow = { id: 'wf-1', goal: 'Test', status: 'active' };
      (getWorkflow as any).mockResolvedValue(mockWorkflow);

      const res = await request(app).get('/workflows/wf-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockWorkflow);
    });
  });

  describe('GET /workflows/:id/events', () => {
    it('returns an array of events', async () => {
      const mockEvents = [
        { id: 'evt-1', type: 'workflow_started', createdAt: new Date().toISOString() },
        { id: 'evt-2', type: 'step_completed', createdAt: new Date().toISOString() },
      ];
      (getWorkflowEvents as any).mockResolvedValue(mockEvents);

      const res = await request(app).get('/workflows/wf-1/events');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockEvents);
      expect(getWorkflowEvents).toHaveBeenCalledWith('wf-1');
    });
  });

  describe('PATCH /workflows/:id', () => {
    it('returns 400 for unknown action', async () => {
      const res = await request(app)
        .patch('/workflows/wf-1')
        .send({ action: 'unknown', reason: 'test' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Unknown action. Supported: cancel' });
    });
  });
});
