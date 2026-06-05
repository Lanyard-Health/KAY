import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';
import {
  mockWorkflowStep,
  mockWorkflowStepInProgress,
  mockWorkflowStepCompleted,
  mockEnrollmentWithPayer,
  mockEnrollmentTerminal,
} from '../../tests/helpers/workflow-fixtures.js';

// Mock prisma
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

// Mock auth middleware
vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// Mock practice scope (passes through)
vi.mock('../middleware/practiceScope.middleware.js', () => ({
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
}));

// Mock step-operations helpers (kept after Phase 6 cleanup)
vi.mock('../services/workflow-hydration.service.js', () => ({
  updateStepStatus: vi.fn(),
  getWorkflowProgress: vi.fn(),
  getActionTypeConfig: vi.fn().mockReturnValue({
    form_submission: { label: 'Form', icon: 'doc', color: 'blue' },
  }),
}));

// Mock DB-driven Path A instantiator
vi.mock('../services/workflow-instantiation.service.js', () => ({
  instantiateWorkflow: vi.fn(),
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  updateStepStatus,
  getWorkflowProgress,
  getActionTypeConfig,
} from '../services/workflow-hydration.service.js';
import { instantiateWorkflow } from '../services/workflow-instantiation.service.js';
import router from './enrollment-workflow.routes.js';

const mockedUpdateStep = vi.mocked(updateStepStatus);
const mockedProgress = vi.mocked(getWorkflowProgress);
const mockedInstantiate = vi.mocked(instantiateWorkflow);

const app = createTestApp(router, adminUser);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActionTypeConfig).mockReturnValue({
    form_submission: { label: 'Form', icon: 'doc', color: 'blue' },
  });
  mockedProgress.mockResolvedValue(null);
  mockedUpdateStep.mockResolvedValue(undefined);
});

// ============================================================
// GET /:id/workflow
// ============================================================

describe('GET /:id/workflow', () => {
  it('returns 200 with steps, progress, enrollment info, and actionTypeConfig', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollmentWithPayer as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([mockWorkflowStep] as any);
    mockedProgress.mockResolvedValue({
      totalSteps: 1,
      completedSteps: 0,
      inProgressSteps: 0,
      blockedSteps: 0,
      skippedSteps: 0,
      percentComplete: 0,
      estimatedDaysRemaining: 5,
      currentStep: null,
    });

    const res = await request(app).get('/enrollment-1-id/workflow');

    expect(res.status).toBe(200);
    expect(res.body.enrollment).toBeDefined();
    expect(res.body.steps).toHaveLength(1);
    expect(res.body.progress).toBeDefined();
    expect(res.body.actionTypeConfig).toBeDefined();
  });

  it('returns 404 when enrollment not found', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/nonexistent/workflow');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  it('returns empty steps array when no workflow steps exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollmentWithPayer as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([]);

    const res = await request(app).get('/enrollment-1-id/workflow');

    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([]);
  });

  it('returns 500 when database throws', async () => {
    prismaMock.enrollment.findUnique.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/enrollment-1-id/workflow');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to fetch');
  });

  it('includes formatted providerName as "firstName lastName"', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollmentWithPayer as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([]);

    const res = await request(app).get('/enrollment-1-id/workflow');

    expect(res.body.enrollment.providerName).toBe('Jane Doe');
  });
});

// ============================================================
// PUT /:id/workflow/:stepId
// ============================================================

