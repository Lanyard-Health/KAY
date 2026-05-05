import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';
import { logAgentEvent } from '../event-logger.js';
import { runPdfFill } from '../../services/form-fill/pdf-fill-runner.js';
import { searchSimilarWithSources, isConfigured as isEmbeddingConfigured } from '../../services/knowledgeBase.embedding.service.js';

// Signed-URL TTL for filled-PDF download links surfaced via narrate(). 30 min
// is plenty for a demo turn and short enough that links don't leak in logs.
const ARTIFACT_URL_TTL_SECONDS = 30 * 60;
const S3_BUCKET = process.env['S3_BUCKET_NAME'] || 'credentials-documents';

function buildS3Client(): S3Client {
  const s3Endpoint = process.env['S3_ENDPOINT'];
  return new S3Client({
    region: process.env['AWS_REGION'] || 'us-east-1',
    ...(s3Endpoint && { endpoint: s3Endpoint, forcePathStyle: true }),
    ...(process.env['AWS_ACCESS_KEY_ID'] && {
      credentials: {
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
      },
    }),
  });
}

// ==========================================
// Types
// ==========================================

export interface ToolContext {
  workflowId: string;
}

/** Maps dispatch_task type → agent type + queue */
const TASK_TYPE_MAP: Record<string, { agentType: string; queue: string }> = {
  parse_document: { agentType: 'document_parser', queue: QUEUE_NAMES.DOCUMENT },
  submit_to_portal: { agentType: 'portal_interaction', queue: QUEUE_NAMES.PORTAL },
  check_readiness: { agentType: 'portal_interaction', queue: QUEUE_NAMES.PORTAL },
  monitor_status: { agentType: 'status_monitor', queue: QUEUE_NAMES.MONITOR },
};

// ==========================================
// Tool functions
// ==========================================

async function getProviderProfile(input: { providerId: string }) {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: input.providerId },
    include: {
      licenses: true,
      boardCertifications: true,
      malpracticeInsurances: true,
      educations: true,
      documents: true,
      addresses: true,
      enrollments: true,
      deaRegistrations: true,
    },
  });

  if (!provider) {
    return { error: `Provider ${input.providerId} not found` };
  }

  return provider;
}

async function getPayerRequirements(input: { payerId: string }) {
  const config = await prisma.payerSubmissionConfig.findUnique({
    where: { payerId: input.payerId },
    include: {
      payer: { select: { id: true, name: true } },
    },
  });

  if (!config) {
    return { error: `No adapter config found for payer ${input.payerId}` };
  }

  return {
    payerId: config.payerId,
    payerName: config.payer.name,
    adapterType: config.adapterType,
    submissionMethod: config.submissionMethod,
    requiredFields: config.requiredFields,
    isActive: config.isActive,
  };
}

