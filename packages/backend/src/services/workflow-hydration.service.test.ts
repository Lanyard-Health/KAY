import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockWorkflowData,
  mockWorkflowStep,
  mockWorkflowStepCompleted,
  mockWorkflowStepBlocked,
  mockWorkflowStepSkipped,
  mockWorkflowStepInProgress,
} from '../../tests/helpers/workflow-fixtures.js';

// Mock fs before importing the service
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

import * as fs from 'fs';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  loadWorkflowTemplates,
  reloadWorkflowTemplates,
  hydrateWorkflowSteps,
  updateStepStatus,
  getWorkflowProgress,
  getAvailableWorkflows,
  getActionTypeConfig,
} from './workflow-hydration.service.js';

beforeEach(() => {
  // Reset the module-level cache by reloading with valid data
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockWorkflowData));
  reloadWorkflowTemplates();
});

// ============================================================
// loadWorkflowTemplates
// ============================================================

describe('loadWorkflowTemplates', () => {
  it('returns cached data on second call without re-reading file', () => {
    vi.mocked(fs.readFileSync).mockClear();

    // First call after beforeEach already loaded
    loadWorkflowTemplates();
    loadWorkflowTemplates();

    // readFileSync should NOT have been called again (cached)
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('reads and parses JSON from disk on first call', () => {
    const data = loadWorkflowTemplates();
    expect(data.schema_version).toBe('1.0');
    expect(data.payers.aetna).toBeDefined();
    expect(data.payers.bcbs).toBeDefined();
  });

  it('throws when template file does not exist', () => {
    // Clear cache first
    vi.mocked(fs.existsSync).mockReturnValue(false);
    // Force cache clear by setting internal state via reload attempt
    expect(() => reloadWorkflowTemplates()).toThrow('Workflow template file not found');
  });
});

// ============================================================
// reloadWorkflowTemplates
// ============================================================

describe('reloadWorkflowTemplates', () => {
  it('clears cache and reloads from disk', () => {
    vi.mocked(fs.readFileSync).mockClear();

    reloadWorkflowTemplates();

    expect(fs.readFileSync).toHaveBeenCalledOnce();
  });
});

// ============================================================
// hydrateWorkflowSteps
// ============================================================

describe('hydrateWorkflowSteps', () => {
  // Action type / owner mapping
  describe('action type and owner mapping', () => {
    it('maps known action types correctly', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      expect(steps[0].actionType).toBe('form_submission');
      expect(steps[1].actionType).toBe('payer_review');
      expect(steps[2].actionType).toBe('committee_review');
    });

    it('falls back to form_submission for unknown action types', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 2 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'behavioral_health');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // aetna-bh-02 has action_type: 'unknown_action'
      expect(steps[1].actionType).toBe('form_submission');
    });

    it('maps provider/payer/cvo owners correctly', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      expect(steps[0].owner).toBe('provider');  // provider
      expect(steps[1].owner).toBe('payer');      // payer
    });

    it('maps staff/admin aliases to credentialing_staff', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 2 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'behavioral_health');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // aetna-bh-01 owner is 'staff'
      expect(steps[0].owner).toBe('credentialing_staff');
    });

    it('falls back to credentialing_staff for unknown owners', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 2 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'behavioral_health');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // aetna-bh-02 owner is 'unknown_owner'
      expect(steps[1].owner).toBe('credentialing_staff');
    });
  });

  // Early exits
  describe('early exits', () => {
    it('returns {0, false} when payerWorkflowKey is null', async () => {
      const result = await hydrateWorkflowSteps(prismaMock, 'enr-1', null, 'medical');
      expect(result).toEqual({ stepsCreated: 0, templateFound: false });
    });

    it('returns {0, false} when payer template not found', async () => {
      const result = await hydrateWorkflowSteps(prismaMock, 'enr-1', 'nonexistent', 'medical');
      expect(result).toEqual({ stepsCreated: 0, templateFound: false });
    });
  });

  // Fallback workflow logic
  describe('fallback workflow logic', () => {
    it('returns {0, false} when neither requested nor fallback workflow exists', async () => {
      // bcbs only has medical, no behavioral_health, and we request a type that doesn't exist
      // We need to test a payer that has neither workflow. Use a custom template.
      const customData = {
        ...mockWorkflowData,
        payers: {
          ...mockWorkflowData.payers,
          empty_payer: {
            id: 'empty_payer',
            name: 'Empty Payer',
            parent_company: 'None',
            workflows: {},
          },
        },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(customData));
      reloadWorkflowTemplates();

      const result = await hydrateWorkflowSteps(prismaMock, 'enr-1', 'empty_payer', 'medical');
      expect(result).toEqual({ stepsCreated: 0, templateFound: false });
    });

    it('falls back from behavioral_health to medical when BH missing', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 1 });

      // bcbs only has medical workflow
      const result = await hydrateWorkflowSteps(prismaMock, 'enr-1', 'bcbs', 'behavioral_health');

      expect(result.templateFound).toBe(true);
      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // Should use bcbs medical workflow (1 step)
      expect(steps).toHaveLength(1);
      expect(steps[0].templateStepId).toBe('bcbs-med-01');
    });

    it('falls back from medical to behavioral_health when medical missing', async () => {
      // Create a payer with only BH workflow
      const customData = {
        ...mockWorkflowData,
        payers: {
          ...mockWorkflowData.payers,
          bh_only: {
            id: 'bh_only',
            name: 'BH Only Payer',
            parent_company: 'Test',
            workflows: {
              behavioral_health: mockWorkflowData.payers.aetna.workflows.behavioral_health,
            },
          },
        },
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(customData));
      reloadWorkflowTemplates();

      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 2 });

      const result = await hydrateWorkflowSteps(prismaMock, 'enr-1', 'bh_only', 'medical');
      expect(result.templateFound).toBe(true);
    });
  });

  // Step creation
  describe('step creation', () => {
    it('creates steps from matched workflow template', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      const result = await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      expect(result.templateFound).toBe(true);
      expect(prismaMock.enrollmentWorkflowStep.createMany).toHaveBeenCalledOnce();
    });

    it('returns correct stepsCreated count', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      const result = await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      expect(result.stepsCreated).toBe(3);
    });
  });

  // estimated_days normalization
  describe('estimated_days normalization', () => {
    it('passes through number estimated_days unchanged', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // aetna-med-01 has estimated_days: 5 (number)
      expect(steps[0].estimatedDays).toBe(5);
    });

    it('extracts max from {min, max} object', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // aetna-med-02 has estimated_days: { min: 15, max: 30 }
      expect(steps[1].estimatedDays).toBe(30);
    });

    it('defaults to 0 when estimated_days is null/undefined', async () => {
      const customData = JSON.parse(JSON.stringify(mockWorkflowData));
      customData.payers.aetna.workflows.medical.steps[0].estimated_days = null;
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(customData));
      reloadWorkflowTemplates();

      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      expect(steps[0].estimatedDays).toBe(0);
    });
  });

  // Dependency filtering
  describe('dependency filtering', () => {
    it('keeps internal dependencies (sibling step IDs)', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // aetna-med-03 depends on ['aetna-med-02', 'caqh-007']
      // Only aetna-med-02 is a sibling
      expect(steps[2].dependencies).toContain('aetna-med-02');
    });

    it('filters out external dependencies', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // caqh-007 is NOT a sibling step, should be filtered out
      expect(steps[2].dependencies).not.toContain('caqh-007');
    });
  });

  // Pre-completed steps
  describe('pre-completed steps', () => {
    it('marks pre-completed steps as completed with completedAt', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical', {
        preCompletedStepIds: ['aetna-med-01'],
      });

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      expect(steps[0].status).toBe('completed');
      expect(steps[0].completedAt).toBeInstanceOf(Date);
    });

    it('marks normal steps as not_started with null completedAt', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical', {
        preCompletedStepIds: ['aetna-med-01'],
      });

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      expect(steps[1].status).toBe('not_started');
      expect(steps[1].completedAt).toBeNull();
    });
  });

  // Field mapping
  describe('field mapping', () => {
    it('sets correct 1-indexed stepOrder', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      expect(steps[0].stepOrder).toBe(1);
      expect(steps[1].stepOrder).toBe(2);
      expect(steps[2].stepOrder).toBe(3);
    });

    it('defaults empty documents_needed and warnings to []', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      // aetna-med-02 has empty arrays in template
      expect(steps[1].documentsNeeded).toEqual([]);
      expect(steps[1].warnings).toEqual([]);
    });

    it('passes url through (null when absent)', async () => {
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });

      await hydrateWorkflowSteps(prismaMock, 'enr-1', 'aetna', 'medical');

      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0]![0];
      const steps = (call as any).data;
      expect(steps[0].url).toBeNull();            // no url in template
      expect(steps[2].url).toBe('https://aetna.com/portal'); // has url
    });
  });
});

