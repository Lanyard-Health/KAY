/**
 * Enrollment Creation Hook
 *
 * Integrates workflow hydration into the enrollment creation flow.
 *
 * Post Phase-6 cleanup: only Path A (DB-backed WorkflowTemplate rows) exists.
 * The legacy Path B (JSON hydration keyed by Payer.workflowKey) was retired
 * after all 5 payers (Aetna, Cigna/Evernorth, UHC, Optum, Humana) had per-payer
 * seeds creating DB-backed WorkflowTemplates.
 *
 * Flow:
 *   1. If the enrollment lacks payerTrackId, resolve it from payer name +
 *      provider type (the pre-Path-A resolver, retained from Phase 1).
 *   2. Once payerTrackId is set, call instantiateWorkflow() which looks up
 *      the matching WorkflowTemplate and creates EnrollmentWorkflowStep rows.
 */

import { PrismaClient, Enrollment, WorkflowType, ProviderType } from '@prisma/client';
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
  payer?: { name: string };
  provider?: { providerType: ProviderType } | null; // null for practice enrollments
}

interface WorkflowResult {
  stepsCreated: number;
  templateFound: boolean;
  workflowType: WorkflowType | null;
}

export async function onEnrollmentCreated(
  prisma: PrismaClient,
  enrollment: EnrollmentWithRelations,
  explicitWorkflowType?: WorkflowType | null
): Promise<WorkflowResult> {
  // ─── Pre-Path-A: resolve payerTrackId from payer name + workflow type ───
  // Enrollments created without an explicit payerTrackId (e.g. via the payer-name
  // autocomplete flow at routes/enrollment.routes.ts) won't trigger Path A on their own.
  // Resolve the right PayerTrack here from payer name + provider type so Path A can fire.
  // Skipped if payerTrackId is already set or required context is unavailable.
  if (!enrollment.payerTrackId) {
    let payerName: string | null = enrollment.payer?.name ?? null;
    let providerType: ProviderType | undefined = enrollment.provider?.providerType;

    if (!payerName || !providerType) {
      const [payerRow, providerRow] = await Promise.all([
        payerName == null
          ? prisma.payer.findUnique({
              where: { id: enrollment.payerId },
              select: { name: true },
            })
          : Promise.resolve(null),
        providerType == null && enrollment.providerId
          ? prisma.providerProfile.findUnique({
              where: { id: enrollment.providerId },
              select: { providerType: true },
            })
          : Promise.resolve(null),
      ]);
      if (payerRow) {
        payerName = payerRow.name;
      }
      if (providerRow) {
        providerType = providerRow.providerType;
      }
    }

    if (payerName && providerType) {
      const workflowType = resolveWorkflowType(
        providerType,
        payerName,
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

  // ─── Path A: DB-driven templates ───────────
  if (enrollment.payerTrackId) {
    try {
      // Gather context for condition evaluation
      let providerType = enrollment.provider?.providerType;
      if (!providerType && enrollment.providerId) {
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
          workflowType: null,
        };
      }
    } catch (error) {
      logger.error(
        `DB workflow instantiation failed for enrollment ${enrollment.id}`,
        error
      );
    }
  }

  // No template found (or no payerTrackId could be resolved). Caller should
  // surface this to the user — there's no JSON fallback anymore.
  return { stepsCreated: 0, templateFound: false, workflowType: null };
}
