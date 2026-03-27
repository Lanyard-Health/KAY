/**
 * Workflow Instantiation Service
 *
 * DB-driven workflow template system. When an enrollment is created with a
 * payerTrackId, this service finds the active WorkflowTemplate, evaluates
 * conditions, and clones steps into EnrollmentWorkflowStep records.
 */

import { PrismaClient, WorkflowStepStatus } from '@prisma/client';
import { logger } from '../utils/logger.js';

// ─── Types ─────────────────────────────────────────────────

interface InstantiationContext {
  /** The state the provider is enrolling in (from PayerTrack.stateRegion or enrollment context) */
  state?: string;
  /** The provider's type (e.g., 'psychiatrist', 'lcsw') */
  providerType?: string;
  /** Whether the provider has a DEA registration */
  hasDea?: boolean;
  /** Whether the provider has hospital privileges */
  hasHospitalPrivileges?: boolean;
}

interface InstantiationResult {
  stepsCreated: number;
  templateFound: boolean;
  templateId: string | null;
  templateName: string | null;
  conditionsApplied: number;
}

// ─── Step Type → Action Type Mapping ───────────────────────

// WorkflowTemplateStep.stepType → EnrollmentWorkflowStep.actionType
// The new template system uses descriptive step types; we map them
// to the existing actionType enum for backward compatibility.
const STEP_TYPE_TO_ACTION_TYPE: Record<string, string> = {
  readiness_check: 'verification',
  caqh_authorization: 'caqh_update',
  populate_template: 'form_submission',
  human_review: 'document_review',
  submit_application: 'form_submission',
  confirm_submission: 'confirmation',
  follow_up: 'follow_up',
  escalate: 'payer_outreach',
  await_decision: 'payer_review',
  record_outcome: 'confirmation',
};

function mapStepTypeToActionType(stepType: string): string {
  return STEP_TYPE_TO_ACTION_TYPE[stepType] || 'form_submission';
}

// ─── Core Logic ────────────────────────────────────────────

/**
 * Find the active WorkflowTemplate for a PayerTrack and instantiate it
 * as EnrollmentWorkflowStep records on the given enrollment.
 *
 * Returns early with templateFound=false if no active template exists.
 */
export async function instantiateWorkflow(
  prisma: PrismaClient,
  enrollmentId: string,
  payerTrackId: string,
  context: InstantiationContext = {}
): Promise<InstantiationResult> {
  // 1. Find the active template for this PayerTrack
  const template = await prisma.workflowTemplate.findFirst({
    where: {
      payerTrackId,
      status: 'active',
    },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
      conditions: true,
    },
    orderBy: { version: 'desc' }, // highest version first
  });

  if (!template) {
    logger.info(`No active WorkflowTemplate found for PayerTrack ${payerTrackId}`);
    return {
      stepsCreated: 0,
      templateFound: false,
      templateId: null,
      templateName: null,
      conditionsApplied: 0,
    };
  }

  // 2. Start with the base steps
  let steps = [...template.steps];
  let conditionsApplied = 0;

  // 3. Evaluate conditions and modify steps
  for (const condition of template.conditions) {
    if (!evaluateCondition(condition, context)) continue;
    conditionsApplied++;

    switch (condition.action) {
      case 'add_step': {
        // Insert a new step at the target order position
        if (condition.stepDefinition && condition.targetStepOrder != null) {
          const newStep = {
            id: `condition-${condition.id}`,
            templateId: template.id,
            stepOrder: condition.targetStepOrder,
            name: (condition.stepDefinition as any).name || `Conditional step (${condition.conditionType}=${condition.conditionValue})`,
            description: (condition.stepDefinition as any).description || null,
            stepType: (condition.stepDefinition as any).stepType || 'human_review',
            owner: (condition.stepDefinition as any).owner || 'credentialing_staff',
            requiredDocuments: (condition.stepDefinition as any).requiredDocuments || [],
            triggerDaysAfterPrev: (condition.stepDefinition as any).triggerDaysAfterPrev ?? null,
            isBlocking: (condition.stepDefinition as any).isBlocking ?? true,
            reviewerInstructions: (condition.stepDefinition as any).reviewerInstructions || null,
            createdAt: new Date(),
          };
          steps.push(newStep as any);
        }
        break;
      }
      case 'skip_step': {
        // Remove the step at the target order
        if (condition.targetStepOrder != null) {
          steps = steps.filter(s => s.stepOrder !== condition.targetStepOrder);
        }
        break;
      }
      case 'modify_step': {
        // Modify fields on an existing step
        if (condition.targetStepOrder != null && condition.stepDefinition) {
          steps = steps.map(s => {
            if (s.stepOrder !== condition.targetStepOrder) return s;
            return { ...s, ...(condition.stepDefinition as any) };
          });
        }
        break;
      }
    }
  }

  // 4. Re-sort and re-number steps after condition modifications
  steps.sort((a, b) => a.stepOrder - b.stepOrder);

  // 5. Create EnrollmentWorkflowStep records
  const now = new Date();
  const stepData = steps.map((step, index) => {
    const estimatedDays = step.triggerDaysAfterPrev ?? 0;

    // Calculate due date based on cumulative trigger days
    let dueDate: Date | null = null;
    if (estimatedDays > 0) {
      dueDate = new Date(now);
      // Sum all previous steps' trigger days for cumulative offset
      let cumulativeDays = 0;
      for (let i = 0; i <= index; i++) {
        cumulativeDays += steps[i]!.triggerDaysAfterPrev ?? 0;
      }
      dueDate.setDate(dueDate.getDate() + cumulativeDays);
    }

    return {
      enrollmentId,
      templateStepId: step.id,
      stepOrder: index + 1,
      name: step.name,
      description: step.description || '',
      actionType: mapStepTypeToActionType(step.stepType) as any,
      owner: step.owner as any,
      estimatedDays,
      dueDate,
      dependencies: [] as string[],
      documentsNeeded: step.requiredDocuments || [],
      warnings: [] as string[],
      status: 'not_started' as WorkflowStepStatus,
      updatedAt: now,
    };
  });

  if (stepData.length === 0) {
    return {
      stepsCreated: 0,
      templateFound: true,
      templateId: template.id,
      templateName: template.name,
      conditionsApplied,
    };
  }

  const result = await prisma.enrollmentWorkflowStep.createMany({
    data: stepData,
  });

  // 6. Update enrollment with the template reference
  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { workflowTemplateId: template.id },
  });

  logger.info(
    `Instantiated ${result.count} workflow steps from template "${template.name}" (v${template.version}) ` +
    `for enrollment ${enrollmentId}. Conditions applied: ${conditionsApplied}`
  );

  return {
    stepsCreated: result.count,
    templateFound: true,
    templateId: template.id,
    templateName: template.name,
    conditionsApplied,
  };
}

// ─── Condition Evaluation ──────────────────────────────────

function evaluateCondition(
  condition: { conditionType: string; conditionValue: string },
  context: InstantiationContext
): boolean {
  switch (condition.conditionType) {
    case 'state':
      return context.state?.toLowerCase() === condition.conditionValue.toLowerCase();
    case 'provider_type':
      return context.providerType?.toLowerCase() === condition.conditionValue.toLowerCase();
    case 'has_dea':
      return context.hasDea === (condition.conditionValue.toLowerCase() === 'true');
    case 'has_hospital_privileges':
      return context.hasHospitalPrivileges === (condition.conditionValue.toLowerCase() === 'true');
    default:
      logger.warn(`Unknown condition type: ${condition.conditionType}`);
      return false;
  }
}
