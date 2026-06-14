import type { Enrollment, EnrollmentStatus } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { NotFoundError, ValidationError } from '../middleware/error.middleware.js';
import { triggerDenialTriage } from './denial-triage.service.js';
import { triggerTerminationWorkflow } from './terminationWorkflow.service.js';
import { instantiateFollowUp } from './followup-instantiation.service.js';
import { recordEnrollmentOutcome } from './enrollment-outcome.service.js';
import { invalidateCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { emitWebhookEvent } from '../agents/webhook-emitter.js';

/**
 * Forward-only progression for the main enrollment track.
 * denied/terminated are reachable from any non-terminal state.
 */
const STATUS_RANK: Record<EnrollmentStatus, number> = {
  not_started: 0,
  in_progress: 1,
  submitted: 2,
  pending_review: 3,
  approved: 4,
  denied: 5,
  terminated: 6,
};

const TERMINAL_STATUSES = new Set<EnrollmentStatus>(['denied', 'terminated']);

function validateStatusTransition(current: EnrollmentStatus, next: EnrollmentStatus): void {
  if (current === next) return;

  if (TERMINAL_STATUSES.has(current)) {
    throw new ValidationError(`Cannot transition from terminal status '${current}'`);
  }

  // Any non-terminal state can move to denied or terminated
  if (next === 'denied' || next === 'terminated') return;

  // Otherwise must move forward
  if (STATUS_RANK[next] <= STATUS_RANK[current]) {
    throw new ValidationError(`Cannot transition from '${current}' to '${next}'`);
  }
}

export async function updateEnrollmentStatus(
  enrollmentId: string,
  newStatus: EnrollmentStatus,
  updatedById: string,
  options?: {
    notes?: string;
    triggerDenialTriage?: boolean;
  },
): Promise<Enrollment> {
  const existing = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { payer: true },
  });

  if (!existing) {
    throw new NotFoundError('Enrollment');
  }

  const oldStatus = existing.status;
  validateStatusTransition(oldStatus, newStatus);

  // Update status + optional notes
  const enrollment = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: newStatus,
      ...(options?.notes !== undefined && { notes: options.notes }),
      updatedById,
    },
    include: { payer: true },
  });

  // --- Side effects (fire-and-forget) ---

  // Outcome recorder (the moat). Idempotent on (enrollment, outcome); demo/seed
  // tenants are excluded inside the recorder; never throws.
  if (oldStatus !== newStatus) {
    void recordEnrollmentOutcome({ enrollmentId, status: newStatus, transitionAt: new Date() });
  }

  // Denial triage
  if (newStatus === 'denied' && oldStatus !== 'denied' && options?.triggerDenialTriage) {
    triggerDenialTriage(prisma, {
      enrollmentId,
      denialReason: options.notes || 'No denial reason provided',
      denialDate: new Date(),
    })
      .then((result) => {
        if (result.triageCreated) {
          logger.info(`Denial triage created for enrollment ${enrollmentId}: ${result.triageId}`);
        }
      })
      .catch((err) => logger.error(`Denial triage failed for enrollment ${enrollmentId}:`, err));
  }

  // Termination workflow
  if (newStatus === 'terminated' && oldStatus !== 'terminated') {
    triggerTerminationWorkflow(existing.providerId, enrollmentId)
      .catch((err) => logger.error('Termination workflow trigger failed:', err));
  }

  // Follow-up instantiation on submitted
  if (newStatus === 'submitted' && oldStatus !== 'submitted' && existing.payerTrackId) {
    instantiateFollowUp(prisma, enrollmentId, existing.payerTrackId)
      .then((result) => {
        if (result.runCreated) {
          logger.info(`Follow-up run created for enrollment ${enrollmentId}: ${result.runId}`);
        }
      })
      .catch((err) => logger.error(`Follow-up instantiation failed for enrollment ${enrollmentId}:`, err));
  }

  // Sync workflow steps: skip incomplete steps when enrollment reaches a terminal state
  if (TERMINAL_STATUSES.has(newStatus) && !TERMINAL_STATUSES.has(oldStatus)) {
    prisma.enrollmentWorkflowStep.updateMany({
      where: {
        enrollmentId,
        status: { in: ['not_started', 'in_progress', 'blocked'] },
      },
      data: {
        status: 'skipped',
        skippedReason: `Enrollment ${newStatus}`,
      },
    }).catch((err) => logger.error(`Workflow step sync failed for enrollment ${enrollmentId}:`, err));
  }

  // Audit log
  prisma.auditLog.create({
    data: {
      userId: updatedById,
      action: 'update',
      resourceType: 'enrollment',
      resourceId: enrollmentId,
      changes: { field: 'status', from: oldStatus, to: newStatus },
    },
  }).catch((err) => logger.error('Failed to create audit log for enrollment status change:', err));

  invalidateCache('dashboard');
  invalidateCache('payer-analytics');

  // Webhook fanout — enrollment.status_changed. Fire-and-forget via
  // emitWebhookEvent (never throws). Practice scope is resolved from the
  // provider via the standard provider → practice link; if the provider
  // has no practice (rare for this code path but possible mid-onboarding),
  // emit becomes a no-op.
  if (oldStatus !== newStatus) {
    void fanoutEnrollmentStatusChanged(enrollmentId, existing.providerId, oldStatus, newStatus)
      .catch((err) => {
        logger.warn('Webhook fanout for enrollment.status_changed failed', {
          error: err instanceof Error ? err.message : String(err),
          enrollmentId,
        });
      });
  }

  return enrollment;
}

async function fanoutEnrollmentStatusChanged(
  enrollmentId: string,
  providerId: string,
  oldStatus: EnrollmentStatus,
  newStatus: EnrollmentStatus,
): Promise<void> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { practiceId: true },
  });
  const practiceId = provider?.practiceId ?? null;
  if (!practiceId) return;

  await emitWebhookEvent({
    eventType: 'enrollment.status_changed',
    practiceId,
    eventId: enrollmentId,
    payload: { enrollmentId, providerId, oldStatus, newStatus },
  });
}
