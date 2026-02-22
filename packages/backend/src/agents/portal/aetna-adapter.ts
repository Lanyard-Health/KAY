import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { checkAetnaReadiness } from '../../services/aetna/readiness.service.js';
import { startAetnaEnrollment } from '../../services/aetna/enrollment.service.js';
import type {
  PayerAdapter,
  SubmissionInput,
  ReadinessCheck,
  PayerAdapterResult,
} from './payer-adapter.js';

export class AetnaPortalAdapter implements PayerAdapter {
  readonly adapterType = 'aetna';

  async checkReadiness(input: SubmissionInput): Promise<ReadinessCheck> {
    try {
      const result = await checkAetnaReadiness(input.providerId);

      const missingFields = result.pages
        .flatMap((p) => p.missing.map((m) => m.field));
      const warnings = result.pages
        .filter((p) => !p.ready)
        .map((p) => `Page ${p.page} (${p.title}): ${p.missing.map((m) => m.label).join(', ')}`);

      return {
        ready: result.ready,
        missingFields,
        warnings,
      };
    } catch (err) {
      return {
        ready: false,
        missingFields: [],
        warnings: [err instanceof Error ? err.message : 'Readiness check failed'],
      };
    }
  }

  async submit(input: SubmissionInput): Promise<PayerAdapterResult> {
    const { workflowId, taskId, providerId, enrollmentId } = input;

    if (!enrollmentId) {
      return { success: false, error: 'enrollmentId is required for Aetna submissions' };
    }

    // Look up the enrollment to confirm it exists
    const enrollment = await prisma.payerEnrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true, providerId: true },
    });

    if (!enrollment) {
      return { success: false, error: 'Enrollment not found' };
    }

    if (enrollment.providerId !== providerId) {
      return { success: false, error: 'Enrollment does not belong to this provider' };
    }

    // Find the user who requested the workflow (for submitter info)
    const workflow = await prisma.agentWorkflow.findUnique({
      where: { id: workflowId },
      select: { requestedBy: true },
    });

    const userId = workflow?.requestedBy ?? '';

    if (!userId) {
      return { success: false, error: 'Could not determine requesting user for the workflow' };
    }

    // Create AetnaEnrollmentRun record
    const run = await prisma.aetnaEnrollmentRun.create({
      data: {
        payerEnrollmentId: enrollmentId,
        status: 'pending',
        initiatedById: userId,
        formPayload: {},
      },
    });

    logger.info('Aetna adapter: starting form fill via orchestrator', {
      runId: run.id,
      workflowId,
      taskId,
      enrollmentId,
    });

    // Fire-and-forget the form fill — it will update the run record
    // and the browser will be held for human review
    startAetnaEnrollment(enrollmentId, run.id, userId).catch((err) => {
      logger.error('Aetna adapter: form fill failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Return needs_approval — the form is being filled and will need human review
    return {
      success: true,
      submissionId: run.id,
      details: {
        status: 'awaiting_review',
        message: 'Aetna form is being filled. Browser will be held for human review before final submission.',
      },
    };
  }
}