describe('PUT /:id/workflow/:stepId', () => {
  const enrollmentId = 'enrollment-1-id';
  const stepId = 'step-1-id';

  function setupStepAndSync(stepOverrides: Record<string, unknown> = {}) {
    const step = { ...mockWorkflowStep, ...stepOverrides };
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue(step as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([step] as any);
    prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollmentWithPayer as any);
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(step as any);
    return step;
  }

  it('returns 404 when step not found for enrollment', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ providerId: 'p-1' } as any);
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid transition (completed → in_progress)', async () => {
    setupStepAndSync({ status: 'completed' });

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot transition');
  });

  it('returns 400 for not_started → completed', async () => {
    setupStepAndSync({ status: 'not_started' });

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'completed' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when skipping without skippedReason', async () => {
    setupStepAndSync({ status: 'not_started' });

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'skipped' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('skippedReason');
  });

  it('returns 200 for not_started → in_progress', async () => {
    setupStepAndSync({ status: 'not_started' });

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(mockedUpdateStep).toHaveBeenCalled();
  });

  it('returns 200 for in_progress → completed', async () => {
    setupStepAndSync({ status: 'in_progress' });

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  it('accepts skip with skippedReason', async () => {
    setupStepAndSync({ status: 'not_started' });

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'skipped', skippedReason: 'Not applicable' });

    expect(res.status).toBe(200);
    expect(prismaMock.enrollmentWorkflowStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: stepId },
        data: { skippedReason: 'Not applicable' },
      })
    );
  });

  it('allows all transitions from in_progress', async () => {
    for (const target of ['completed', 'skipped', 'blocked', 'not_started']) {
      vi.clearAllMocks();
      setupStepAndSync({ status: 'in_progress' });

      const body: Record<string, string> = { status: target };
      if (target === 'skipped') body['skippedReason'] = 'reason';

      const res = await request(app)
        .put(`/${enrollmentId}/workflow/${stepId}`)
        .send(body);

      expect(res.status).toBe(200);
    }
  });

  it('allows all transitions from blocked', async () => {
    for (const target of ['not_started', 'in_progress', 'skipped']) {
      vi.clearAllMocks();
      setupStepAndSync({ status: 'blocked' });

      const body: Record<string, string> = { status: target };
      if (target === 'skipped') body['skippedReason'] = 'reason';

      const res = await request(app)
        .put(`/${enrollmentId}/workflow/${stepId}`)
        .send(body);

      expect(res.status).toBe(200);
    }
  });

  it('allows only not_started from skipped', async () => {
    setupStepAndSync({ status: 'skipped' });

    const ok = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'not_started' });
    expect(ok.status).toBe(200);

    vi.clearAllMocks();
    setupStepAndSync({ status: 'skipped' });
    const fail = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });
    expect(fail.status).toBe(400);
  });

  it('allows only not_started from completed (un-complete)', async () => {
    setupStepAndSync({ status: 'completed' });

    const ok = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'not_started' });
    expect(ok.status).toBe(200);

    vi.clearAllMocks();
    setupStepAndSync({ status: 'completed' });
    const fail = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'completed' });
    expect(fail.status).toBe(400);
  });

  it('passes userId from req.user to updateStepStatus', async () => {
    setupStepAndSync({ status: 'not_started' });

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    expect(mockedUpdateStep).toHaveBeenCalledWith(
      expect.anything(),
      stepId,
      'in_progress',
      adminUser.id,
      undefined
    );
  });

  it('calls syncEnrollmentStatus after every update', async () => {
    setupStepAndSync({ status: 'not_started' });

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    expect(prismaMock.enrollmentWorkflowStep.findMany).toHaveBeenCalled();
  });

  it('returns updated steps + progress in response', async () => {
    setupStepAndSync({ status: 'not_started' });
    mockedProgress.mockResolvedValue({
      totalSteps: 1,
      completedSteps: 0,
      inProgressSteps: 1,
      blockedSteps: 0,
      skippedSteps: 0,
      percentComplete: 0,
      estimatedDaysRemaining: 5,
      currentStep: null,
    });

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    expect(res.body.steps).toBeDefined();
    expect(res.body.progress).toBeDefined();
  });

  it('returns 500 when Prisma throws', async () => {
    prismaMock.enrollment.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(500);
  });
});

// ============================================================
// syncEnrollmentStatus — tested via PUT side effects
// ============================================================