async function checkCredentialCompleteness(input: { providerId: string; payerId: string }) {
  // Load provider credentials
  const provider = await prisma.providerProfile.findUnique({
    where: { id: input.providerId },
    include: {
      licenses: true,
      boardCertifications: true,
      malpracticeInsurances: true,
      educations: true,
      deaRegistrations: true,
    },
  });

  if (!provider) {
    return { error: `Provider ${input.providerId} not found` };
  }

  // Load payer required fields (fall back to standard requirements if no adapter config)
  const config = await prisma.payerSubmissionConfig.findUnique({
    where: { payerId: input.payerId },
  });

  const DEFAULT_REQUIRED_FIELDS = [
    'npi',
    'medical_license',
    'board_certification',
    'malpractice_insurance',
    'education',
  ];
  const requiredFields = config
    ? ((config.requiredFields as string[]) ?? DEFAULT_REQUIRED_FIELDS)
    : DEFAULT_REQUIRED_FIELDS;
  const now = new Date();

  const present: string[] = [];
  const missing: string[] = [];
  const expired: string[] = [];

  for (const field of requiredFields) {
    switch (field) {
      case 'npi':
        if (provider.npi) present.push('npi');
        else missing.push('npi');
        break;
      case 'medical_license': {
        const activeLicense = provider.licenses.find(
          (l) => l.status === 'active' && (!l.expirationDate || l.expirationDate > now)
        );
        const expiredLicense = provider.licenses.find(
          (l) => l.expirationDate && l.expirationDate <= now
        );
        if (activeLicense) present.push('medical_license');
        else if (expiredLicense) expired.push('medical_license');
        else missing.push('medical_license');
        break;
      }
      case 'board_certification': {
        const activeCert = provider.boardCertifications.find(
          (c) => c.status === 'active' && (!c.expirationDate || c.expirationDate > now)
        );
        const expiredCert = provider.boardCertifications.find(
          (c) => c.expirationDate && c.expirationDate <= now
        );
        if (activeCert) present.push('board_certification');
        else if (expiredCert) expired.push('board_certification');
        else missing.push('board_certification');
        break;
      }
      case 'malpractice_insurance': {
        const activeIns = provider.malpracticeInsurances.find(
          (m) => m.status === 'active' && (!m.expirationDate || m.expirationDate > now)
        );
        const expiredIns = provider.malpracticeInsurances.find(
          (m) => m.expirationDate && m.expirationDate <= now
        );
        if (activeIns) present.push('malpractice_insurance');
        else if (expiredIns) expired.push('malpractice_insurance');
        else missing.push('malpractice_insurance');
        break;
      }
      case 'dea_registration': {
        const activeDea = provider.deaRegistrations.find(
          (d) => d.status === 'active' && (!d.expirationDate || d.expirationDate > now)
        );
        const expiredDea = provider.deaRegistrations.find(
          (d) => d.expirationDate && d.expirationDate <= now
        );
        if (activeDea) present.push('dea_registration');
        else if (expiredDea) expired.push('dea_registration');
        else missing.push('dea_registration');
        break;
      }
      case 'education':
        if (provider.educations.length > 0) present.push('education');
        else missing.push('education');
        break;
      default:
        // Unknown required field — treat as missing
        missing.push(field);
        break;
    }
  }

  const total = requiredFields.length;
  const score = total > 0 ? Math.round((present.length / total) * 100) : 100;

  return {
    complete: missing.length === 0 && expired.length === 0,
    score,
    total,
    present,
    missing,
    expired,
  };
}

async function dispatchTask(
  input: { type: string; input: Record<string, unknown> },
  ctx: ToolContext
) {
  const mapping = TASK_TYPE_MAP[input.type];
  if (!mapping) {
    return { error: `Unknown task type: ${input.type}. Allowed: ${Object.keys(TASK_TYPE_MAP).join(', ')}` };
  }

  // Count existing tasks to determine step number
  const existingTaskCount = await prisma.agentTask.count({
    where: { workflowId: ctx.workflowId },
  });

  // Create task record
  const task = await prisma.agentTask.create({
    data: {
      workflowId: ctx.workflowId,
      type: input.type,
      agentType: mapping.agentType,
      status: 'queued',
      input: input.input as any,
      stepNumber: existingTaskCount + 1,
      queue: mapping.queue,
      queuedAt: new Date(),
    },
  });

  // Enqueue to correct queue
  const queue = getQueue(mapping.queue as any);
  const job = await queue.add(input.type, {
    workflowId: ctx.workflowId,
    taskId: task.id,
    ...input.input,
  });

  // Update task with BullMQ job ID
  await prisma.agentTask.update({
    where: { id: task.id },
    data: { bullmqJobId: job.id },
  });

  await logAgentEvent({
    workflowId: ctx.workflowId,
    taskId: task.id,
    agent: 'orchestrator',
    action: 'task_dispatched',
    data: { type: input.type, queue: mapping.queue },
  });

  return { taskId: task.id, status: 'queued' };
}

