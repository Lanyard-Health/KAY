import type Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';
import { logAgentEvent } from '../event-logger.js';
import { emitWorkflowEvent } from '../websocket.js';
import { buildExceptionSystemPrompt, buildExceptionUserMessage } from './prompt.js';
import { decryptSafe } from '../../utils/crypto.js';
import { callLLM, setLLMClientForTesting } from '../../utils/llm.js';
import type { ExceptionJobData, ExceptionJobResult, ExceptionAnalysis } from './types.js';

// ==========================================
// Constants
// ==========================================

const AI_MODEL = process.env['AI_MODEL'] || 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;
const MAX_REMEDIATION_ATTEMPTS = 3;

// ==========================================
// Test seam
// ==========================================

/** Backwards-compat shim — exception-agent no longer owns its client; calls
 *  go through the shared LLM wrapper. */
export function setAnthropicClient(client: Anthropic | null): void {
  setLLMClientForTesting(client);
}

// ==========================================
// Main processor
// ==========================================

export async function processExceptionJob(data: ExceptionJobData): Promise<ExceptionJobResult> {
  const { workflowId, taskId, issue, denialReason, denialCode } = data;

  // 1. Load workflow
  const workflow = await prisma.agentWorkflow.findUnique({
    where: { id: workflowId },
    include: {
      tasks: { orderBy: { stepNumber: 'asc' } },
    },
  });

  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  // 2. Load failed task error/output (if taskId provided)
  let taskError: object | undefined;
  let remediationAttempts = 0;
  if (taskId) {
    const failedTask = await prisma.agentTask.findUnique({ where: { id: taskId } });
    if (failedTask) {
      taskError = (failedTask.error as object) ?? (failedTask.output as object) ?? undefined;
      const output = failedTask.output as Record<string, unknown> | null;
      if (output && typeof output['remediationAttempts'] === 'number') {
        remediationAttempts = output['remediationAttempts'];
      }
    }
  }

  // 3. Load provider credentials
  const provider = await prisma.providerProfile.findUnique({
    where: { id: workflow.providerId },
    select: {
      npi: true,
      firstName: true,
      lastName: true,
      licenses: { select: { state: true, licenseNumber: true, status: true, expirationDate: true } },
      boardCertifications: { select: { specialty: true, status: true, expirationDate: true } },
      malpracticeInsurances: { select: { carrierName: true, status: true, expirationDate: true } },
      deaRegistrations: { select: { deaNumberEncrypted: true, status: true, expirationDate: true } },
      educations: { select: { institutionName: true, degree: true } },
    },
  });

  const providerCredentials = provider
    ? {
        ...provider,
        deaRegistrations: provider.deaRegistrations.map((d) => ({
          ...d,
          deaNumberEncrypted: undefined,
          deaNumber: decryptSafe(d.deaNumberEncrypted),
        })),
      }
    : {};

  // 4. Load payer requirements
  let payerRequirements: object = {};
  if (workflow.payerId) {
    const config = await prisma.payerSubmissionConfig.findUnique({
      where: { payerId: workflow.payerId },
      select: { adapterType: true, requiredFields: true },
    });
    if (config) {
      payerRequirements = config;
    }
  }

  // 5. Build prompt
  const systemPrompt = buildExceptionSystemPrompt();
  const userMessage = buildExceptionUserMessage({
    issue,
    denialReason,
    denialCode,
    providerCredentials,
    payerRequirements,
    taskError,
  });

  // 6. Single Claude call
  const response = await callLLM({
    model: AI_MODEL,
    maxTokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const tokensUsed = response.inputTokens + response.outputTokens;

  // 7. Parse response
  const rawText = response.text;

  let analysis: ExceptionAnalysis;
  try {
    analysis = JSON.parse(rawText);
  } catch {
    // Malformed response — store raw text and use defaults
    logger.warn('Exception agent received malformed Claude response', {
      workflowId,
      rawText: rawText.slice(0, 500),
    });
    analysis = {
      category: 'unknown_denial',
      severity: 'medium',
      rootCause: rawText.slice(0, 500),
      autoRemediable: false,
      steps: [{ action: 'escalate_to_human', description: 'Could not parse AI analysis. Manual review required.' }],
    };
  }

  // 8. Save analysis
  const analysisOutput = {
    analysis,
    rawResponse: rawText.slice(0, 1000),
    tokensUsed,
  };

  if (taskId) {
    // Update existing task
    await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        output: analysisOutput as any,
      },
    });
  } else {
    // Create new exception task
    const taskCount = await prisma.agentTask.count({ where: { workflowId } });
    await prisma.agentTask.create({
      data: {
        workflowId,
        type: 'exception_analysis',
        agentType: 'exception',
        status: 'completed',
        input: { issue, denialReason, denialCode } as any,
        output: analysisOutput as any,
        stepNumber: taskCount + 1,
        completedAt: new Date(),
        tokensUsed,
      },
    });
  }

  // 9. Track tokens on workflow
  await prisma.agentWorkflow.update({
    where: { id: workflowId },
    data: {
      totalTokensUsed: workflow.totalTokensUsed + tokensUsed,
    },
  });

  // 10. Log event
  await logAgentEvent({
    workflowId,
    taskId,
    agent: 'exception',
    action: 'exception_analyzed',
    data: {
      category: analysis.category,
      severity: analysis.severity,
      autoRemediable: analysis.autoRemediable,
      stepsCount: analysis.steps.length,
      tokensUsed,
    },
  });

  // 11. WebSocket notification
  emitWorkflowEvent(workflowId, 'exception:analyzed', {
    taskId,
    category: analysis.category,
    severity: analysis.severity,
    rootCause: analysis.rootCause,
  });

  // 12. Only re-enqueue orchestrator if the exception is auto-remediable
  //     AND we haven't exceeded the remediation attempt cap.
  if (analysis.autoRemediable && remediationAttempts >= MAX_REMEDIATION_ATTEMPTS) {
    analysis.autoRemediable = false;
    logger.warn('Auto-remediation cap reached — forcing escalation to human', {
      workflowId,
      taskId,
      remediationAttempts,
      maxAttempts: MAX_REMEDIATION_ATTEMPTS,
      category: analysis.category,
    });
  }

  if (analysis.autoRemediable) {
    // Increment remediation counter on the task
    const newAttempts = remediationAttempts + 1;
    if (taskId) {
      const existingOutput = (await prisma.agentTask.findUnique({
        where: { id: taskId },
        select: { output: true },
      }))?.output as Record<string, unknown> | null;

      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          output: { ...(existingOutput ?? {}), remediationAttempts: newAttempts },
        },
      });
    }

    const orchestratorQueue = getQueue(QUEUE_NAMES.ORCHESTRATOR);
    await orchestratorQueue.add('task_callback', {
      workflowId,
      taskId,
      event: 'task_failed',
      jobType: 'task_callback',
    });
    logger.info('Exception analyzed — auto-remediable, re-enqueuing orchestrator', {
      workflowId,
      category: analysis.category,
      remediationAttempts: newAttempts,
    });
  } else {
    // Mark workflow as failed — requires human intervention
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { status: 'failed', completedAt: new Date() },
    });
    logger.info('Exception analyzed — not auto-remediable, workflow marked failed', {
      workflowId,
      category: analysis.category,
      severity: analysis.severity,
    });
  }

  // 13. Return result
  return {
    workflowId,
    category: analysis.category,
    severity: analysis.severity,
    analysis,
  };
}
