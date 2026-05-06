/**
 * Per-action agent telemetry (Phase 0.A PR 3).
 *
 * Captures one `AgentAction` row per agent processor invocation with billing
 * + SLO dimensions: providerId, practiceId, agentName, actionType, success,
 * errorCategory, durationMs, inputTokens/outputTokens, costCents.
 *
 * Fail-soft contract — same as event-logger:
 *   recordAgentAction()       — never throws; returns null on insert failure.
 *   withAgentTelemetry(...)   — never swallows the processor's success or
 *                               throw; writes telemetry as a side-effect of
 *                               the wrapped call. A telemetry insert failure
 *                               is logged at warn level and never propagates.
 *
 * Disambiguation note: this wrapper writes the AgentAction inside the
 * processor function returned to BullMQ. The `worker.on('completed'|'failed')`
 * handlers in workers.ts only emit log lines — they do NOT write AgentAction.
 * Keeping the write inside the processor closure is what guarantees exactly
 * one row per invocation.
 */
import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { priceCents } from '../utils/ai-pricing.js';

export interface RecordAgentActionInput {
  workflowId: string | null;
  taskId: string | null;
  providerId: string | null;
  practiceId: string | null;
  agentName: string;
  actionType: string;
  success: boolean;
  errorCategory: string | null;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

/**
 * Single insert of an AgentAction row. Fail-soft — returns null on any error.
 */
export async function recordAgentAction(input: RecordAgentActionInput) {
  try {
    return await prisma.agentAction.create({
      data: {
        workflowId: input.workflowId,
        taskId: input.taskId,
        providerId: input.providerId,
        practiceId: input.practiceId,
        agentName: input.agentName,
        actionType: input.actionType,
        success: input.success,
        errorCategory: input.errorCategory,
        durationMs: input.durationMs,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costCents: new Prisma.Decimal(input.costCents),
      },
    });
  } catch (err) {
    logger.warn('Failed to record agent action — telemetry row dropped', {
      error: err,
      agentName: input.agentName,
      actionType: input.actionType,
      workflowId: input.workflowId,
    });
    return null;
  }
}

/**
 * Coarse error bucketing for the `error_category` column.
 *
 * Buckets are the dimensions we want to group SLO violations by — finer-grained
 * detail belongs in Sentry / structured logs, not in this column. Add buckets
 * here only when a category becomes large enough to filter dashboards by.
 */
function classifyError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'unknown';

  const e = err as { code?: string; name?: string; message?: string };
  const code = typeof e.code === 'string' ? e.code : '';
  const name = typeof e.name === 'string' ? e.name : '';
  const msg = typeof e.message === 'string' ? e.message : '';

  if (code === 'P2034' || msg.includes('40001') || msg.toLowerCase().includes('could not serialize')) {
    return 'serialization_failure';
  }
  if (code === 'P2025' || name === 'NotFoundError') return 'not_found';
  if (name === 'ZodError' || name === 'ValidationError') return 'validation_error';
  if (name === 'PrismaClientKnownRequestError' || code.startsWith('P')) return 'database_error';
  if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')) return 'timeout';
  if (name === 'AbortError') return 'timeout';
  if (
    name === 'AnthropicError' ||
    msg.toLowerCase().includes('anthropic') ||
    msg.toLowerCase().includes('openai') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ETIMEDOUT')
  ) {
    return 'external_api_error';
  }
  return 'unknown';
}

interface MaybeTokens {
  inputTokens?: unknown;
  outputTokens?: unknown;
}

function extractTokens(result: unknown): { inputTokens: number; outputTokens: number } {
  if (!result || typeof result !== 'object') return { inputTokens: 0, outputTokens: 0 };
  const r = result as MaybeTokens;
  const i = typeof r.inputTokens === 'number' && r.inputTokens >= 0 ? r.inputTokens : 0;
  const o = typeof r.outputTokens === 'number' && r.outputTokens >= 0 ? r.outputTokens : 0;
  return { inputTokens: i, outputTokens: o };
}

async function deriveProviderAndPractice(
  workflowId: string | null
): Promise<{ providerId: string | null; practiceId: string | null }> {
  if (!workflowId) return { providerId: null, practiceId: null };
  try {
    const wf = await prisma.agentWorkflow.findUnique({
      where: { id: workflowId },
      select: {
        providerId: true,
        provider: { select: { practiceId: true } },
      },
    });
    if (!wf) return { providerId: null, practiceId: null };
    return {
      providerId: wf.providerId,
      practiceId: wf.provider.practiceId ?? null,
    };
  } catch (err) {
    logger.warn('Failed to derive provider/practice for telemetry', { workflowId, error: err });
    return { providerId: null, practiceId: null };
  }
}

/**
 * Higher-order wrapper for BullMQ processors.
 *
 * Times the processor, classifies any thrown error, derives provider/practice
 * from the workflow row, computes cost from the model rate, and writes a
 * single AgentAction row. The processor's return value (success path) and
 * thrown error (failure path) are passed through unchanged so BullMQ retry
 * + completion semantics behave exactly as before this wrapper was added.
 */
export function withAgentTelemetry<T>(
  agentName: string,
  processor: (job: Job) => Promise<T>
): (job: Job) => Promise<T> {
  return async (job: Job): Promise<T> => {
    const startedAt = Date.now();
    let result: T | undefined;
    let thrown: unknown;

    try {
      result = await processor(job);
    } catch (err) {
      thrown = err;
    }

    const durationMs = Date.now() - startedAt;
    const data = (job.data ?? {}) as Record<string, unknown>;
    const workflowId = typeof data['workflowId'] === 'string' ? (data['workflowId'] as string) : null;
    const taskId = typeof data['taskId'] === 'string' ? (data['taskId'] as string) : null;
    const actionType = job.name || agentName;

    const success = thrown === undefined;
    const errorCategory = success ? null : classifyError(thrown);
    const { inputTokens, outputTokens } = success ? extractTokens(result) : { inputTokens: 0, outputTokens: 0 };
    const costCents = priceCents(process.env['AI_MODEL'], inputTokens, outputTokens);
    const { providerId, practiceId } = await deriveProviderAndPractice(workflowId);

    await recordAgentAction({
      workflowId,
      taskId,
      providerId,
      practiceId,
      agentName,
      actionType,
      success,
      errorCategory,
      durationMs,
      inputTokens,
      outputTokens,
      costCents,
    });

    if (thrown !== undefined) throw thrown;
    return result as T;
  };
}