async function requestHumanApproval(
  input: { type: string; context: Record<string, unknown> },
  ctx: ToolContext
) {
  const approval = await prisma.pendingApproval.create({
    data: {
      workflowId: ctx.workflowId,
      taskId: 'orchestrator',
      type: input.type,
      context: input.context as any,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  // Pause workflow until approval
  await prisma.agentWorkflow.update({
    where: { id: ctx.workflowId },
    data: { status: 'waiting_approval' },
  });

  await logAgentEvent({
    workflowId: ctx.workflowId,
    agent: 'orchestrator',
    action: 'approval_requested',
    data: { approvalId: approval.id, type: input.type },
  });

  return { approvalId: approval.id, status: 'pending' };
}

async function getWorkflowState(ctx: ToolContext) {
  const workflow = await prisma.agentWorkflow.findUnique({
    where: { id: ctx.workflowId },
    include: {
      tasks: { orderBy: { stepNumber: 'asc' } },
      approvals: { orderBy: { requestedAt: 'desc' } },
    },
  });

  if (!workflow) {
    return { error: `Workflow ${ctx.workflowId} not found` };
  }

  return {
    id: workflow.id,
    goal: workflow.goal,
    goalParams: workflow.goalParams,
    status: workflow.status,
    plan: workflow.plan,
    tasks: workflow.tasks.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      stepNumber: t.stepNumber,
      output: t.output,
      error: t.error,
    })),
    approvals: workflow.approvals.map((a) => ({
      id: a.id,
      type: a.type,
      status: a.status,
      decidedAt: a.decidedAt,
    })),
  };
}

async function escalateToException(
  input: { issue: string; taskId?: string },
  ctx: ToolContext
) {
  const queue = getQueue(QUEUE_NAMES.EXCEPTION);
  await queue.add('handle_exception', {
    workflowId: ctx.workflowId,
    issue: input.issue,
    taskId: input.taskId,
  });

  await logAgentEvent({
    workflowId: ctx.workflowId,
    taskId: input.taskId,
    agent: 'orchestrator',
    action: 'escalated_to_exception',
    data: { issue: input.issue },
    level: 'error',
  });

  logger.warn('Orchestrator escalated to exception', {
    workflowId: ctx.workflowId,
    issue: input.issue,
  });

  return { status: 'escalated' };
}

// ==========================================
// narrate — live progress messages to the user
// ==========================================

async function narrate(
  input: { message: string; step?: number; downloadUrl?: string },
  ctx: ToolContext
) {
  const message = (input.message ?? '').trim();
  if (!message) {
    return { error: 'narrate requires a non-empty message' };
  }

  await logAgentEvent({
    workflowId: ctx.workflowId,
    agent: 'orchestrator',
    action: 'narration',
    data: {
      message,
      ...(typeof input.step === 'number' ? { step: input.step } : {}),
      ...(input.downloadUrl ? { downloadUrl: input.downloadUrl } : {}),
    },
  });

  return { ok: true };
}

// ==========================================
// populate_enrollment_forms — fill all PDF forms for an enrollment
// ==========================================

interface PopulatedFormSummary {
  payerFormId: string;
  formName: string;
  filledCount: number;
  skippedCount: number;
  missingRequired: string[];
  downloadUrl: string | null;
}

