import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/node';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { logAgentEvent } from '../event-logger.js';
import { notificationService } from '../../services/notification.service.js';
import { ORCHESTRATOR_TOOLS } from './tool-schemas.js';
import { executeToolCall } from './tool-executor.js';
import { buildSystemPrompt, buildUserMessage } from './system-prompt.js';

// ==========================================
// Constants
// ==========================================

const WORKFLOW_TOKEN_BUDGET = parseInt(process.env['AGENT_WORKFLOW_TOKEN_BUDGET'] ?? '50000', 10);
const MAX_REPLANS_PER_WORKFLOW = parseInt(process.env['MAX_REPLANS_PER_WORKFLOW'] ?? '5', 10);
const MAX_TOOL_CALLS_PER_INVOCATION = 20;
const AI_MODEL = process.env['AI_MODEL'] || 'claude-sonnet-4-20250514';

// ==========================================
// Types
// ==========================================

export interface OrchestratorJobData {
  workflowId: string;
  jobType: 'plan_workflow' | 'task_callback';
  taskId?: string;
  event?: 'task_completed' | 'task_failed';
}

export interface OrchestratorResult {
  workflowId: string;
  status: string;
  tokensUsed: number;
  toolCallCount: number;
  reasoning?: string;
}

// ==========================================
// Anthropic client (lazy singleton)
// ==========================================

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    anthropicClient = new Anthropic({ apiKey, timeout: 60_000 });
  }
  return anthropicClient;
}

/** Exposed for testing — allows injecting a mock client */
export function setAnthropicClient(client: Anthropic | null): void {
  anthropicClient = client;
}

// ==========================================
// Main orchestrator loop
// ==========================================