describe('syncEnrollmentStatus', () => {
  const enrollmentId = 'enrollment-1-id';
  const stepId = 'step-1-id';

  it('advances not_started → in_progress when a step starts', async () => {
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue({
      ...mockWorkflowStep,
      status: 'not_started',
    } as any);

    prismaMock.enrollmentWorkflowStep.findMany
      .mockResolvedValueOnce([{ ...mockWorkflowStepInProgress }] as any)
      .mockResolvedValueOnce([{ ...mockWorkflowStepInProgress }] as any);
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      status: 'not_started',
    } as any);
    prismaMock.enrollment.update.mockResolvedValue({} as any);

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'in_progress' }),
      })
    );
  });

  it('advances in_progress → submitted when all steps done', async () => {
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue({
      ...mockWorkflowStepInProgress,
    } as any);

    prismaMock.enrollmentWorkflowStep.findMany
      .mockResolvedValueOnce([mockWorkflowStepCompleted] as any)
      .mockResolvedValueOnce([mockWorkflowStepCompleted] as any);
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      status: 'in_progress',
    } as any);
    prismaMock.enrollment.update.mockResolvedValue({} as any);

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'completed' });

    expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'submitted' }),
      })
    );
  });

  it('does not change terminal enrollment status (approved/denied/terminated)', async () => {
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue({
      ...mockWorkflowStepCompleted,
      status: 'in_progress',
    } as any);

    prismaMock.enrollmentWorkflowStep.findMany
      .mockResolvedValueOnce([mockWorkflowStepCompleted] as any)
      .mockResolvedValueOnce([mockWorkflowStepCompleted] as any);
    prismaMock.enrollment.findUnique.mockResolvedValue(mockEnrollmentTerminal as any);

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'completed' });

    const updateCalls = prismaMock.enrollment.update.mock.calls;
    const statusUpdates = updateCalls.filter(
      (c) => (c[0].data as any)?.status !== undefined
    );
    expect(statusUpdates).toHaveLength(0);
  });

  it('no change when all steps not_started and enrollment not_started', async () => {
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue({
      ...mockWorkflowStep,
      status: 'blocked',
    } as any);

    prismaMock.enrollmentWorkflowStep.findMany
      .mockResolvedValueOnce([mockWorkflowStep] as any)
      .mockResolvedValueOnce([mockWorkflowStep] as any);
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      status: 'not_started',
    } as any);

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'not_started' });

    const updateCalls = prismaMock.enrollment.update.mock.calls;
    const statusUpdates = updateCalls.filter(
      (c) => (c[0].data as any)?.status !== undefined
    );
    expect(statusUpdates).toHaveLength(0);
  });
});

// ============================================================
// POST /:id/workflow/hydrate (Path A only)
// ============================================================

describe('POST /:id/workflow/hydrate', () => {
  it('returns 200 and creates steps when payerTrackId resolves to an active template', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      payerTrackId: 'track-1-id',
      workflowSteps: [],
    } as any);
    prismaMock.payerTrack.findUnique.mockResolvedValue({ stateRegion: 'Nationwide' } as any);
    mockedInstantiate.mockResolvedValue({
      stepsCreated: 7,
      templateFound: true,
      templateId: 'tmpl-1',
      templateName: 'Aetna Medical Provider Enrollment',
      conditionsApplied: 2,
    });

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.stepsCreated).toBe(7);
    expect(res.body.templateName).toBe('Aetna Medical Provider Enrollment');
    expect(mockedInstantiate).toHaveBeenCalledWith(
      expect.anything(),
      'enrollment-1-id',
      'track-1-id',
      expect.objectContaining({
        state: 'Nationwide',
        providerType: 'lcsw',
      })
    );
  });

  it('returns 404 when enrollment not found', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/nonexistent/workflow/hydrate')
      .send({});

    expect(res.status).toBe(404);
  });

  it('returns 409 when workflow steps already exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      workflowSteps: [mockWorkflowStep],
    } as any);

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(409);
  });

  it('returns 422 when enrollment has no payerTrackId', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      payerTrackId: null,
      workflowSteps: [],
    } as any);

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('payerTrackId');
  });

  it('returns 404 when no active WorkflowTemplate exists for the PayerTrack', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      payerTrackId: 'track-1-id',
      workflowSteps: [],
    } as any);
    prismaMock.payerTrack.findUnique.mockResolvedValue({ stateRegion: 'Nationwide' } as any);
    mockedInstantiate.mockResolvedValue({
      stepsCreated: 0,
      templateFound: false,
      templateId: null,
      templateName: null,
      conditionsApplied: 0,
    });

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No active WorkflowTemplate');
  });

  it('returns 500 on error', async () => {
    prismaMock.enrollment.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(500);
  });
});
