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
  dispatchPortalSubmission: vi.fn(),
  dispatchDocumentParsing: vi.fn(),
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
  cancelWorkflow,
  dispatchPortalSubmission,
  dispatchDocumentParsing,
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
      expect(listWorkflows).toHaveBeenCalledWith({}, {});
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
      }, {});
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
      expect(res.body.error).toBeDefined();
    });

    it('cancels a workflow and returns 200', async () => {
      const mockCancelled = {
        id: 'wf-1',
        goal: 'Enroll provider',
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelReason: 'No longer needed',
      };
      (cancelWorkflow as any).mockResolvedValue(mockCancelled);

      const res = await request(app)
        .patch('/workflows/wf-1')
        .send({ action: 'cancel', reason: 'No longer needed' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockCancelled);
      expect(cancelWorkflow).toHaveBeenCalledWith('wf-1', 'No longer needed');
    });

    it('uses default reason when none provided', async () => {
      const mockCancelled = { id: 'wf-1', status: 'cancelled' };
      (cancelWorkflow as any).mockResolvedValue(mockCancelled);

      const res = await request(app)
        .patch('/workflows/wf-1')
        .send({ action: 'cancel' });

      expect(res.status).toBe(200);
      expect(cancelWorkflow).toHaveBeenCalledWith('wf-1', 'Cancelled by user');
    });
  });

  describe('POST /workflows/:id/submit-to-portal', () => {
    it('dispatches portal submission and returns 201', async () => {
      const mockTask = { id: 'task-1', status: 'queued', type: 'submit_to_portal' };
      (dispatchPortalSubmission as any).mockResolvedValue(mockTask);

      const res = await request(app)
        .post('/workflows/wf-1/submit-to-portal')
        .send({
          providerId: '00000000-0000-0000-0000-000000000001',
          payerId: '00000000-0000-0000-0000-000000000002',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockTask);
      expect(dispatchPortalSubmission).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        providerId: '00000000-0000-0000-0000-000000000001',
        payerId: '00000000-0000-0000-0000-000000000002',
        enrollmentId: undefined,
        action: undefined,
      });
    });

    it('passes action when provided', async () => {
      const mockTask = { id: 'task-2', status: 'queued' };
      (dispatchPortalSubmission as any).mockResolvedValue(mockTask);

      const res = await request(app)
        .post('/workflows/wf-1/submit-to-portal')
        .send({
          providerId: '00000000-0000-0000-0000-000000000001',
          payerId: '00000000-0000-0000-0000-000000000002',
          action: 'check_readiness',
        });

      expect(res.status).toBe(201);
      expect(dispatchPortalSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'check_readiness' })
      );
    });

    it('returns 400 for invalid payerId', async () => {
      const res = await request(app)
        .post('/workflows/wf-1/submit-to-portal')
        .send({
          providerId: '00000000-0000-0000-0000-000000000001',
          payerId: 'not-a-uuid',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/workflows/wf-1/submit-to-portal')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('POST /workflows/:id/parse-document', () => {
    it('dispatches document parsing and returns 201', async () => {
      const mockTask = { id: 'task-1', status: 'queued', type: 'parse_document' };
      (dispatchDocumentParsing as any).mockResolvedValue(mockTask);

      const res = await request(app)
        .post('/workflows/wf-1/parse-document')
        .send({
          documentId: '00000000-0000-0000-0000-000000000010',
          providerId: '00000000-0000-0000-0000-000000000001',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockTask);
      expect(dispatchDocumentParsing).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        documentId: '00000000-0000-0000-0000-000000000010',
        providerId: '00000000-0000-0000-0000-000000000001',
        extractionHints: undefined,
      });
    });

    it('passes extractionHints when provided', async () => {
      const mockTask = { id: 'task-2', status: 'queued' };
      (dispatchDocumentParsing as any).mockResolvedValue(mockTask);

      const res = await request(app)
        .post('/workflows/wf-1/parse-document')
        .send({
          documentId: '00000000-0000-0000-0000-000000000010',
          providerId: '00000000-0000-0000-0000-000000000001',
          extractionHints: ['license_number', 'expiration_date'],
        });

      expect(res.status).toBe(201);
      expect(dispatchDocumentParsing).toHaveBeenCalledWith(
        expect.objectContaining({
          extractionHints: ['license_number', 'expiration_date'],
        })
      );
    });

    it('returns 400 for invalid documentId', async () => {
      const res = await request(app)
        .post('/workflows/wf-1/parse-document')
        .send({
          documentId: 'not-a-uuid',
          providerId: '00000000-0000-0000-0000-000000000001',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/workflows/wf-1/parse-document')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });
});
