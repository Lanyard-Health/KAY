import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const resolveCredentialMock = vi.fn();
vi.mock('../services/credential.service.js', () => ({
  resolveCredential: (...args: unknown[]) => resolveCredentialMock(...args),
  CredentialMissingError: class CredentialMissingError extends Error {
    constructor(public payerId: string, public type: string, public subjectId: string) {
      super(`No credential for ${type}`);
      this.name = 'CredentialMissingError';
    }
  },
}));

const logSubmissionEventMock = vi.fn();
vi.mock('../services/form-fill/audit.service.js', () => ({
  logSubmissionEvent: (...args: unknown[]) => logSubmissionEventMock(...args),
}));

const getSubmissionAdapterMock = vi.fn();
vi.mock('../agents/portal/adapter-factory.js', () => ({
  getSubmissionAdapter: (...args: unknown[]) => getSubmissionAdapterMock(...args),
}));

import { processSubmissionJob } from './submission.worker.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import type { Job } from 'bullmq';
import type { SubmissionJobData } from './submission.queue.js';

function makeJob(
  data: Partial<SubmissionJobData> = {},
  attemptsMade = 0,
  attempts = 3
): Job<SubmissionJobData> {
  return {
    id: data.enrollmentRunId ?? 'run-1',
    data: {
      enrollmentRunId: 'run-1',
      payerId: 'payer-1',
      practiceId: 'practice-1',
      providerId: 'provider-1',
      dedupeKey: 'abc',
      enqueuedAt: new Date().toISOString(),
      ...data,
    },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<SubmissionJobData>;
}

function makeWipeableCred(overrides: Record<string, unknown> = {}) {
  const wipe = vi.fn();
  return {
    credentialId: 'cred-1',
    username: 'u',
    password: 'pw',
    mfaSeed: null,
    extraConfig: null,
    wipe,
    ...overrides,
  };
}

describe('processSubmissionJob', () => {
  beforeEach(() => {
    resolveCredentialMock.mockReset();
    logSubmissionEventMock.mockReset();
    getSubmissionAdapterMock.mockReset();
  });

  it('success path: PENDING → SUBMITTING → SUBMITTED with CONFIRMED audit event', async () => {
    prismaMock.enrollmentRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PENDING',
      enrollmentId: 'enr-1',
      enrollment: { providerId: 'provider-1', provider: { practiceId: 'practice-1' } },
    } as never);
    prismaMock.agentWorkflow.findFirst.mockResolvedValue({ id: 'wf-1' } as never);
    prismaMock.payer.findUnique.mockResolvedValue({
      id: 'payer-1',
      name: 'Test',
      submissionConfig: { adapterType: 'CAQH' },
    } as never);
    prismaMock.enrollmentRun.update.mockResolvedValue({} as never);

    const wipe = vi.fn();
    resolveCredentialMock.mockResolvedValue(makeWipeableCred({ wipe }));

    const adapterSubmit = vi.fn().mockResolvedValue({
      success: true,
      confirmationNumber: 'CONF-12345',
      externalReference: 'EXT-67890',
      preScreenshotKey: 'submissions/run-1/pre.png',
      postScreenshotKey: 'submissions/run-1/post.png',
    });
    getSubmissionAdapterMock.mockReturnValue({
      adapterType: 'CAQH',
      submit: adapterSubmit,
    });

    const result = await processSubmissionJob(makeJob());

    expect(result.status).toBe('completed');
    expect(result.confirmationNumber).toBe('CONF-12345');

    // 3 audit events expected: STARTED, SUBMITTED, CONFIRMED
    const actions = logSubmissionEventMock.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual([
      'SUBMISSION_STARTED',
      'SUBMISSION_SUBMITTED',
      'SUBMISSION_CONFIRMED',
    ]);

    // State transitions: SUBMITTING then SUBMITTED
    const updates = prismaMock.enrollmentRun.update.mock.calls.map((c) => c[0].data);
    expect((updates[0] as { status: string }).status).toBe('SUBMITTING');
    expect((updates[1] as { status: string }).status).toBe('SUBMITTED');
    expect((updates[1] as { confirmationNumber: string }).confirmationNumber).toBe('CONF-12345');

    // Credential was wiped after use
    expect(wipe).toHaveBeenCalled();
  });

  it('idempotency: status already SUBMITTED → SUBMISSION_SKIPPED_IDEMPOTENT, no transitions', async () => {
    prismaMock.enrollmentRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'SUBMITTED',
      enrollmentId: 'enr-1',
      enrollment: { providerId: 'provider-1', provider: { practiceId: 'practice-1' } },
    } as never);
    prismaMock.agentWorkflow.findFirst.mockResolvedValue({ id: 'wf-1' } as never);

    const result = await processSubmissionJob(makeJob());

    expect(result.status).toBe('skipped');
    expect(prismaMock.enrollmentRun.update).not.toHaveBeenCalled();

    const actions = logSubmissionEventMock.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['SUBMISSION_SKIPPED_IDEMPOTENT']);
    expect(getSubmissionAdapterMock).not.toHaveBeenCalled();
  });

  it('idempotency: status FAILED → SUBMISSION_SKIPPED_IDEMPOTENT', async () => {
    prismaMock.enrollmentRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'FAILED',
      enrollmentId: 'enr-1',
      enrollment: { providerId: 'provider-1', provider: { practiceId: 'practice-1' } },
    } as never);
    prismaMock.agentWorkflow.findFirst.mockResolvedValue({ id: 'wf-1' } as never);

    const result = await processSubmissionJob(makeJob());

    expect(result.status).toBe('skipped');
    expect(getSubmissionAdapterMock).not.toHaveBeenCalled();
  });

  it('non-terminal failure (attempt 1 of 3): writes ATTEMPT_FAILED + throws to trigger BullMQ retry', async () => {
    prismaMock.enrollmentRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PENDING',
      enrollmentId: 'enr-1',
      enrollment: { providerId: 'provider-1', provider: { practiceId: 'practice-1' } },
    } as never);
    prismaMock.agentWorkflow.findFirst.mockResolvedValue({ id: 'wf-1' } as never);
    prismaMock.payer.findUnique.mockResolvedValue({
      id: 'payer-1',
      name: 'Test',
      submissionConfig: { adapterType: 'CAQH' },
    } as never);
    prismaMock.enrollmentRun.update.mockResolvedValue({} as never);

    resolveCredentialMock.mockResolvedValue(makeWipeableCred());
    getSubmissionAdapterMock.mockReturnValue({
      adapterType: 'CAQH',
      submit: vi.fn().mockResolvedValue({
        success: false,
        errorMessage: 'portal returned 503',
      }),
    });

    await expect(
      processSubmissionJob(makeJob({}, /* attemptsMade */ 0, /* attempts */ 3))
    ).rejects.toThrow(/portal returned 503/);

    const actions = logSubmissionEventMock.mock.calls.map((c) => c[0].action);
    expect(actions).toContain('SUBMISSION_STARTED');
    expect(actions).toContain('SUBMISSION_ATTEMPT_FAILED');
    expect(actions).not.toContain('SUBMISSION_DEAD_LETTERED');

    // status must be reset to QUEUED so the next BullMQ retry passes the
    // idempotency pre-flight check (run.status was 'SUBMITTING' when the
    // attempt began; if we don't reset it, retries log
    // SUBMISSION_SKIPPED_IDEMPOTENT and bail).
    const queuedWrite = prismaMock.enrollmentRun.update.mock.calls.find(
      (c) => (c[0].data as { status?: string }).status === 'QUEUED'
    );
    expect(queuedWrite).toBeDefined();
  });

  it('terminal failure (last attempt): writes DEAD_LETTERED + sets status=FAILED, does NOT throw', async () => {
    prismaMock.enrollmentRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PENDING',
      enrollmentId: 'enr-1',
      enrollment: { providerId: 'provider-1', provider: { practiceId: 'practice-1' } },
    } as never);
    prismaMock.agentWorkflow.findFirst.mockResolvedValue({ id: 'wf-1' } as never);
    prismaMock.payer.findUnique.mockResolvedValue({
      id: 'payer-1',
      name: 'Test',
      submissionConfig: { adapterType: 'CAQH' },
    } as never);
    prismaMock.enrollmentRun.update.mockResolvedValue({} as never);

    resolveCredentialMock.mockResolvedValue(makeWipeableCred());
    getSubmissionAdapterMock.mockReturnValue({
      adapterType: 'CAQH',
      submit: vi.fn().mockResolvedValue({
        success: false,
        errorMessage: 'portal returned 503',
      }),
    });

    const result = await processSubmissionJob(makeJob({}, /* attemptsMade */ 2, /* attempts */ 3));

    expect(result.status).toBe('failed');

    const actions = logSubmissionEventMock.mock.calls.map((c) => c[0].action);
    expect(actions).toContain('SUBMISSION_ATTEMPT_FAILED');
    expect(actions).toContain('SUBMISSION_DEAD_LETTERED');

    // status=FAILED written on terminal failure
    const failedWrite = prismaMock.enrollmentRun.update.mock.calls.find(
      (c) => (c[0].data as { status?: string }).status === 'FAILED'
    );
    expect(failedWrite).toBeDefined();
  });

  it('cross-tenant isolation: two practices resolve their own credentials via separate jobs', async () => {
    // Practice A
    prismaMock.enrollmentRun.findUnique.mockResolvedValueOnce({
      id: 'run-a',
      status: 'PENDING',
      enrollmentId: 'enr-a',
      enrollment: { providerId: 'provider-a', provider: { practiceId: 'practice-a' } },
    } as never);
    prismaMock.agentWorkflow.findFirst.mockResolvedValueOnce({ id: 'wf-a' } as never);
    prismaMock.payer.findUnique.mockResolvedValueOnce({
      id: 'payer-1',
      name: 'P',
      submissionConfig: { adapterType: 'CAQH' },
    } as never);

    // Practice B
    prismaMock.enrollmentRun.findUnique.mockResolvedValueOnce({
      id: 'run-b',
      status: 'PENDING',
      enrollmentId: 'enr-b',
      enrollment: { providerId: 'provider-b', provider: { practiceId: 'practice-b' } },
    } as never);
    prismaMock.agentWorkflow.findFirst.mockResolvedValueOnce({ id: 'wf-b' } as never);
    prismaMock.payer.findUnique.mockResolvedValueOnce({
      id: 'payer-1',
      name: 'P',
      submissionConfig: { adapterType: 'CAQH' },
    } as never);

    prismaMock.enrollmentRun.update.mockResolvedValue({} as never);

    const credA = makeWipeableCred({ credentialId: 'cred-a', username: 'u-a' });
    const credB = makeWipeableCred({ credentialId: 'cred-b', username: 'u-b' });
    resolveCredentialMock.mockResolvedValueOnce(credA).mockResolvedValueOnce(credB);

    const submitA = vi.fn().mockResolvedValue({ success: true, confirmationNumber: 'A' });
    const submitB = vi.fn().mockResolvedValue({ success: true, confirmationNumber: 'B' });
    getSubmissionAdapterMock.mockReturnValueOnce({ adapterType: 'CAQH', submit: submitA });
    getSubmissionAdapterMock.mockReturnValueOnce({ adapterType: 'CAQH', submit: submitB });

    const resultA = await processSubmissionJob(
      makeJob({ enrollmentRunId: 'run-a', practiceId: 'practice-a', providerId: 'provider-a' })
    );
    const resultB = await processSubmissionJob(
      makeJob({ enrollmentRunId: 'run-b', practiceId: 'practice-b', providerId: 'provider-b' })
    );

    expect(resultA.confirmationNumber).toBe('A');
    expect(resultB.confirmationNumber).toBe('B');

    // resolveCredential called with each practice's own ids — never crossed
    expect(resolveCredentialMock).toHaveBeenNthCalledWith(1, 'payer-1', 'practice-a', 'provider-a');
    expect(resolveCredentialMock).toHaveBeenNthCalledWith(2, 'payer-1', 'practice-b', 'provider-b');

    // Each adapter call received only its own credential struct
    expect(submitA).toHaveBeenCalledWith(expect.anything(), credA);
    expect(submitB).toHaveBeenCalledWith(expect.anything(), credB);
  });

  it('credential missing: marks final attempt as DEAD_LETTERED with CREDENTIAL_MISSING code', async () => {
    prismaMock.enrollmentRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PENDING',
      enrollmentId: 'enr-1',
      enrollment: { providerId: 'provider-1', provider: { practiceId: 'practice-1' } },
    } as never);
    prismaMock.agentWorkflow.findFirst.mockResolvedValue({ id: 'wf-1' } as never);
    prismaMock.payer.findUnique.mockResolvedValue({
      id: 'payer-1',
      name: 'Test',
      submissionConfig: { adapterType: 'CAQH' },
    } as never);
    prismaMock.enrollmentRun.update.mockResolvedValue({} as never);

    const { CredentialMissingError } = await import('../services/credential.service.js');
    resolveCredentialMock.mockRejectedValue(
      new CredentialMissingError('payer-1', 'GROUP' as never, 'practice-1')
    );

    const result = await processSubmissionJob(
      makeJob({}, /* attemptsMade */ 2, /* attempts */ 3)
    );

    expect(result.status).toBe('failed');
    const deadLetter = logSubmissionEventMock.mock.calls.find(
      (c) => c[0].action === 'SUBMISSION_DEAD_LETTERED'
    );
    expect(deadLetter).toBeDefined();
    const attemptFailed = logSubmissionEventMock.mock.calls.find(
      (c) => c[0].action === 'SUBMISSION_ATTEMPT_FAILED'
    );
    expect(attemptFailed?.[0].data.errorCode).toBe('CREDENTIAL_MISSING');
  });

  it('EnrollmentRun missing: returns skipped without touching adapter', async () => {
    prismaMock.enrollmentRun.findUnique.mockResolvedValue(null);

    const result = await processSubmissionJob(makeJob());

    expect(result.status).toBe('skipped');
    expect(getSubmissionAdapterMock).not.toHaveBeenCalled();
    expect(logSubmissionEventMock).not.toHaveBeenCalled();
  });
});
