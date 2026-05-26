/**
 * Agent insights aggregator — Phase 5 of the cost-optimization plan.
 *
 * Reads agent_events over a rolling window (default 7 days) and returns
 * structured signals about where the AI orchestrator is spending tokens,
 * where the deterministic stepper bails to the LLM, and which payers /
 * task types account for the most rework. Pure read-only aggregation —
 * no DB writes, no LLM calls. The report generator consumes this and
 * asks Haiku to summarize the patterns in plain English.
 */

import { prisma } from '../utils/prisma.js';

export interface InsightsWindow {
  /** Days back from now. */
  days: number;
  /** ISO start. */
  start: string;
  /** ISO end (now). */
  end: string;
}

export interface InsightsSnapshot {
  window: InsightsWindow;

  /** Total orchestrator turns (each = 1 LLM invocation w/ tool-use loop). */
  orchestratorTurns: number;
  /** Sum of tokensUsed across all turns. */
  totalTokensUsed: number;
  /** Sum of cacheCreationTokens. */
  totalCacheCreationTokens: number;
  /** Sum of cacheReadTokens. */
  totalCacheReadTokens: number;
  /** Cache read tokens / (cache reads + cache writes), 0-1; null when divisor 0. */
  cacheHitRatio: number | null;

  /** Router decisions when DETERMINISTIC_STEPPER=true. Stepper-handled = 0-token. */
  routerDecisions: {
    /** Stepper handled the callback — 0 tokens. */
    stepperHandled: number;
    /** Stepper bailed back to LLM. Grouped by reason for actionability. */
    bailedToLLM: Array<{ reason: string; count: number }>;
  };

  /** Stepper outcomes (subset of routerDecisions, more granular). */
  stepperOutcomes: Array<{ outcome: string; nextTaskType?: string; count: number }>;

  /** Workflow status transitions. Tells us how many completed vs failed. */
  workflowOutcomes: {
    completed: number;
    failed: number;
    cancelled: number;
    activeStillRunning: number;
  };

  /** Top 5 task types by failure count (helps prioritize template fixes). */
  topTaskFailures: Array<{ taskType: string; failedCount: number }>;

  /** Top 10 most-expensive workflows by tokensUsed (drill-down candidates). */
  topExpensiveWorkflows: Array<{
    workflowId: string;
    tokensUsed: number;
    payerId: string | null;
    providerId: string;
  }>;
}

interface OrchestratorTurnRow {
  count: bigint | null;
  total_tokens: bigint | null;
  total_cache_creation: bigint | null;
  total_cache_read: bigint | null;
}

interface RouterReasonRow {
  reason: string | null;
  count: bigint;
}

interface RouterDecisionRow {
  decision: string | null;
  count: bigint;
}

interface StepperOutcomeRow {
  outcome: string | null;
  next_task_type: string | null;
  count: bigint;
}

interface WorkflowStatusRow {
  status: string;
  count: bigint;
}

interface TaskFailureRow {
  type: string;
  failed_count: bigint;
}

interface ExpensiveWorkflowRow {
  id: string;
  totalTokensUsed: number;
  payerId: string | null;
  providerId: string;
}

