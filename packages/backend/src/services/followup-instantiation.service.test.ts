import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { instantiateFollowUp } from './followup-instantiation.service.js';

function makeTemplate(overrides: any = {}) {
  return {
    id: 'fut-1',
    payerTrackId: 'pt-1',
    name: 'Aetna BH Follow-up',
    version: 1,
    status: 'active',
    description: null,
    createdBy: 'admin-1',
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    steps: [
      {
        id: 'fus-1', templateId: 'fut-1', stepOrder: 1,
        name: 'Initial Email', channel: 'email',
        triggerDaysAfterPrev: 14, escalationLevel: 1,
        emailSubject: 'Status check', emailBodyTemplate: 'Hello...',
        emailTone: 'professional', retellScriptTemplate: null,
        retellAgentId: null, requiresApproval: true, createdAt: new Date(),
      },
      {
        id: 'fus-2', templateId: 'fut-1', stepOrder: 2,
        name: 'Follow-up Call', channel: 'phone_call',
        triggerDaysAfterPrev: 7, escalationLevel: 2,
        emailSubject: null, emailBodyTemplate: null,
        emailTone: null, retellScriptTemplate: 'Script...',
        retellAgentId: 'agent-1', requiresApproval: true, createdAt: new Date(),
      },
    ],
    ...overrides,
  };
}

describe('followup-instantiation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('instantiateFollowUp', () => {
    it('returns templateFound=false when no active template exists', async () => {
      prismaMock.followUpRun.findFirst.mockResolvedValue(null);
      prismaMock.followUpTemplate.findFirst.mockResolvedValue(null);

      const result = await instantiateFollowUp(prismaMock as any, 'enr-1', 'pt-1');

      expect(result.templateFound).toBe(false);
      expect(result.runCreated).toBe(false);
      expect(result.runId).toBeNull();
    });

    it('creates FollowUpRun from active template', async () => {
      prismaMock.followUpRun.findFirst.mockResolvedValue(null); // no existing run
      prismaMock.followUpTemplate.findFirst.mockResolvedValue(makeTemplate());
      prismaMock.followUpRun.create.mockResolvedValue({
        id: 'run-1',
        enrollmentId: 'enr-1',
        templateId: 'fut-1',
        status: 'active',
        currentStepOrder: 1,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await instantiateFollowUp(prismaMock as any, 'enr-1', 'pt-1');

      expect(result.runCreated).toBe(true);
      expect(result.templateFound).toBe(true);
      expect(result.templateId).toBe('fut-1');
      expect(result.templateName).toBe('Aetna BH Follow-up');
      expect(result.runId).toBe('run-1');
      expect(result.firstStepChannel).toBe('email');
      expect(result.firstStepTriggerDays).toBe(14);

      // Verify FollowUpRun was created with correct data
      expect(prismaMock.followUpRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          enrollmentId: 'enr-1',
          templateId: 'fut-1',
          status: 'active',
          currentStepOrder: 1,
        }),
      });
    });

    it('prevents duplicate runs for same enrollment', async () => {
      prismaMock.followUpRun.findFirst.mockResolvedValue({
        id: 'existing-run',
        enrollmentId: 'enr-1',
        templateId: 'fut-1',
        status: 'active',
        currentStepOrder: 1,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await instantiateFollowUp(prismaMock as any, 'enr-1', 'pt-1');

      expect(result.runCreated).toBe(false);
      expect(result.runId).toBe('existing-run');
      expect(prismaMock.followUpTemplate.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.followUpRun.create).not.toHaveBeenCalled();
    });

    it('skips instantiation when template has no steps', async () => {
      prismaMock.followUpRun.findFirst.mockResolvedValue(null);
      prismaMock.followUpTemplate.findFirst.mockResolvedValue(makeTemplate({ steps: [] }));

      const result = await instantiateFollowUp(prismaMock as any, 'enr-1', 'pt-1');

      expect(result.templateFound).toBe(true);
      expect(result.runCreated).toBe(false);
      expect(result.runId).toBeNull();
      expect(prismaMock.followUpRun.create).not.toHaveBeenCalled();
    });

    it('selects highest version active template', async () => {
      prismaMock.followUpRun.findFirst.mockResolvedValue(null);
      prismaMock.followUpTemplate.findFirst.mockResolvedValue(makeTemplate({ version: 3 }));
      prismaMock.followUpRun.create.mockResolvedValue({
        id: 'run-1', enrollmentId: 'enr-1', templateId: 'fut-1',
        status: 'active', currentStepOrder: 1, startedAt: new Date(),
        completedAt: null, createdAt: new Date(), updatedAt: new Date(),
      } as any);

      await instantiateFollowUp(prismaMock as any, 'enr-1', 'pt-1');

      expect(prismaMock.followUpTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { payerTrackId: 'pt-1', status: 'active' },
          orderBy: { version: 'desc' },
        })
      );
    });
  });
});
