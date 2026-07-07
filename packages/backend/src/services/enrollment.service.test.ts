import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./denial-triage.service.js', () => ({ triggerDenialTriage: vi.fn().mockResolvedValue({}) }));
vi.mock('./terminationWorkflow.service.js', () => ({ triggerTerminationWorkflow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./followup-instantiation.service.js', () => ({ instantiateFollowUp: vi.fn().mockResolvedValue({}) }));
vi.mock('./enrollment-outcome.service.js', () => ({ recordEnrollmentOutcome: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./enrollment-alerts.service.js', () => ({ notifyEnrollmentStatusChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../agents/webhook-emitter.js', () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }));

import { correctEnrollmentStatus } from './enrollment.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { recordEnrollmentOutcome } from './enrollment-outcome.service.js';
import { notifyEnrollmentStatusChange } from './enrollment-alerts.service.js';
import { emitWebhookEvent } from '../agents/webhook-emitter.js';

describe('correctEnrollmentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.enrollment.update.mockResolvedValue({ id: 'enr-1', status: 'submitted' } as any);
    prismaMock.enrollmentOutcome.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.enrollmentWorkflowStep.updateMany.mockResolvedValue({ count: 2 } as any);
    prismaMock.auditLog.create.mockResolvedValue({} as any);
  });

  function mockExisting(status: string, notifiedStatuses: string[] = []) {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      id: 'enr-1',
      status,
      notifiedStatuses,
      providerId: 'prov-1',
    } as any);
  }

  it('corrects denied → submitted: clears notified entry, deletes outcome, un-skips steps, audits, no notifications', async () => {
    mockExisting('denied', ['submitted', 'denied']);

    await correctEnrollmentStatus('enr-1', 'submitted', 'user-1');

    expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'enr-1' },
        data: expect.objectContaining({
          status: 'submitted',
          notifiedStatuses: { set: ['submitted'] },
          updatedById: 'user-1',
        }),
      })
    );

    expect(prismaMock.enrollmentOutcome.deleteMany).toHaveBeenCalledWith({
      where: { enrollmentId: 'enr-1', outcome: 'denied' },
    });

    expect(prismaMock.enrollmentWorkflowStep.updateMany).toHaveBeenCalledWith({
      where: { enrollmentId: 'enr-1', status: 'skipped', skippedReason: 'Enrollment denied' },
      data: { status: 'not_started', skippedReason: null },
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: { field: 'status', from: 'denied', to: 'submitted', source: 'status_correction' },
        }),
      })
    );

    expect(vi.mocked(notifyEnrollmentStatusChange)).not.toHaveBeenCalled();
    expect(vi.mocked(emitWebhookEvent)).not.toHaveBeenCalled();
  });

  it('records the outcome for the corrected-to status', async () => {
    mockExisting('denied', ['denied']);

    await correctEnrollmentStatus('enr-1', 'approved', 'user-1');

    expect(vi.mocked(recordEnrollmentOutcome)).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: 'enr-1', status: 'approved' })
    );
  });

  it('non-terminal → non-terminal correction touches no outcome rows or steps', async () => {
    mockExisting('submitted', ['submitted']);

    await correctEnrollmentStatus('enr-1', 'in_progress', 'user-1');

    expect(prismaMock.enrollmentOutcome.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentWorkflowStep.updateMany).not.toHaveBeenCalled();
  });

  it('deletes the approved outcome when correcting away from approved (non-terminal old status)', async () => {
    mockExisting('approved', ['approved']);

    await correctEnrollmentStatus('enr-1', 'pending_review', 'user-1');

    expect(prismaMock.enrollmentOutcome.deleteMany).toHaveBeenCalledWith({
      where: { enrollmentId: 'enr-1', outcome: 'approved' },
    });
    // approved is not terminal — no step un-skip
    expect(prismaMock.enrollmentWorkflowStep.updateMany).not.toHaveBeenCalled();
  });

  it('correcting INTO a terminal status skips incomplete steps', async () => {
    mockExisting('approved', []);

    await correctEnrollmentStatus('enr-1', 'denied', 'user-1');

    expect(prismaMock.enrollmentWorkflowStep.updateMany).toHaveBeenCalledWith({
      where: { enrollmentId: 'enr-1', status: { in: ['not_started', 'in_progress', 'blocked'] } },
      data: { status: 'skipped', skippedReason: 'Enrollment denied' },
    });
  });

  it('throws when correcting to the same status', async () => {
    mockExisting('submitted');

    await expect(correctEnrollmentStatus('enr-1', 'submitted', 'user-1')).rejects.toThrow(
      /already 'submitted'/
    );
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the enrollment does not exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    await expect(correctEnrollmentStatus('missing', 'submitted', 'user-1')).rejects.toThrow('Enrollment');
  });
});
