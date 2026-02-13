import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';
import {
  mockWorkflowStep,
  mockWorkflowStepInProgress,
  mockWorkflowStepCompleted,
  mockWorkflowStepBlocked,
  mockWorkflowStepSkipped,
  mockEnrollmentWithPayer,
  mockEnrollmentTerminal,
} from '../../tests/helpers/workflow-fixtures.js';

// Mock prisma
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock auth middleware
vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// Mock hydration service
vi.mock('../services/workflow-hydration.service.js', () => ({
  hydrateWorkflowSteps: vi.fn(),
  updateStepStatus: vi.fn(),
  getWorkflowProgress: vi.fn(),
  getAvailableWorkflows: vi.fn(),
  getActionTypeConfig: vi.fn().mockReturnValue({
    form_submission: { label: 'Form', icon: 'doc', color: 'blue' },
  }),
}));

// Mock workflow mapping
vi.mock('../config/workflow-mapping.js', () => ({
  resolveWorkflowType: vi.fn().mockReturnValue('medical'),
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  hydrateWorkflowSteps,
  updateStepStatus,
  getWorkflowProgress,
  getAvailableWorkflows,
  getActionTypeConfig,
} from '../services/workflow-hydration.service.js';
import { resolveWorkflowType } from '../config/workflow-mapping.js';
import router from './enrollment-workflow.routes.js';

const mockedHydrate = vi.mocked(hydrateWorkflowSteps);
const mockedUpdateStep = vi.mocked(updateStepStatus);
const mockedProgress = vi.mocked(getWorkflowProgress);
const mockedAvailable = vi.mocked(getAvailableWorkflows);
const mockedResolve = vi.mocked(resolveWorkflowType);

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
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollmentWithPayer as any);
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
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/nonexistent/workflow');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  it('returns empty steps array when no workflow steps exist', async () => {
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollmentWithPayer as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([]);

    const res = await request(app).get('/enrollment-1-id/workflow');

    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([]);
  });

  it('returns 500 when database throws', async () => {
    prismaMock.payerEnrollment.findUnique.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/enrollment-1-id/workflow');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to fetch');
  });

  it('includes formatted providerName as "firstName lastName"', async () => {
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollmentWithPayer as any);
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

  // Helper to set up step mock and return defaults for sync
  function setupStepAndSync(stepOverrides: Record<string, unknown> = {}) {
    const step = { ...mockWorkflowStep, ...stepOverrides };
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue(step as any);
    // For syncEnrollmentStatus
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([step] as any);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollmentWithPayer as any);
    // For response
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(step as any);
    return step;
  }

  // Validation
  it('returns 404 when step not found for enrollment', async () => {
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

  // Happy paths
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
    // skippedReason is saved separately
    expect(prismaMock.enrollmentWorkflowStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: stepId },
        data: { skippedReason: 'Not applicable' },
      })
    );
  });

  // Transition coverage
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

  // Side effects
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

    // syncEnrollmentStatus fetches steps and enrollment
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
    prismaMock.enrollmentWorkflowStep.findFirst.mockRejectedValue(new Error('DB error'));

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
    // Step transitions to in_progress
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue({
      ...mockWorkflowStep,
      status: 'not_started',
    } as any);

    // syncEnrollmentStatus: steps have one in_progress
    prismaMock.enrollmentWorkflowStep.findMany
      .mockResolvedValueOnce([{ ...mockWorkflowStepInProgress }] as any)  // sync finds steps
      .mockResolvedValueOnce([{ ...mockWorkflowStepInProgress }] as any); // response fetch
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      status: 'not_started',
    } as any);
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'in_progress' });

    // Should advance enrollment from not_started to in_progress
    expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'in_progress' }),
      })
    );
  });

  it('advances in_progress → submitted when all steps done', async () => {
    prismaMock.enrollmentWorkflowStep.findFirst.mockResolvedValue({
      ...mockWorkflowStepInProgress,
    } as any);

    // All steps completed
    prismaMock.enrollmentWorkflowStep.findMany
      .mockResolvedValueOnce([mockWorkflowStepCompleted] as any)
      .mockResolvedValueOnce([mockWorkflowStepCompleted] as any);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      status: 'in_progress',
    } as any);
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'completed' });

    expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
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
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(mockEnrollmentTerminal as any);

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'completed' });

    // payerEnrollment.update should NOT be called for status change
    // (it may be called for other things, so check no call with status data)
    const updateCalls = prismaMock.payerEnrollment.update.mock.calls;
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
      .mockResolvedValueOnce([mockWorkflowStep] as any)  // all not_started
      .mockResolvedValueOnce([mockWorkflowStep] as any);
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      status: 'not_started',
    } as any);

    await request(app)
      .put(`/${enrollmentId}/workflow/${stepId}`)
      .send({ status: 'not_started' });

    // Should NOT update enrollment status
    const updateCalls = prismaMock.payerEnrollment.update.mock.calls;
    const statusUpdates = updateCalls.filter(
      (c) => (c[0].data as any)?.status !== undefined
    );
    expect(statusUpdates).toHaveLength(0);
  });
});

