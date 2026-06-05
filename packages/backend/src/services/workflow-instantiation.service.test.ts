import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { instantiateWorkflow } from './workflow-instantiation.service.js';

function makeTemplate(overrides: any = {}) {
  return {
    id: 'tmpl-1',
    payerTrackId: 'pt-1',
    name: 'Aetna BH Standard',
    version: 1,
    status: 'active',
    description: null,
    createdBy: 'admin-1',
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    steps: [
      {
        id: 'step-1', templateId: 'tmpl-1', stepOrder: 1,
        name: 'Readiness Check', description: 'Verify docs',
        stepType: 'readiness_check', owner: 'credentialing_staff',
        requiredDocuments: ['NPI', 'License'], triggerDaysAfterPrev: null,
        isBlocking: true, reviewerInstructions: null, createdAt: new Date(),
      },
      {
        id: 'step-2', templateId: 'tmpl-1', stepOrder: 2,
        name: 'Submit Application', description: 'Submit to payer',
        stepType: 'submit_application', owner: 'credentialing_staff',
        requiredDocuments: [], triggerDaysAfterPrev: 3,
        isBlocking: true, reviewerInstructions: null, createdAt: new Date(),
      },
      {
        id: 'step-3', templateId: 'tmpl-1', stepOrder: 3,
        name: 'Await Decision', description: 'Wait for payer',
        stepType: 'await_decision', owner: 'payer',
        requiredDocuments: [], triggerDaysAfterPrev: 14,
        isBlocking: true, reviewerInstructions: null, createdAt: new Date(),
      },
    ],
    conditions: [],
    ...overrides,
  };
}

describe('workflow-instantiation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('instantiateWorkflow', () => {
    it('returns templateFound=false when no active template exists', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(null);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      expect(result.templateFound).toBe(false);
      expect(result.stepsCreated).toBe(0);
      expect(result.templateId).toBeNull();
    });

    it('creates EnrollmentWorkflowStep records from template steps', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(makeTemplate());
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      expect(result.templateFound).toBe(true);
      expect(result.stepsCreated).toBe(3);
      expect(result.templateId).toBe('tmpl-1');
      expect(result.templateName).toBe('Aetna BH Standard');

      // Verify createMany was called with correct mapped data
      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0][0];
      expect(call.data).toHaveLength(3);
      expect(call.data[0].name).toBe('Readiness Check');
      expect(call.data[0].actionType).toBe('verification'); // readiness_check → verification
      expect(call.data[0].stepOrder).toBe(1);
      expect(call.data[0].status).toBe('not_started');
      expect(call.data[0].documentsNeeded).toEqual(['NPI', 'License']);
    });

    it('updates enrollment with workflowTemplateId', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(makeTemplate());
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr-1' },
        data: { workflowTemplateId: 'tmpl-1' },
      });
    });

    it('maps step types to action types correctly', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(makeTemplate());
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      const data = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0][0].data;
      expect(data[0].actionType).toBe('verification');      // readiness_check
      expect(data[1].actionType).toBe('form_submission');    // submit_application
      expect(data[2].actionType).toBe('payer_review');       // await_decision
    });

    it('evaluates state condition — add_step', async () => {
      const template = makeTemplate({
        conditions: [{
          id: 'cond-1', templateId: 'tmpl-1', conditionType: 'state',
          conditionValue: 'TX', action: 'add_step', targetStepOrder: 2,
          stepDefinition: { name: 'TX Open Enrollment Check', stepType: 'human_review', owner: 'credentialing_staff' },
          createdAt: new Date(),
        }],
      });
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(template);
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 4 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1', { state: 'TX' });

      expect(result.conditionsApplied).toBe(1);
      expect(result.stepsCreated).toBe(4); // 3 base + 1 added
    });

    it('evaluates state condition — skip_step', async () => {
      const template = makeTemplate({
        conditions: [{
          id: 'cond-1', templateId: 'tmpl-1', conditionType: 'state',
          conditionValue: 'CA', action: 'skip_step', targetStepOrder: 2,
          stepDefinition: null, createdAt: new Date(),
        }],
      });
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(template);
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 2 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1', { state: 'CA' });

      expect(result.conditionsApplied).toBe(1);
      const data = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(2); // step 2 skipped
    });

    it('does not apply condition when context does not match', async () => {
      const template = makeTemplate({
        conditions: [{
          id: 'cond-1', templateId: 'tmpl-1', conditionType: 'state',
          conditionValue: 'TX', action: 'skip_step', targetStepOrder: 2,
          stepDefinition: null, createdAt: new Date(),
        }],
      });
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(template);
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1', { state: 'CA' });

      expect(result.conditionsApplied).toBe(0);
      const data = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(3); // no steps skipped
    });

    it('selects highest version active template', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ version: 3 }));
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      expect(prismaMock.workflowTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { payerTrackId: 'pt-1', status: 'active' },
          orderBy: { version: 'desc' },
        })
      );
    });
  });
});
