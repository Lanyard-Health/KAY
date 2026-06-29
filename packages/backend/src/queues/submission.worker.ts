import type { Job } from 'bullmq';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getSubmissionAdapter } from '../agents/portal/adapter-factory.js';
import { buildAetnaRfpProviderData } from '../agents/portal/aetna-rfp-resolver.js';
import { resolveCredential, CredentialMissingError } from '../services/credential.service.js';
import { logSubmissionEvent } from '../services/form-fill/audit.service.js';
import type { SubmissionJobData } from './submission.queue.js';
import type { EnrollmentRunStatus } from '@prisma/client';

/**
 * Submission worker — processes one BullMQ `submission` job through the new
 * pipeline. Owns:
 *
 *  1. Idempotency guard: reads EnrollmentRun.status. If not PENDING or QUEUED,
 *     logs SUBMISSION_SKIPPED_IDEMPOTENT and returns. This handles double-
 *     enqueue races, deploy-mid-job restarts, and BullMQ retry storms.
 *  2. State transitions: QUEUED → SUBMITTING → SUBMITTED / FAILED.
 *  3. Credential resolution + adapter dispatch through AdapterFactory.
 *  4. All 8 SUBMISSION_* audit events written to audit_logs + agent_events.
 *  5. Final-failure detection (BullMQ attempts exhausted) → DEAD_LETTERED
 *     audit event + EnrollmentRun.status = FAILED.
 *
 * Concurrency = 1. Submissions are slow and stateful; we don't want two
 * adapters racing on the same payer portal session.
 */

const QUEUED_OR_PENDING: EnrollmentRunStatus[] = ['PENDING', 'QUEUED'];

export interface SubmissionWorkerResult {
  status: 'completed' | 'skipped' | 'failed';
  enrollmentRunId: string;
  confirmationNumber?: string;
  externalReference?: string;
}