// ============================================================
// updateStepStatus
// ============================================================

describe('updateStepStatus', () => {
  it('sets startedAt when status is in_progress', async () => {
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(mockWorkflowStep as any);

    await updateStepStatus(prismaMock, 'step-1', 'in_progress');

    const updateCall = prismaMock.enrollmentWorkflowStep.update.mock.calls[0]![0];
    expect((updateCall.data as any).startedAt).toBeInstanceOf(Date);
    expect((updateCall.data as any).status).toBe('in_progress');
  });

  it('sets startedAt + completedAt + completedById when completed', async () => {
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(mockWorkflowStep as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([]);

    await updateStepStatus(prismaMock, 'step-1', 'completed', 'user-123');

    const updateCall = prismaMock.enrollmentWorkflowStep.update.mock.calls[0]![0];
    expect((updateCall.data as any).startedAt).toBeInstanceOf(Date);
    expect((updateCall.data as any).completedAt).toBeInstanceOf(Date);
    expect((updateCall.data as any).completedById).toBe('user-123');
  });

  it('sets completedById to null when no userId provided', async () => {
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(mockWorkflowStep as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([]);

    await updateStepStatus(prismaMock, 'step-1', 'completed');

    const updateCall = prismaMock.enrollmentWorkflowStep.update.mock.calls[0]![0];
    expect((updateCall.data as any).completedById).toBeNull();
  });

  it('saves notes when provided, skips when undefined', async () => {
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(mockWorkflowStep as any);

    await updateStepStatus(prismaMock, 'step-1', 'in_progress', undefined, 'some notes');

    const updateCall = prismaMock.enrollmentWorkflowStep.update.mock.calls[0]![0];
    expect((updateCall.data as any).notes).toBe('some notes');

    // Without notes
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(mockWorkflowStep as any);
    await updateStepStatus(prismaMock, 'step-1', 'in_progress');

    const updateCall2 = prismaMock.enrollmentWorkflowStep.update.mock.calls[1]![0];
    expect((updateCall2.data as any).notes).toBeUndefined();
  });

  it('calls unblockDependentSteps when completed', async () => {
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue({
      ...mockWorkflowStep,
      enrollmentId: 'enr-1',
      templateStepId: 'aetna-med-01',
    } as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([]);

    await updateStepStatus(prismaMock, 'step-1', 'completed');

    // unblockDependentSteps calls findMany to get all steps
    expect(prismaMock.enrollmentWorkflowStep.findMany).toHaveBeenCalledWith({
      where: { enrollmentId: 'enr-1' },
    });
  });

  it('does NOT call unblockDependentSteps for other statuses', async () => {
    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(mockWorkflowStep as any);

    await updateStepStatus(prismaMock, 'step-1', 'in_progress');

    expect(prismaMock.enrollmentWorkflowStep.findMany).not.toHaveBeenCalled();
  });
});

// ============================================================
// unblockDependentSteps (tested indirectly via updateStepStatus)
// ============================================================

describe('unblockDependentSteps', () => {
  it('unblocks blocked steps when all dependencies completed', async () => {
    const completedStep = {
      ...mockWorkflowStepCompleted,
      enrollmentId: 'enr-1',
      templateStepId: 'aetna-med-01',
    };
    const blockedStep = {
      ...mockWorkflowStepBlocked,
      enrollmentId: 'enr-1',
      dependencies: ['aetna-med-01'],
    };

    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(completedStep as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([
      completedStep,
      blockedStep,
    ] as any);
    prismaMock.enrollmentWorkflowStep.updateMany.mockResolvedValue({ count: 1 });

    await updateStepStatus(prismaMock, completedStep.id, 'completed');

    expect(prismaMock.enrollmentWorkflowStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [blockedStep.id] } },
        data: expect.objectContaining({ status: 'not_started' }),
      })
    );
  });

  it('does not unblock steps with remaining incomplete deps', async () => {
    const completedStep = {
      ...mockWorkflowStepCompleted,
      enrollmentId: 'enr-1',
      templateStepId: 'aetna-med-01',
    };
    const blockedStep = {
      ...mockWorkflowStepBlocked,
      enrollmentId: 'enr-1',
      // Depends on TWO steps, only one is completed
      dependencies: ['aetna-med-01', 'aetna-med-03'],
    };

    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(completedStep as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([
      completedStep,
      blockedStep,
    ] as any);

    await updateStepStatus(prismaMock, completedStep.id, 'completed');

    // updateMany should NOT be called because not all deps are met
    expect(prismaMock.enrollmentWorkflowStep.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing when no blocked steps exist', async () => {
    const completedStep = {
      ...mockWorkflowStepCompleted,
      enrollmentId: 'enr-1',
      templateStepId: 'aetna-med-01',
    };

    prismaMock.enrollmentWorkflowStep.update.mockResolvedValue(completedStep as any);
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([completedStep] as any);

    await updateStepStatus(prismaMock, completedStep.id, 'completed');

    expect(prismaMock.enrollmentWorkflowStep.updateMany).not.toHaveBeenCalled();
  });
});

// ============================================================
// getWorkflowProgress
// ============================================================

describe('getWorkflowProgress', () => {
  it('returns null when no steps exist', async () => {
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([]);

    const result = await getWorkflowProgress(prismaMock, 'enr-1');
    expect(result).toBeNull();
  });

  it('calculates correct counts for mixed statuses', async () => {
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([
      mockWorkflowStepCompleted,
      mockWorkflowStepInProgress,
      mockWorkflowStepBlocked,
      mockWorkflowStepSkipped,
    ] as any);

    const result = await getWorkflowProgress(prismaMock, 'enr-1');

    expect(result!.totalSteps).toBe(4);
    expect(result!.completedSteps).toBe(1);
    expect(result!.inProgressSteps).toBe(1);
    expect(result!.blockedSteps).toBe(1);
    expect(result!.skippedSteps).toBe(1);
    // percentComplete = (1 completed + 1 skipped) / 4 * 100 = 50
    expect(result!.percentComplete).toBe(50);
  });

  it('returns currentStep as first non-completed/non-skipped', async () => {
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([
      mockWorkflowStepCompleted,
      mockWorkflowStepInProgress,
      mockWorkflowStepBlocked,
    ] as any);

    const result = await getWorkflowProgress(prismaMock, 'enr-1');

    expect(result!.currentStep).not.toBeNull();
    expect(result!.currentStep!.id).toBe(mockWorkflowStepInProgress.id);
  });

  it('returns null currentStep when all done', async () => {
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([
      mockWorkflowStepCompleted,
      { ...mockWorkflowStepSkipped },
    ] as any);

    const result = await getWorkflowProgress(prismaMock, 'enr-1');

    expect(result!.currentStep).toBeNull();
  });

  it('sums estimatedDaysRemaining for incomplete steps only', async () => {
    prismaMock.enrollmentWorkflowStep.findMany.mockResolvedValue([
      { ...mockWorkflowStepCompleted, estimatedDays: 5 },    // completed - excluded
      { ...mockWorkflowStepInProgress, estimatedDays: 10 },  // in_progress - included
      { ...mockWorkflowStepBlocked, estimatedDays: 30 },     // blocked - included
      { ...mockWorkflowStepSkipped, estimatedDays: 14 },     // skipped - excluded
    ] as any);

    const result = await getWorkflowProgress(prismaMock, 'enr-1');

    expect(result!.estimatedDaysRemaining).toBe(40); // 10 + 30
  });
});

// ============================================================
// getAvailableWorkflows
// ============================================================

describe('getAvailableWorkflows', () => {
  it('returns null for unknown payer key', () => {
    const result = getAvailableWorkflows('nonexistent');
    expect(result).toBeNull();
  });

  it('returns workflow summaries with stepCount and timeline', () => {
    const result = getAvailableWorkflows('aetna');

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2); // medical + behavioral_health
    const medical = result!.find((w) => w.type === 'medical');
    expect(medical!.label).toBe('Medical Credentialing');
    expect(medical!.stepCount).toBe(3);
    expect(medical!.timeline).toBeDefined();
  });
});

// ============================================================
// getActionTypeConfig
// ============================================================

describe('getActionTypeConfig', () => {
  it('returns action_types from template data', () => {
    const config = getActionTypeConfig();

    expect(config.form_submission).toBeDefined();
    expect(config.form_submission.label).toBe('Form Submission');
    expect(config.payer_review).toBeDefined();
  });
});
