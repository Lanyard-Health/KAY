/**
 * Enrollment Creation Hook
 *
 * Integrates workflow hydration into the existing enrollment creation flow.
 */

import { PrismaClient, Enrollment, WorkflowType, ProviderType } from '@prisma/client';
import { hydrateWorkflowSteps } from './workflow-hydration.service.js';
import { resolveWorkflowType } from '../config/workflow-mapping.js';

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
