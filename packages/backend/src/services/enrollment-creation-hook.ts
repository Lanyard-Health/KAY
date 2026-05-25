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

// PayerTrack.track values used by per-payer workflow seeds (prisma/seeds/payerWorkflows/*.seed.ts).
// Used to map a resolved WorkflowType to the right PayerTrack when the enrollment doesn't
// already have a payerTrackId set explicitly.
const TRACK_NAME_FOR_WORKFLOW: Record<WorkflowType, string> = {
  medical: 'Medical / Primary Care',
  behavioral_health: 'Behavioral Health',
};

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
  // ─── Pre-Path A: resolve payerTrackId from payer name + workflow type ───
  // Enrollments created without an explicit payerTrackId (e.g. via the payer-name
  // autocomplete flow at routes/enrollment.routes.ts) won't trigger Path A on their own.
  // For payers migrated into per-payer DB-backed workflows (aetna.seed.ts, etc.), we
  // resolve the right PayerTrack here from payer name + provider type so Path A can fire.
  // Skipped if payerTrackId is already set or required context is unavailable.
  if (!enrollment.payerTrackId) {
    let payerName: string | null = enrollment.payer?.name ?? null;
    let payerWorkflowKey: string | null = enrollment.payer?.workflowKey ?? null;
    let providerType: ProviderType | undefined = enrollment.provider?.providerType;

    if (!payerName || !providerType) {
      const [payerRow, providerRow] = await Promise.all([
        payerName == null
          ? prisma.payer.findUnique({
              where: { id: enrollment.payerId },
              select: { name: true, workflowKey: true },
            })
          : Promise.resolve(null),
        providerType == null
          ? prisma.providerProfile.findUnique({
              where: { id: enrollment.providerId },
              select: { providerType: true },
            })
          : Promise.resolve(null),
      ]);
      if (payerRow) {
        payerName = payerRow.name;
        payerWorkflowKey = payerRow.workflowKey;
      }
      if (providerRow) {
        providerType = providerRow.providerType;
      }
    }

    if (payerName && providerType) {
      const workflowType = resolveWorkflowType(
        providerType,
        payerWorkflowKey ?? '',
        explicitWorkflowType
      );
      const targetTrack = TRACK_NAME_FOR_WORKFLOW[workflowType];
      const matchingTrack = await prisma.payerTrack.findFirst({
        where: {
          payerName: { equals: payerName, mode: 'insensitive' },
          track: targetTrack,
          isActive: true,
        },
        select: { id: true },
      });
      if (matchingTrack) {
        await prisma.enrollment.update({
          where: { id: enrollment.id },
          data: { payerTrackId: matchingTrack.id },
        });
        enrollment.payerTrackId = matchingTrack.id;
        logger.info(
          `Enrollment ${enrollment.id}: resolved payerTrackId=${matchingTrack.id} from payer "${payerName}" + workflow type "${workflowType}"`
        );
      }
    }
  }

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