// ============================================================
// POST /:id/workflow/hydrate
// ============================================================

describe('POST /:id/workflow/hydrate', () => {
  it('returns 200 and creates steps for valid enrollment', async () => {
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      payer: { ...mockEnrollmentWithPayer.payer, workflowKey: 'aetna' },
      provider: { ...mockEnrollmentWithPayer.provider, providerType: 'lcsw' },
      workflowSteps: [],
    } as any);
    mockedHydrate.mockResolvedValue({ stepsCreated: 3, templateFound: true });
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.stepsCreated).toBe(3);
  });

  it('returns 404 when enrollment not found', async () => {
    prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/nonexistent/workflow/hydrate')
      .send({});

    expect(res.status).toBe(404);
  });

  it('returns 409 when workflow steps already exist', async () => {
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      workflowSteps: [mockWorkflowStep],
    } as any);

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(409);
  });

  it('returns 422 when payer has no workflowKey', async () => {
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      payer: { ...mockEnrollmentWithPayer.payer, workflowKey: null, name: 'No WF Payer' },
      workflowSteps: [],
    } as any);

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(422);
  });

  it('uses explicit workflowType from body when provided', async () => {
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      payer: { ...mockEnrollmentWithPayer.payer, workflowKey: 'aetna' },
      provider: { ...mockEnrollmentWithPayer.provider },
      workflowSteps: [],
    } as any);
    mockedHydrate.mockResolvedValue({ stepsCreated: 2, templateFound: true });
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({ workflowType: 'behavioral_health' });

    expect(res.status).toBe(200);
    expect(mockedHydrate).toHaveBeenCalledWith(
      expect.anything(),
      'enrollment-1-id',
      'aetna',
      'behavioral_health'
    );
    // resolveWorkflowType should NOT be called when explicit
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('calls resolveWorkflowType when no explicit type', async () => {
    prismaMock.payerEnrollment.findUnique.mockResolvedValue({
      ...mockEnrollmentWithPayer,
      payer: { ...mockEnrollmentWithPayer.payer, workflowKey: 'aetna' },
      provider: { ...mockEnrollmentWithPayer.provider, providerType: 'lcsw' },
      workflowSteps: [],
    } as any);
    mockedResolve.mockReturnValue('behavioral_health');
    mockedHydrate.mockResolvedValue({ stepsCreated: 2, templateFound: true });
    prismaMock.payerEnrollment.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(200);
    expect(mockedResolve).toHaveBeenCalledWith('lcsw', 'aetna');
  });

  it('returns 500 on error', async () => {
    prismaMock.payerEnrollment.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/enrollment-1-id/workflow/hydrate')
      .send({});

    expect(res.status).toBe(500);
  });
});

// ============================================================
// GET /workflow/templates/:payerWorkflowKey
// ============================================================

describe('GET /workflow/templates/:payerWorkflowKey', () => {
  it('returns 200 with templates for known payer key', async () => {
    mockedAvailable.mockReturnValue([
      { type: 'medical', label: 'Medical', stepCount: 3, timeline: {} },
    ]);

    const res = await request(app).get('/workflow/templates/aetna');

    expect(res.status).toBe(200);
    expect(res.body.payerWorkflowKey).toBe('aetna');
    expect(res.body.workflows).toHaveLength(1);
  });

  it('returns 404 for unknown payer key', async () => {
    mockedAvailable.mockReturnValue(null);

    const res = await request(app).get('/workflow/templates/nonexistent');

    expect(res.status).toBe(404);
  });

  it('returns 500 on error', async () => {
    mockedAvailable.mockImplementation(() => {
      throw new Error('Template error');
    });

    const res = await request(app).get('/workflow/templates/aetna');

    expect(res.status).toBe(500);
  });
});