async function populateEnrollmentForms(
  input: { enrollmentId: string },
  _ctx: ToolContext
): Promise<{
  enrollmentRunId: string | null;
  formsFilled: number;
  forms: PopulatedFormSummary[];
} | { error: string }> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: input.enrollmentId },
    select: {
      id: true,
      payerTrackId: true,
      payerTrack: {
        select: {
          id: true,
          forms: {
            where: { deliveryEngine: 'pdf' },
            select: { id: true, formName: true, assetUrl: true },
          },
        },
      },
    },
  });

  if (!enrollment) {
    return { error: `Enrollment ${input.enrollmentId} not found` };
  }

  const forms = enrollment.payerTrack?.forms ?? [];
  const fillable = forms.filter((f) => f.assetUrl);

  if (fillable.length === 0) {
    return {
      error: enrollment.payerTrackId
        ? 'No fillable PDF forms configured for this payer track'
        : 'Enrollment is not linked to a PayerTrack — pick a payer before populating forms',
    };
  }

  // Run each PDF fill; share one EnrollmentRun across all forms (mirrors the
  // form-fill route's behavior so artifacts cluster under one run).
  let enrollmentRunId: string | undefined;
  const summaries: PopulatedFormSummary[] = [];
  const s3 = buildS3Client();

  for (const form of fillable) {
    const result = await runPdfFill({
      enrollmentId: input.enrollmentId,
      payerFormId: form.id,
      ...(enrollmentRunId ? { enrollmentRunId } : {}),
    });
    enrollmentRunId = result.enrollmentRunId;

    let downloadUrl: string | null = null;
    try {
      downloadUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: result.artifact.filledS3Key }),
        { expiresIn: ARTIFACT_URL_TTL_SECONDS }
      );
    } catch (err) {
      logger.warn('Failed to sign filled-PDF URL for narration', {
        payerFormId: form.id,
        filledS3Key: result.artifact.filledS3Key,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    summaries.push({
      payerFormId: form.id,
      formName: form.formName,
      filledCount: result.artifact.filledCount,
      skippedCount: result.artifact.skippedCount,
      missingRequired: result.missingRequired,
      downloadUrl,
    });
  }

  return {
    enrollmentRunId: enrollmentRunId ?? null,
    formsFilled: summaries.length,
    forms: summaries,
  };
}

// ==========================================
// search_knowledge_base — semantic lookup over PayerTrack / Timeline / StateRule / Form / Requirement / RequirementUniversal
// ==========================================

interface KbSearchResult {
  contentText: string;
  similarity: number;
  sourceType: string;
  source: Record<string, unknown> | null;
}

async function searchKnowledgeBase(
  input: { query: string; limit?: number },
  ctx: ToolContext,
): Promise<{ results: KbSearchResult[] } | { error: string }> {
  const query = (input.query ?? '').trim();
  if (!query) {
    return { error: 'search_knowledge_base requires a non-empty query' };
  }
  if (!isEmbeddingConfigured()) {
    return { error: 'Knowledge base search is unavailable (OPENAI_API_KEY not configured).' };
  }

  const limit = Math.max(1, Math.min(20, input.limit ?? 5));

  try {
    const raw = await searchSimilarWithSources(query, limit);
    const results: KbSearchResult[] = raw.map((r) => {
      let sourceType = 'unknown';
      if (r.payerTrackId && !r.payerRequirementId && !r.payerStateRuleId && !r.payerTimelineId && !r.payerFormId) {
        sourceType = 'PayerTrack';
      } else if (r.payerRequirementId) sourceType = 'PayerRequirement';
      else if (r.payerStateRuleId) sourceType = 'PayerStateRule';
      else if (r.payerTimelineId) sourceType = 'PayerTimeline';
      else if (r.payerFormId) sourceType = 'PayerForm';
      else if (r.requirementUniversalId) sourceType = 'RequirementUniversal';

      return {
        contentText: r.contentText,
        similarity: Math.round(r.similarity * 1000) / 1000,
        sourceType,
        source: r.source,
      };
    });

    await logAgentEvent({
      workflowId: ctx.workflowId,
      agent: 'orchestrator',
      action: 'kb_search',
      data: { query, limit, resultCount: results.length },
    });

    return { results };
  } catch (err) {
    logger.warn('Knowledge base search failed', {
      workflowId: ctx.workflowId,
      query,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: `Knowledge base search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ==========================================
// Dispatcher
// ==========================================

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<unknown> {
  try {
    switch (name) {
      case 'get_provider_profile':
        return await getProviderProfile(input as { providerId: string });
      case 'get_payer_requirements':
        return await getPayerRequirements(input as { payerId: string });
      case 'check_credential_completeness':
        return await checkCredentialCompleteness(input as { providerId: string; payerId: string });
      case 'dispatch_task':
        return await dispatchTask(input as { type: string; input: Record<string, unknown> }, context);
      case 'request_human_approval':
        return await requestHumanApproval(input as { type: string; context: Record<string, unknown> }, context);
      case 'get_workflow_state':
        return await getWorkflowState(context);
      case 'escalate_to_exception':
        return await escalateToException(input as { issue: string; taskId?: string }, context);
      case 'narrate':
        return await narrate(input as { message: string; step?: number; downloadUrl?: string }, context);
      case 'populate_enrollment_forms':
        return await populateEnrollmentForms(input as { enrollmentId: string }, context);
      case 'search_knowledge_base':
        return await searchKnowledgeBase(input as { query: string; limit?: number }, context);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    logger.error('Tool execution failed', { tool: name, workflowId: context.workflowId, error: err });
    return { error: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
