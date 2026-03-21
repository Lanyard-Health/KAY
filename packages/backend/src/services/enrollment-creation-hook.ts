/**
 * Enrollment Creation Hook
 *
 * Integrates workflow hydration into the existing enrollment creation flow.
 */

import { PrismaClient, Enrollment, WorkflowType, ProviderType } from '@prisma/client';
import { hydrateWorkflowSteps } from './workflow-hydration.service.js';
import { resolveWorkflowType } from '../config/workflow-mapping.js';
import { instantiateWorkflow } from './workflow-instantiation.service.js';
import { logger } from '../utils/logger.js';

interface EnrollmentWithRelations extends Enrollment {
  payer?: { workflowKey: string | null; name: string };
  provider?: { providerType: ProviderType };
}

interface WorkflowResult {
  stepsCreated: number;
  templateFound: boolean;
  workflowType: WorkflowType | null;
}

/**
 * Call this after creating a new PayerEnrollment.
 * It will:
 * 1. Look up the payer's workflow_key
 * 2. Resolve the correct workflow type
 * 3. Hydrate workflow steps from the template
 * 4. Update the enrollment with the workflow type
 */
export async function onEnrollmentCreated(
  prisma: PrismaClient,
  enrollment: EnrollmentWithRelations,
  explicitWorkflowType?: WorkflowType | null
): Promise<WorkflowResult> {
  // ─── Path A: DB-driven templates (new system) ───────────
  if (enrollment.payerTrackId) {
    try {
      // Gather context for condition evaluation
      let providerType = enrollment.provider?.providerType;
      if (!providerType) {
        const provider = await prisma.providerProfile.findUnique({
          where: { id: enrollment.providerId },
          select: { providerType: true },
        });
        providerType = provider?.providerType ?? undefined;
      }

      // Get the PayerTrack's stateRegion for condition evaluation
      const payerTrack = await prisma.payerTrack.findUnique({
        where: { id: enrollment.payerTrackId },
        select: { stateRegion: true },
      });

      const result = await instantiateWorkflow(
        prisma,
        enrollment.id,
        enrollment.payerTrackId,
        {
          state: payerTrack?.stateRegion ?? undefined,
          providerType: providerType ?? undefined,
        }
      );

      if (result.templateFound) {
        logger.info(
          `Enrollment ${enrollment.id}: instantiated from DB template "${result.templateName}"`
        );
        return {
          stepsCreated: result.stepsCreated,
          templateFound: true,
          workflowType: null, // DB templates don't use the old workflow type enum
        };
      }
    } catch (error) {
      logger.error(`DB workflow instantiation failed for enrollment ${enrollment.id}, falling back to JSON`, error);
    }

    // If no DB template found for this PayerTrack, fall through to JSON path
  }

  // ─── Path B: JSON-based hydration (legacy system) ───────
  let payerWorkflowKey = enrollment.payer?.workflowKey;
  let providerType = enrollment.provider?.providerType;

  if (payerWorkflowKey === undefined || providerType === undefined) {
    const fullEnrollment = await prisma.enrollment.findUnique({
      where: { id: enrollment.id },
      include: {
        payer: { select: { workflowKey: true, name: true } },
        provider: { select: { providerType: true } },
      },
    });

    if (!fullEnrollment) {
      return { stepsCreated: 0, templateFound: false, workflowType: null };
    }

    payerWorkflowKey = fullEnrollment.payer.workflowKey;
    providerType = fullEnrollment.provider.providerType;
  }

  if (!payerWorkflowKey) {
    return { stepsCreated: 0, templateFound: false, workflowType: null };
  }

  const workflowType = resolveWorkflowType(
    providerType!,
    payerWorkflowKey,
    explicitWorkflowType
  );

  const result = await hydrateWorkflowSteps(
    prisma,
    enrollment.id,
    payerWorkflowKey,
    workflowType
  );

  if (result.templateFound) {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { workflowType },
    });
  }

  return {
    ...result,
    workflowType: result.templateFound ? workflowType : null,
  };
}
