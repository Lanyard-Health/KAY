import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { logAgentEvent } from '../../agents/event-logger.js';
import type { AuditAction } from '@prisma/client';

/**
 * Record an EnrollmentRun state transition in the AuditLog.
 *
 * Fire-and-forget: a failure here must never break the fill pipeline
 * itself. We log the error and move on so the runner's own error path
 * can still record the real failure.
 */
export async function logEnrollmentRunTransition(args: {
  runId: string;
  from: string | null;
  to: string;
  userId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { runId, from, to, userId, details } = args;
  try {
    await prisma.auditLog.create({
      data: {
        action: 'update',
        resourceType: 'enrollment_run',
        resourceId: runId,
        userId: userId ?? null,
        changes: { from, to, ...(details ?? {}) } as never,
      },
    });
  } catch (err) {
    logger.error(
      `audit: failed to log EnrollmentRun transition ${runId} ${from}→${to}`,
      err
    );
  }
}

/**
 * Submission events — all 8 SUBMISSION_* AuditAction values. Writes to BOTH
 * audit_logs (queryable, SOC 2 surface) AND agent_events (hash-chained,
 * integrity layer). Per plan: "Both or neither." If the agent_events write
 * fails, the audit_logs row is best-effort kept — the alternative (skipping
 * audit_logs to maintain symmetry) loses queryable evidence. We log the
 * divergence loudly so SOC 2 reconciliation can flag it.
 *
 * workflowId is required: agent_events lives in a per-workflow hash chain
 * with no anchor outside it. Callers must resolve the AgentWorkflow for the
 * enrollment before invoking this — see logSubmissionEventFromRun() helper
 * below for the typical case.
 */
export type SubmissionAuditAction = Extract<AuditAction, `SUBMISSION_${string}`>;

export async function logSubmissionEvent(args: {
  workflowId: string;
  taskId?: string | null;
  runId: string;
  action: SubmissionAuditAction;
  userId?: string | null;
  data: Record<string, unknown>;
}): Promise<void> {
  const { workflowId, taskId, runId, action, userId, data } = args;

  // SOC 2: NEVER log credential values. The submission engine never passes
  // credentials into the `data` arg by design — credentials live behind
  // credential.service.ts and are wiped after each adapter run. This is a
  // belt-and-suspenders guard for accidental future drift: refuse to write
  // any payload key that smells like a secret.
  for (const key of Object.keys(data)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('password') ||
      lower.includes('secret') ||
      lower.includes('credential') ||
      lower.includes('token') ||
      lower.includes('mfa')
    ) {
      throw new Error(
        `logSubmissionEvent: refusing to write key "${key}" — looks like a credential field`
      );
    }
  }

  let auditWritten = false;
  let eventWritten = false;

  try {
    await prisma.auditLog.create({
      data: {
        action,
        resourceType: 'enrollment_run',
        resourceId: runId,
        userId: userId ?? null,
        changes: { ...data } as never,
      },
    });
    auditWritten = true;
  } catch (err) {
    logger.error(`audit_logs write failed for submission event`, {
      runId,
      action,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  try {
    await logAgentEvent({
      workflowId,
      taskId: taskId ?? undefined,
      agent: 'submission',
      action,
      data: { runId, ...data } as never,
    });
    eventWritten = true;
  } catch (err) {
    logger.error(`agent_events write failed for submission event`, {
      runId,
      action,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  if (auditWritten !== eventWritten) {
    // Divergence: one wrote, the other didn't. SOC 2 audit must reconcile.
    logger.error(
      `audit divergence: audit_logs=${auditWritten} agent_events=${eventWritten} for ${action} run=${runId} workflow=${workflowId}`
    );
  }
}
