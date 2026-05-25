/**
 * Workflow Step Operations Service
 *
 * Step-level helpers used by the enrollment workflow routes:
 *   - updateStepStatus + dependency unblocking
 *   - getWorkflowProgress (totals + current step)
 *   - getActionTypeConfig (UI metadata; reads action_types from payer-workflows.json)
 *
 * Post Phase-6: this file no longer hydrates workflows from JSON. Workflow
 * template instantiation is now owned by workflow-instantiation.service.ts
 * (Path A, DB-driven). The legacy Path B hydration (hydrateWorkflowSteps,
 * loadWorkflowTemplates payer-block readers, getAvailableWorkflows) and the
 * payer-key → JSON template lookup have all been removed.
 *
 * The file kept its name to minimize churn at import sites, but conceptually
 * this is now "workflow-step-operations" — every function here operates on
 * EnrollmentWorkflowStep rows or surfaces UI metadata. None of them read
 * workflow steps from JSON anymore.
 */

import { PrismaClient, WorkflowStepStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// UI Metadata: action_types config (still sourced from payer-workflows.json)
// ============================================================
//
// The payer-workflows.json file still contains non-payer reference blocks
// (action_types, status_model, required_documents, etc.) that the UI consumes.
// We load lazily and cache forever; the file is read-only at runtime.

interface ActionTypeConfig {
  label: string;
  icon: string;
  color: string;
}

interface WorkflowConfigData {
  action_types?: Record<string, ActionTypeConfig>;
  [key: string]: unknown;
}

let cachedConfigData: WorkflowConfigData | null = null;

function loadWorkflowConfig(): WorkflowConfigData {
  if (cachedConfigData) return cachedConfigData;

  const templatePath = path.resolve(__dirname, '../../config/payer-workflows.json');

  if (!fs.existsSync(templatePath)) {
    // Non-fatal: action_types is UI sugar. Return empty so the route still works.
    cachedConfigData = {};
    return cachedConfigData;
  }

  cachedConfigData = JSON.parse(fs.readFileSync(templatePath, 'utf-8')) as WorkflowConfigData;
  return cachedConfigData;
}

/**
 * Returns the action_types config for the UI to render step icons and colors.
 * Reads from payer-workflows.json. Returns an empty object if the file is
 * missing or the block is absent.
 */
export function getActionTypeConfig(): Record<string, ActionTypeConfig> {
  const data = loadWorkflowConfig();
  return data.action_types ?? {};
}

// ============================================================
// Step Status Management
// ============================================================

/**
 * Updates a workflow step's status and handles dependency unblocking.
 */
export async function updateStepStatus(
  prisma: PrismaClient,
  stepId: string,
  newStatus: WorkflowStepStatus,
  userId?: string,
  notes?: string
): Promise<void> {
  const now = new Date();

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: now,
  };

  if (notes !== undefined) updateData['notes'] = notes;

  if (newStatus === 'in_progress' || newStatus === 'completed') {
    updateData['startedAt'] = now;
  }

  if (newStatus === 'completed') {
    updateData['completedAt'] = now;
    updateData['completedById'] = userId || null;
  }

  const step = await prisma.enrollmentWorkflowStep.update({
    where: { id: stepId },
    data: updateData as any,
  });

  if (newStatus === 'completed') {
    await unblockDependentSteps(prisma, step.enrollmentId, step.templateStepId);
  }
}

/**
 * When a step is completed, find steps that depend on it and check whether
 * ALL their dependencies are now met. Any blocked step whose dependencies are
 * satisfied is moved back to 'not_started'.
 */
async function unblockDependentSteps(
  prisma: PrismaClient,
  enrollmentId: string,
  completedTemplateStepId: string
): Promise<void> {
  const allSteps = await prisma.enrollmentWorkflowStep.findMany({
    where: { enrollmentId },
  });

  const completedStepIds = new Set(
    allSteps
      .filter((s) => s.status === 'completed')
      .map((s) => s.templateStepId)
  );

  completedStepIds.add(completedTemplateStepId);

  const blockedSteps = allSteps.filter(
    (s) =>
      s.status === 'blocked' &&
      s.dependencies.length > 0 &&
      s.dependencies.every((dep) => completedStepIds.has(dep))
  );

  if (blockedSteps.length > 0) {
    await prisma.enrollmentWorkflowStep.updateMany({
      where: {
        id: { in: blockedSteps.map((s) => s.id) },
      },
      data: {
        status: 'not_started',
        updatedAt: new Date(),
      },
    });
  }
}

// ============================================================
// Enrollment Progress Calculation
// ============================================================

export interface WorkflowProgress {
  totalSteps: number;
  completedSteps: number;
  inProgressSteps: number;
  blockedSteps: number;
  skippedSteps: number;
  percentComplete: number;
  estimatedDaysRemaining: number;
  currentStep: {
    id: string;
    name: string;
    owner: string;
    estimatedDays: number;
  } | null;
}

/**
 * Calculates workflow progress summary for an enrollment.
 */
export async function getWorkflowProgress(
  prisma: PrismaClient,
  enrollmentId: string
): Promise<WorkflowProgress | null> {
  const steps = await prisma.enrollmentWorkflowStep.findMany({
    where: { enrollmentId },
    orderBy: { stepOrder: 'asc' },
  });

  if (steps.length === 0) return null;

  const completed = steps.filter((s) => s.status === 'completed');
  const inProgress = steps.filter((s) => s.status === 'in_progress');
  const blocked = steps.filter((s) => s.status === 'blocked');
  const skipped = steps.filter((s) => s.status === 'skipped');

  const currentStep = steps.find(
    (s) => s.status !== 'completed' && s.status !== 'skipped'
  );

  const remainingDays = steps
    .filter((s) => s.status !== 'completed' && s.status !== 'skipped')
    .reduce((sum, s) => sum + s.estimatedDays, 0);

  return {
    totalSteps: steps.length,
    completedSteps: completed.length,
    inProgressSteps: inProgress.length,
    blockedSteps: blocked.length,
    skippedSteps: skipped.length,
    percentComplete: Math.round(
      ((completed.length + skipped.length) / steps.length) * 100
    ),
    estimatedDaysRemaining: remainingDays,
    currentStep: currentStep
      ? {
          id: currentStep.id,
          name: currentStep.name,
          owner: currentStep.owner,
          estimatedDays: currentStep.estimatedDays,
        }
      : null,
  };
}
