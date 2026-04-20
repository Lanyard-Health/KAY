import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { logEnrollmentRunTransition } from './audit.service.js';
import { logger } from '../../utils/logger.js';

describe('logEnrollmentRunTransition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes an AuditLog row with the transition details', async () => {
    (prismaMock.auditLog.create as any).mockResolvedValue({});

    await logEnrollmentRunTransition({
      runId: 'run-1',
      from: 'filling',
      to: 'awaiting_review',
      userId: 'user-1',
      details: { filledCount: 12 },
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'update',
        resourceType: 'enrollment_run',
        resourceId: 'run-1',
        userId: 'user-1',
        changes: { from: 'filling', to: 'awaiting_review', filledCount: 12 },
      },
    });
  });

  it('handles null from-state (initial create)', async () => {
    (prismaMock.auditLog.create as any).mockResolvedValue({});
    await logEnrollmentRunTransition({ runId: 'run-1', from: null, to: 'filling' });
    const arg = (prismaMock.auditLog.create as any).mock.calls[0][0];
    expect(arg.data.changes.from).toBeNull();
    expect(arg.data.userId).toBeNull();
  });

  it('swallows DB errors so the pipeline keeps running', async () => {
    (prismaMock.auditLog.create as any).mockRejectedValue(new Error('boom'));
    await expect(
      logEnrollmentRunTransition({ runId: 'run-1', from: 'filling', to: 'failed' })
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
