import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';

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