export async function processOrchestratorJob(data: OrchestratorJobData): Promise<OrchestratorResult> {
  const { workflowId, jobType } = data;

  if (jobType === 'task_callback' && data.event === 'task_failed') {
    Sentry.captureMessage('Orchestrator recovery turn triggered', {
      level: 'warning',
      tags: { workflow_id: workflowId, agent: 'orchestrator', event: 'task_failed' },
      extra: { taskId: data.taskId },
    });

    // Atomic increment of replanCount BEFORE we read the workflow row.
    //
    // The orchestrator queue runs at concurrency=3. Two task_failed callbacks
    // for the same workflow can land on different worker slots within ~50ms;
    // a JSON read-modify-write (read plan.replanCount → set plan.replanCount = n+1)
    // loses one of the increments and lets the workflow exceed MAX_REPLANS_PER_WORKFLOW
    // before the cap fires. Prisma's `{ increment: 1 }` translates to a single
    // SQL `UPDATE ... SET replan_count = replan_count + 1` which Postgres
    // serializes per row, so concurrent failures both register.
    //
    // Increment must come BEFORE findUnique below so `workflow.replanCount`
    // reflects the post-increment value used by the cap check (strict `>`).
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { replanCount: { increment: 1 } },
    });
  }

  // 1. Load workflow with tasks and approvals
  const workflow = await prisma.agentWorkflow.findUnique({
    where: { id: workflowId },
    include: {
      tasks: { orderBy: { stepNumber: 'asc' } },
      approvals: { orderBy: { requestedAt: 'desc' } },
    },
  });

  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  // 2. Check guardrails
  const plan = (workflow.plan as Record<string, unknown>) ?? {};
  // Cap check uses the post-increment column value. Strict `>` (not `>=`)
  // because a workflow that has just hit the cap exactly should still get
  // its final recovery turn before we fail it.
  const replanCount = workflow.replanCount;

  if (replanCount > MAX_REPLANS_PER_WORKFLOW) {
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        plan: {
          ...((workflow.plan as Record<string, unknown>) ?? {}),
          failureReason: 'max_replans_exceeded',
          replanCount,
        } as any,
      },
    });
    await logAgentEvent({
      workflowId,
      agent: 'orchestrator',
      action: 'replan_limit_reached',
      data: { replanCount, limit: MAX_REPLANS_PER_WORKFLOW, failureReason: 'max_replans_exceeded' },
      level: 'warn',
    });
    Sentry.captureMessage('Orchestrator workflow failed: max_replans_exceeded', {
      level: 'warning',
      tags: { workflow_id: workflowId, agent: 'orchestrator', failure_reason: 'max_replans_exceeded' },
      extra: { replanCount, limit: MAX_REPLANS_PER_WORKFLOW },
    });
    logger.warn('Orchestrator replan limit reached', { workflowId, replanCount });
    return { workflowId, status: 'failed', tokensUsed: 0, toolCallCount: 0, reasoning: 'max_replans_exceeded' };
  }

  if (workflow.totalTokensUsed >= WORKFLOW_TOKEN_BUDGET) {
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { status: 'paused' },
    });
    await logAgentEvent({
      workflowId,
      agent: 'orchestrator',
      action: 'token_budget_exceeded',
      data: { totalTokensUsed: workflow.totalTokensUsed, budget: WORKFLOW_TOKEN_BUDGET },
      level: 'warn',
    });
    logger.warn('Orchestrator token budget exceeded', { workflowId, totalTokensUsed: workflow.totalTokensUsed });
    return { workflowId, status: 'paused', tokensUsed: 0, toolCallCount: 0, reasoning: 'Token budget exceeded' };
  }

  // 3. Build prompts
  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage({
    jobType,
    workflow: workflow as any,
    callbackEvent: data.taskId
      ? { taskId: data.taskId, event: data.event ?? 'task_completed' }
      : undefined,
  });

  // 4. Claude message loop (wrapped in try/catch to prevent stuck workflows)
  const client = getAnthropicClient();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalReasoning = '';
  const dispatchedTaskIds: string[] = [];
  let requestedApproval = false;
  let escalatedToException = false;
  let loopExitReason: 'natural' | 'cap_hit' = 'natural';

  try {
    while (true) {
      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: ORCHESTRATOR_TOOLS,
      });

      // Track tokens
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Extract tool_use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ContentBlockParam & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          block.type === 'tool_use'
      );

      // Extract text blocks for reasoning
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      if (textBlocks.length > 0) {
        finalReasoning = textBlocks.map((b) => b.text).join('\n');
      }

      // If no tool calls — final response, break
      if (toolUseBlocks.length === 0) {
        break;
      }

      // Execute each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        const result = await executeToolCall(toolBlock.name, toolBlock.input, { workflowId });

        // Track dispatched tasks, approval requests, and escalations
        if (toolBlock.name === 'dispatch_task' && result && typeof result === 'object' && 'taskId' in result) {
          dispatchedTaskIds.push((result as { taskId: string }).taskId);
        }
        if (toolBlock.name === 'request_human_approval') {
          requestedApproval = true;
        }
        if (toolBlock.name === 'escalate_to_exception') {
          escalatedToException = true;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }

      // Append assistant message + tool results to conversation
      messages.push({ role: 'assistant', content: response.content as any });
      messages.push({ role: 'user', content: toolResults });

      // Check tool call limit
      toolCallCount += toolUseBlocks.length;
      if (toolCallCount >= MAX_TOOL_CALLS_PER_INVOCATION) {
        logger.info('Orchestrator max tool calls reached', { workflowId, toolCallCount });
        loopExitReason = 'cap_hit';
        break;
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('timed out');

    logger.error('Orchestrator job failed', { workflowId, error: errorMessage, isTimeout });

    await logAgentEvent({
      workflowId,
      agent: 'orchestrator',
      action: isTimeout ? 'orchestrator_timeout' : 'orchestrator_error',
      data: { error: errorMessage, isTimeout },
      level: 'error',
    });

    // On timeout, keep workflow active so BullMQ retry picks it up (don't mark failed on transient timeout)
    // For other errors, rethrow as before
    throw err;
  }

  // 5. Post-loop: persist plan and update workflow
  const tokensUsed = totalInputTokens + totalOutputTokens;

  // Determine new workflow status
  let newStatus = workflow.status;
  let failureReason: string | undefined;
  if (escalatedToException && dispatchedTaskIds.length === 0) {
    // Escalated with no other tasks — workflow cannot proceed automatically
    newStatus = 'failed';
  } else if (requestedApproval) {
    newStatus = 'waiting_approval';
  } else if (dispatchedTaskIds.length > 0) {
    newStatus = 'active';
  } else if (loopExitReason === 'natural') {
    // Claude finished naturally with no dispatch / approval / escalation —
    // the workflow has nothing more to do. Subsumes the prior toolCallCount===0 case.
    newStatus = 'completed';
  } else if (workflow.status === 'planning') {
    // Cap hit on the very first turn with no work dispatched — the workflow
    // has no callback path to recover, so fail it loudly.
    newStatus = 'failed';
    failureReason = 'cap_hit_on_first_turn';
  } else {
    // loopExitReason === 'cap_hit' on an already-'active' workflow with no new
    // dispatches — preserve existing behavior (stays 'active'). A separate
    // stuck-workflow watchdog cron will catch these. Log for telemetry until then.
    logger.warn('Orchestrator cap hit with no progress; workflow remains active', {
      workflowId,
      workflowStatus: workflow.status,
      toolCallCount,
      dispatchedTaskIds: dispatchedTaskIds.length,
    });
  }

  // Build updated plan. The atomic increment already happened in the
  // task_failed branch above, so workflow.replanCount is the authoritative
  // post-increment value. Mirror it into the JSON plan so a one-release
  // rollback that drops the column still has the count visible.
  const existingSteps = ((plan['steps'] as unknown[]) ?? []) as Record<string, unknown>[];
  const updatedPlan = {
    steps: existingSteps,
    replanCount: workflow.replanCount,
    reasoning: finalReasoning,
    ...(failureReason ? { failureReason } : {}),
  };

  await prisma.agentWorkflow.update({
    where: { id: workflowId },
    data: {
      plan: updatedPlan as any,
      totalTokensUsed: workflow.totalTokensUsed + tokensUsed,
      status: newStatus,
      ...(newStatus === 'completed' || newStatus === 'failed' ? { completedAt: new Date() } : {}),
    },
  });

  if (newStatus === 'completed') {
    Sentry.captureMessage('Orchestrator workflow completed', {
      level: 'info',
      tags: {
        workflow_id: workflowId,
        agent: 'orchestrator',
        replan_count: String(workflow.replanCount),
      },
      extra: { tokensUsed: workflow.totalTokensUsed + tokensUsed, toolCallCount },
    });
  }

  // Persistent in-app notification for terminal states so users who navigate
  // away still see the result via the notification bell. Failures gracefully
  // log + swallow to avoid breaking the workflow update on notification errors.
  if (newStatus === 'completed' || newStatus === 'failed') {
    try {
      const summary = await prisma.agentWorkflow.findUnique({
        where: { id: workflowId },
        select: {
          requestedBy: true,
          goal: true,
          provider: { select: { firstName: true, lastName: true } },
          payer: { select: { name: true } },
          tasks: { select: { output: true, error: true, status: true }, orderBy: { stepNumber: 'desc' }, take: 1 },
        },
      });
      if (summary?.requestedBy) {
        const providerName = summary.provider
          ? `${summary.provider.firstName} ${summary.provider.lastName}`.trim()
          : 'a provider';
        const payerName = summary.payer?.name ?? 'a payer';
        const lastTask = summary.tasks[0];
        const confirmationNumber = (lastTask?.output as Record<string, unknown> | null)?.['confirmationNumber'];
        const goalLabel = summary.goal === 'submit_to_availity_demo'
          ? 'Availity submission'
          : summary.goal === 'submit_to_aetna_demo'
          ? 'Aetna submission'
          : summary.goal === 'populate_forms'
          ? 'Form population'
          : 'Workflow';

        const title = newStatus === 'completed'
          ? `${goalLabel} completed for ${providerName}`
          : `${goalLabel} failed for ${providerName}`;
        const message = newStatus === 'completed'
          ? confirmationNumber
            ? `${payerName} returned confirmation ${String(confirmationNumber)}.`
            : `${payerName} workflow finished. Click to review.`
          : `${payerName} workflow did not complete. Click to review.`;

        await notificationService.createNotification({
          userId: summary.requestedBy,
          type: 'enrollment_status_change',
          title,
          message,
          actionUrl: `/enrollments/${workflow.enrollmentId ?? ''}`,
          metadata: {
            workflowId,
            goal: summary.goal,
            outcome: newStatus,
            ...(confirmationNumber ? { confirmationNumber: String(confirmationNumber) } : {}),
          } as any,
        });
      }
    } catch (err) {
      logger.warn('Failed to create workflow-completion notification', {
        workflowId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failureReason === 'cap_hit_on_first_turn') {
    Sentry.captureMessage('Orchestrator workflow failed: cap_hit_on_first_turn', {
      level: 'warning',
      tags: {
        workflow_id: workflowId,
        agent: 'orchestrator',
        failure_reason: 'cap_hit_on_first_turn',
      },
      extra: { toolCallCount, limit: MAX_TOOL_CALLS_PER_INVOCATION },
    });
  }

  await logAgentEvent({
    workflowId,
    agent: 'orchestrator',
    action: 'orchestrator_turn_complete',
    data: {
      jobType,
      toolCallCount,
      tokensUsed,
      dispatchedTasks: dispatchedTaskIds,
      escalatedToException,
      newStatus,
      reasoning: finalReasoning.slice(0, 500),
    },
  });

  logger.info('Orchestrator turn complete', {
    workflowId,
    jobType,
    toolCallCount,
    tokensUsed,
    newStatus,
  });

  return {
    workflowId,
    status: newStatus,
    tokensUsed,
    toolCallCount,
    reasoning: finalReasoning,
  };
}