export async function collectInsights(daysBack = 7): Promise<InsightsSnapshot> {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const [
    turnAgg,
    routerByDecision,
    routerBailReasons,
    stepperOutcomes,
    workflowOutcomes,
    taskFailures,
    expensiveWorkflows,
  ] = await Promise.all([
    prisma.$queryRaw<OrchestratorTurnRow[]>`
      SELECT
        COUNT(*)::bigint AS count,
        COALESCE(SUM((data->>'tokensUsed')::bigint), 0)::bigint AS total_tokens,
        COALESCE(SUM((data->>'cacheCreationTokens')::bigint), 0)::bigint AS total_cache_creation,
        COALESCE(SUM((data->>'cacheReadTokens')::bigint), 0)::bigint AS total_cache_read
      FROM agent_events
      WHERE action = 'orchestrator_turn_complete'
        AND timestamp >= ${start}
        AND timestamp < ${end}
    `,
    prisma.$queryRaw<RouterDecisionRow[]>`
      SELECT (data->>'route') AS decision, COUNT(*)::bigint AS count
      FROM agent_events
      WHERE agent = 'router'
        AND action = 'route_decision'
        AND timestamp >= ${start}
        AND timestamp < ${end}
      GROUP BY (data->>'route')
    `,
    prisma.$queryRaw<RouterReasonRow[]>`
      SELECT (data->>'reason') AS reason, COUNT(*)::bigint AS count
      FROM agent_events
      WHERE agent = 'router'
        AND action = 'route_decision'
        AND (data->>'route') = 'llm'
        AND (data->>'reason') LIKE 'stepper bailed:%'
        AND timestamp >= ${start}
        AND timestamp < ${end}
      GROUP BY (data->>'reason')
      ORDER BY count DESC
      LIMIT 20
    `,
    prisma.$queryRaw<StepperOutcomeRow[]>`
      SELECT
        (data->>'outcome') AS outcome,
        (data->>'nextTaskType') AS next_task_type,
        COUNT(*)::bigint AS count
      FROM agent_events
      WHERE agent = 'stepper'
        AND action = 'stepper_decision'
        AND timestamp >= ${start}
        AND timestamp < ${end}
      GROUP BY (data->>'outcome'), (data->>'nextTaskType')
      ORDER BY count DESC
    `,
    prisma.$queryRaw<WorkflowStatusRow[]>`
      SELECT status::text, COUNT(*)::bigint AS count
      FROM agent_workflows
      WHERE updated_at >= ${start}
        AND updated_at < ${end}
      GROUP BY status
    `,
    prisma.$queryRaw<TaskFailureRow[]>`
      SELECT type, COUNT(*)::bigint AS failed_count
      FROM agent_tasks
      WHERE status = 'failed'
        AND updated_at >= ${start}
        AND updated_at < ${end}
      GROUP BY type
      ORDER BY failed_count DESC
      LIMIT 5
    `,
    prisma.agentWorkflow.findMany({
      where: { updatedAt: { gte: start, lt: end } },
      select: { id: true, totalTokensUsed: true, payerId: true, providerId: true },
      orderBy: { totalTokensUsed: 'desc' },
      take: 10,
    }) as Promise<ExpensiveWorkflowRow[]>,
  ]);

  const turnRow = turnAgg[0] ?? { count: 0n, total_tokens: 0n, total_cache_creation: 0n, total_cache_read: 0n };
  const cacheCreate = Number(turnRow.total_cache_creation ?? 0n);
  const cacheRead = Number(turnRow.total_cache_read ?? 0n);
  const cacheHitRatio =
    cacheRead + cacheCreate > 0 ? cacheRead / (cacheRead + cacheCreate) : null;

  const stepperHandledRow = routerByDecision.find((r) => r.decision === 'stepper');
  const stepperHandled = Number(stepperHandledRow?.count ?? 0n);

  const workflowCounts = { completed: 0, failed: 0, cancelled: 0, activeStillRunning: 0 };
  for (const row of workflowOutcomes) {
    const count = Number(row.count);
    if (row.status === 'completed') workflowCounts.completed += count;
    else if (row.status === 'failed') workflowCounts.failed += count;
    else if (row.status === 'cancelled') workflowCounts.cancelled += count;
    else if (row.status === 'active' || row.status === 'planning' || row.status === 'paused' || row.status === 'waiting_approval') {
      workflowCounts.activeStillRunning += count;
    }
  }

  return {
    window: {
      days: daysBack,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    orchestratorTurns: Number(turnRow.count ?? 0n),
    totalTokensUsed: Number(turnRow.total_tokens ?? 0n),
    totalCacheCreationTokens: cacheCreate,
    totalCacheReadTokens: cacheRead,
    cacheHitRatio,
    routerDecisions: {
      stepperHandled,
      bailedToLLM: routerBailReasons.map((r) => ({
        reason: (r.reason ?? '').replace(/^stepper bailed:\s*/, ''),
        count: Number(r.count),
      })),
    },
    stepperOutcomes: stepperOutcomes.map((r) => ({
      outcome: r.outcome ?? 'unknown',
      ...(r.next_task_type ? { nextTaskType: r.next_task_type } : {}),
      count: Number(r.count),
    })),
    workflowOutcomes: workflowCounts,
    topTaskFailures: taskFailures.map((r) => ({
      taskType: r.type,
      failedCount: Number(r.failed_count),
    })),
    topExpensiveWorkflows: expensiveWorkflows.map((w) => ({
      workflowId: w.id,
      tokensUsed: w.totalTokensUsed,
      payerId: w.payerId,
      providerId: w.providerId,
    })),
  };
}