export async function processSubmissionJob(
  job: Job<SubmissionJobData>
): Promise<SubmissionWorkerResult> {
  const data = job.data;
  const { enrollmentRunId, payerId, practiceId, providerId, dedupeKey } = data;
  const attemptNumber = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts ?? 3;

  // 1. Load run + resolve workflow (workflowId required for agent_events dual-write)
  const run = await prisma.enrollmentRun.findUnique({
    where: { id: enrollmentRunId },
    select: {
      id: true,
      status: true,
      enrollmentId: true,
      enrollment: {
        select: {
          providerId: true,
          provider: { select: { practiceId: true, deletedAt: true } },
        },
      },
    },
  });

  if (!run) {
    // Job points to a row that no longer exists — log and accept the job as
    // done. Re-queueing would just keep failing.
    logger.warn('submission.worker: EnrollmentRun not found, accepting job as no-op', {
      enrollmentRunId,
    });
    return { status: 'skipped', enrollmentRunId };
  }

  // In-flight guard: provider was soft-deleted after this job was enqueued.
  // Accept the job as a no-op so the queue doesn't keep retrying. We don't
  // mutate the run state — that's a separate admin decision (likely cancel).
  if (run.enrollment.provider?.deletedAt) {
    logger.info('submission.worker: provider archived mid-flight, skipping', {
      enrollmentRunId,
      providerId,
      deletedAt: run.enrollment.provider?.deletedAt,
    });
    return { status: 'skipped', enrollmentRunId };
  }

  // Resolve the AgentWorkflow for this submission. Required for agent_events
  // chain. Falls back to a synthesized workflowId == enrollmentRunId if no
  // workflow row exists — that breaks chain continuity but preserves the
  // audit trail.
  const workflow = await prisma.agentWorkflow.findFirst({
    where: { enrollmentId: run.enrollmentId },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  const workflowId = workflow?.id ?? enrollmentRunId;

  // 2. Idempotency pre-flight
  if (!QUEUED_OR_PENDING.includes(run.status)) {
    await logSubmissionEvent({
      workflowId,
      runId: enrollmentRunId,
      action: 'SUBMISSION_SKIPPED_IDEMPOTENT',
      data: {
        currentStatus: run.status,
        dedupeKey,
        attemptNumber,
        reason: 'EnrollmentRun is not PENDING or QUEUED — assuming prior attempt completed',
      },
    });
    logger.info('submission.worker: skipping (idempotency)', {
      enrollmentRunId,
      currentStatus: run.status,
    });
    return { status: 'skipped', enrollmentRunId };
  }

  // 3. Started event
  await logSubmissionEvent({
    workflowId,
    runId: enrollmentRunId,
    action: 'SUBMISSION_STARTED',
    data: { attemptNumber, payerId, dedupeKey },
  });

  // 4. Resolve payer + adapter
  const payer = await prisma.payer.findUnique({
    where: { id: payerId },
    select: { id: true, name: true, submissionConfig: { select: { adapterType: true } } },
  });
  if (!payer || !payer.submissionConfig) {
    return await failRun({
      workflowId,
      run,
      enrollmentRunId,
      attemptNumber,
      maxAttempts,
      errorMessage: `Payer ${payerId} has no submissionConfig — cannot route submission`,
    });
  }

  // 5. Transition QUEUED → SUBMITTING (only if not already there)
  await prisma.enrollmentRun.update({
    where: { id: enrollmentRunId },
    data: { status: 'SUBMITTING' },
  });

  // 6. Resolve credential + dispatch adapter
  let credential: Awaited<ReturnType<typeof resolveCredential>> | undefined;
  try {
    credential = await resolveCredential(payerId, practiceId, providerId);

    const adapterType = payer.submissionConfig.adapterType;
    const adapter = getSubmissionAdapter(adapterType);

    // Build the provider data packet. Only Aetna RFP has a resolver today; every
    // other adapter keeps the Phase 1 `undefined` stub, unchanged. A resolver
    // throw (missing records, failed completeness gate, unmapped degree/specialty/
    // age/focus, missing/bad state) is intentionally NOT caught here — it
    // propagates to the catch below and fails the run loudly, rather than letting
    // a blank/partial application be submitted.
    let providerData: unknown = undefined;
    if (adapterType === 'AETNA_RFP') {
      providerData = await buildAetnaRfpProviderData({ providerId, practiceId, payerId }, prisma);
    }

    const result = await adapter.submit(
      {
        enrollmentRunId,
        payerId,
        practiceId,
        providerId,
        providerData,
      },
      credential
    );

    if (!result.success) {
      return await failRun({
        workflowId,
        run,
        enrollmentRunId,
        attemptNumber,
        maxAttempts,
        errorMessage: result.errorMessage ?? 'Adapter returned success=false',
        errorCode: result.errorCode,
        preScreenshotKey: result.preScreenshotKey,
        postScreenshotKey: result.postScreenshotKey,
      });
    }

    // 7. Success — SUBMITTED + CONFIRMED events
    await logSubmissionEvent({
      workflowId,
      runId: enrollmentRunId,
      action: 'SUBMISSION_SUBMITTED',
      data: {
        attemptNumber,
        preScreenshotKey: result.preScreenshotKey ?? null,
      },
    });

    await prisma.enrollmentRun.update({
      where: { id: enrollmentRunId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        externalReference: result.externalReference ?? null,
        confirmationNumber: result.confirmationNumber ?? null,
      },
    });

    await logSubmissionEvent({
      workflowId,
      runId: enrollmentRunId,
      action: 'SUBMISSION_CONFIRMED',
      data: {
        confirmationNumber: result.confirmationNumber ?? null,
        externalReference: result.externalReference ?? null,
        postScreenshotKey: result.postScreenshotKey ?? null,
      },
    });

    return {
      status: 'completed',
      enrollmentRunId,
      confirmationNumber: result.confirmationNumber,
      externalReference: result.externalReference,
    };
  } catch (err) {
    if (err instanceof CredentialMissingError) {
      return await failRun({
        workflowId,
        run,
        enrollmentRunId,
        attemptNumber,
        maxAttempts,
        errorMessage: err.message,
        errorCode: 'CREDENTIAL_MISSING',
      });
    }
    return await failRun({
      workflowId,
      run,
      enrollmentRunId,
      attemptNumber,
      maxAttempts,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  } finally {
    credential?.wipe();
  }
}

async function failRun(args: {
  workflowId: string;
  run: { status: EnrollmentRunStatus };
  enrollmentRunId: string;
  attemptNumber: number;
  maxAttempts: number;
  errorMessage: string;
  errorCode?: string;
  preScreenshotKey?: string;
  postScreenshotKey?: string;
}): Promise<SubmissionWorkerResult> {
  const {
    workflowId,
    enrollmentRunId,
    attemptNumber,
    maxAttempts,
    errorMessage,
    errorCode,
    preScreenshotKey,
    postScreenshotKey,
  } = args;
  const isTerminal = attemptNumber >= maxAttempts;

  await logSubmissionEvent({
    workflowId,
    runId: enrollmentRunId,
    action: 'SUBMISSION_ATTEMPT_FAILED',
    data: {
      attemptNumber,
      maxAttempts,
      errorMessage,
      errorCode: errorCode ?? null,
      willRetry: !isTerminal,
      preScreenshotKey: preScreenshotKey ?? null,
      postScreenshotKey: postScreenshotKey ?? null,
    },
  });

  if (isTerminal) {
    await prisma.enrollmentRun.update({
      where: { id: enrollmentRunId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorDetails: { errorMessage, errorCode: errorCode ?? null } as never,
      },
    });

    await logSubmissionEvent({
      workflowId,
      runId: enrollmentRunId,
      action: 'SUBMISSION_DEAD_LETTERED',
      data: {
        finalErrorMessage: errorMessage,
        finalErrorCode: errorCode ?? null,
        attempts: attemptNumber,
      },
    });

    return { status: 'failed', enrollmentRunId };
  }

  // Non-terminal: reset status to QUEUED so the next BullMQ retry passes the
  // idempotency pre-flight check at line 81. Without this, the row stays in
  // SUBMITTING (set when the attempt started) and every retry attempt logs
  // SUBMISSION_SKIPPED_IDEMPOTENT instead of running.
  await prisma.enrollmentRun.update({
    where: { id: enrollmentRunId },
    data: { status: 'QUEUED' },
  });

  // Throw to trigger BullMQ retry
  throw new Error(errorMessage);
}
