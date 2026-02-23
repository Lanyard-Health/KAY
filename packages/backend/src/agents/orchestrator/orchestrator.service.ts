import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { logAgentEvent } from '../event-logger.js';
import { ORCHESTRATOR_TOOLS } from './tool-schemas.js';
import { executeToolCall } from './tool-executor.js';
import { buildSystemPrompt, buildUserMessage } from './system-prompt.js';

// ==========================================
// Constants
// ==========================================

const WORKFLOW_TOKEN_BUDGET = parseInt(process.env['AGENT_WORKFLOW_TOKEN_BUDGET'] ?? '50000', 10);
const MAX_REPLAN_COUNT = 5;
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
    anthropicClient = new Anthropic({ apiKey });
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
  const replanCount = (plan['replanCount'] as number) ?? 0;

  if (replanCount >= MAX_REPLAN_COUNT) {
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { status: 'failed', completedAt: new Date() },
    });
    await logAgentEvent({
      workflowId,
      agent: 'orchestrator',
      action: 'replan_limit_reached',
      data: { replanCount, limit: MAX_REPLAN_COUNT },
      level: 'warn',
    });
    logger.warn('Orchestrator replan limit reached', { workflowId, replanCount });
    return { workflowId, status: 'failed', tokensUsed: 0, toolCallCount: 0, reasoning: 'Replan limit reached' };
  }

  if (workflow.totalTokensUsed >= WORKFLOW_TOKEN_BUDGET) {
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { status: 'failed', completedAt: new Date() },
    });
    await logAgentEvent({
      workflowId,
      agent: 'orchestrator',
      action: 'token_budget_exceeded',
      data: { totalTokensUsed: workflow.totalTokensUsed, budget: WORKFLOW_TOKEN_BUDGET },
      level: 'warn',
    });
    logger.warn('Orchestrator token budget exceeded', { workflowId, totalTokensUsed: workflow.totalTokensUsed });
    return { workflowId, status: 'failed', tokensUsed: 0, toolCallCount: 0, reasoning: 'Token budget exceeded' };
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
        break;
      }
    }
  } catch (err) {
    // Mark workflow as failed so it doesn't stay stuck in 'planning'
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Orchestrator job failed', { workflowId, error: errorMessage });

    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { status: 'failed', completedAt: new Date() },
    });

    await logAgentEvent({
      workflowId,
      agent: 'orchestrator',
      action: 'orchestrator_error',
      data: { error: errorMessage },
      level: 'error',
    });

    return {
      workflowId,
      status: 'failed',
      tokensUsed: totalInputTokens + totalOutputTokens,
      toolCallCount,
      reasoning: `Error: ${errorMessage}`,
    };
  }

  // 5. Post-loop: persist plan and update workflow
  const tokensUsed = totalInputTokens + totalOutputTokens;

  // Build updated plan
  const existingSteps = ((plan['steps'] as unknown[]) ?? []) as Record<string, unknown>[];
  const updatedPlan = {
    steps: existingSteps,
    replanCount: jobType === 'task_callback' ? replanCount + 1 : replanCount,
    reasoning: finalReasoning,
  };

  // Determine new workflow status
  let newStatus = workflow.status;
  if (escalatedToException && dispatchedTaskIds.length === 0) {
    // Escalated with no other tasks — workflow cannot proceed automatically
    newStatus = 'failed';
  } else if (requestedApproval) {
    newStatus = 'waiting_approval';
  } else if (dispatchedTaskIds.length > 0) {
    newStatus = 'active';
  } else if (toolCallCount === 0) {
    // No tool calls at all — Claude decided the workflow is done
    newStatus = 'completed';
  }

  await prisma.agentWorkflow.update({
    where: { id: workflowId },
    data: {
      plan: updatedPlan as any,
      totalTokensUsed: workflow.totalTokensUsed + tokensUsed,
      status: newStatus,
      ...(newStatus === 'completed' || newStatus === 'failed' ? { completedAt: new Date() } : {}),
    },
  });

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
