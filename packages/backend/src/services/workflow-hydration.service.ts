/**
 * Workflow Hydration Service
 *
 * When a payer enrollment is created and the payer has a workflow template,
 * this service reads the template JSON and creates per-enrollment
 * EnrollmentWorkflowStep records.
 */

import { PrismaClient, WorkflowType, WorkflowStepStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Types matching the payer-workflows.json structure
// ============================================================

interface WorkflowTemplateStep {
  id: string;
  name: string;
  description: string;
  action_type: string;
  url?: string;
  owner: string;
  estimated_days: number | { min: number; max: number };
  dependencies: string[];
  documents_needed: string[];
  warnings: string[];
}

interface WorkflowTemplate {
  label: string;
  estimated_timeline: {
    official_days: { min: number; max: number; unit: string };
    real_world_days: { min: number; max: number; unit: string };
  };
  steps: WorkflowTemplateStep[];
}

interface PayerTemplate {
  id: string;
  name: string;
  parent_company: string;
  workflows: Record<string, WorkflowTemplate>;
}

interface WorkflowData {
  schema_version: string;
  payers: Record<string, PayerTemplate>;
  action_types: Record<string, { label: string; icon: string; color: string }>;
  status_model: Record<string, unknown>;
}

// ============================================================
// Template Loader (cached in memory)
// ============================================================

let cachedWorkflowData: WorkflowData | null = null;

/**
 * Loads the payer-workflows.json template file.
 * Cached after first load.
 */
export function loadWorkflowTemplates(): WorkflowData {
  if (cachedWorkflowData) return cachedWorkflowData;

  const templatePath = path.resolve(
    __dirname,
    '../../config/payer-workflows.json'
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Workflow template file not found at ${templatePath}. ` +
      `Copy payer-workflows.json to your config directory.`
    );
  }

  cachedWorkflowData = JSON.parse(
    fs.readFileSync(templatePath, 'utf-8')
  ) as WorkflowData;

  return cachedWorkflowData;
}

/**
 * Reloads the template from disk (useful for development/hot-reload).
 */
export function reloadWorkflowTemplates(): WorkflowData {
  cachedWorkflowData = null;
  return loadWorkflowTemplates();
}

// ============================================================
// Map JSON action_type strings to Prisma enum values
// ============================================================

const ACTION_TYPE_MAP: Record<string, string> = {
  form_submission: 'form_submission',
  phone_call: 'phone_call',
  caqh_update: 'caqh_update',
  portal_registration: 'portal_registration',
  document_upload: 'document_upload',
  waiting_period: 'waiting_period',
  follow_up: 'follow_up',
  verification: 'verification',
  payer_review: 'payer_review',
  payer_outreach: 'payer_outreach',
  payer_internal: 'payer_internal',
  committee_review: 'committee_review',
  contract_execution: 'contract_execution',
  contract_delivery: 'contract_delivery',
  document_review: 'document_review',
  site_visit: 'site_visit',
  system_processing: 'system_processing',
  routing_decision: 'routing_decision',
  confirmation: 'confirmation',
  account_creation: 'account_creation',
};

const OWNER_MAP: Record<string, string> = {
  provider: 'provider',
  credentialing_staff: 'credentialing_staff',
  payer: 'payer',
  cvo: 'cvo',
  staff: 'credentialing_staff',
  admin: 'credentialing_staff',
};

function mapActionType(jsonType: string): string {
  return ACTION_TYPE_MAP[jsonType] || 'form_submission';
}

function mapOwner(jsonOwner: string): string {
  return OWNER_MAP[jsonOwner] || 'credentialing_staff';
}

// ============================================================
// Core Hydration Logic
// ============================================================

export interface HydrateOptions {
  /** Override step statuses (e.g., mark prerequisites as completed) */
  preCompletedStepIds?: string[];
  /** User ID to record as the creator */
  createdById?: string;
}

/**
 * Creates EnrollmentWorkflowStep records for an enrollment
 * based on the payer's workflow template.
 */
export async function hydrateWorkflowSteps(
  prisma: PrismaClient,
  enrollmentId: string,
  payerWorkflowKey: string | null,
  workflowType: WorkflowType,
  options: HydrateOptions = {}
): Promise<{ stepsCreated: number; templateFound: boolean }> {
  if (!payerWorkflowKey) {
    return { stepsCreated: 0, templateFound: false };
  }

  const data = loadWorkflowTemplates();
  const payerTemplate = data.payers[payerWorkflowKey];

  if (!payerTemplate) {
    logger.warn(
      `No workflow template found for payer key "${payerWorkflowKey}". ` +
      `Available keys: ${Object.keys(data.payers).join(', ')}`
    );
    return { stepsCreated: 0, templateFound: false };
  }

  const workflow = payerTemplate.workflows[workflowType];

  if (!workflow) {
    const fallbackType = workflowType === 'behavioral_health' ? 'medical' : 'behavioral_health';
    const fallbackWorkflow = payerTemplate.workflows[fallbackType];

    if (!fallbackWorkflow) {
      logger.warn(
        `No "${workflowType}" or fallback workflow found for payer "${payerWorkflowKey}". ` +
        `Available: ${Object.keys(payerTemplate.workflows).join(', ')}`
      );
      return { stepsCreated: 0, templateFound: false };
    }

    logger.info(
      `Using "${fallbackType}" workflow as fallback for "${payerWorkflowKey}" ` +
      `(requested "${workflowType}" not available)`
    );

    return createStepsFromTemplate(
      prisma,
      enrollmentId,
      fallbackWorkflow,
      options
    );
  }

  return createStepsFromTemplate(prisma, enrollmentId, workflow, options);
}

/**
 * Creates step records from a workflow template.
 */
async function createStepsFromTemplate(
  prisma: PrismaClient,
  enrollmentId: string,
  workflow: WorkflowTemplate,
  options: HydrateOptions
): Promise<{ stepsCreated: number; templateFound: boolean }> {
  const { preCompletedStepIds = [] } = options;
  const now = new Date();

  // Collect all step IDs in this workflow to filter out external dependencies
  const workflowStepIds = new Set(workflow.steps.map((s) => s.id));

  const stepData = workflow.steps.map((step, index) => {
    const isPreCompleted = preCompletedStepIds.includes(step.id);

    // Normalize estimated_days: convert {min, max} objects to single number (use max)
    const estimatedDays =
      typeof step.estimated_days === 'number'
        ? step.estimated_days
        : step.estimated_days?.max ?? 0;

    // Filter dependencies to only include steps within this workflow
    const localDeps = (step.dependencies || []).filter((dep) =>
      workflowStepIds.has(dep)
    );

    return {
      enrollmentId,
      templateStepId: step.id,
      stepOrder: index + 1,
      name: step.name,
      description: step.description,
      actionType: mapActionType(step.action_type) as any,
      url: step.url || null,
      owner: mapOwner(step.owner) as any,
      estimatedDays,
      dependencies: localDeps,
      documentsNeeded: step.documents_needed || [],
      warnings: step.warnings || [],
      status: isPreCompleted
        ? ('completed' as WorkflowStepStatus)
        : ('not_started' as WorkflowStepStatus),
      completedAt: isPreCompleted ? now : null,
      updatedAt: now,
    };
  });

  const result = await prisma.enrollmentWorkflowStep.createMany({
    data: stepData,
  });

  return { stepsCreated: result.count, templateFound: true };
}

// ============================================================
// Step Status Management
// ============================================================

/**
 * Updates a workflow step's status and handles dependency logic.
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
 * When a step is completed, find steps that depend on it
 * and check if ALL their dependencies are now met.
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

// ============================================================
// Template Introspection (for UI)
// ============================================================

/**
 * Returns available workflow templates for a given payer.
 */
export function getAvailableWorkflows(
  payerWorkflowKey: string
): { type: string; label: string; stepCount: number; timeline: any }[] | null {
  const data = loadWorkflowTemplates();
  const payer = data.payers[payerWorkflowKey];
  if (!payer) return null;

  return Object.entries(payer.workflows).map(([type, wf]) => ({
    type,
    label: wf.label,
    stepCount: wf.steps.length,
    timeline: wf.estimated_timeline,
  }));
}

/**
 * Returns the full action_types config for the UI to render icons/colors.
 */
export function getActionTypeConfig(): Record<string, { label: string; icon: string; color: string }> {
  const data = loadWorkflowTemplates();
  return data.action_types;
}
