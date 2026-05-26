/**
 * Agent insights report generator — Phase 5 of the cost-optimization plan.
 *
 * Takes the structured snapshot from agent-insights.service.ts and asks Haiku
 * (cheap tier — pure summarization, no reasoning needed) to write a short
 * markdown report for the founder. The report focuses on actionable findings:
 *   - Where is the deterministic stepper bailing to the LLM most? (template gaps)
 *   - Is cache hit rate healthy? (Phase 1 still working)
 *   - Which task types are failing? (workflow design issues)
 *   - Which workflows burned the most tokens? (drill-down candidates)
 *
 * Returns markdown + the raw snapshot so callers can persist both later if a
 * follow-up PR adds DB storage. v1 is stateless on purpose — call the
 * generator on demand, read the response, decide what to do.
 */

import { callLLM } from '../utils/llm.js';
import { logger } from '../utils/logger.js';
import { collectInsights, type InsightsSnapshot } from './agent-insights.service.js';

const REPORT_SYSTEM_PROMPT = `You are an analyst summarising weekly AI orchestrator telemetry for the founder of a small healthcare credentialing SaaS. The founder is non-technical and cares about three things: (1) is the AI getting more efficient over time, (2) what specific things should we fix this week to reduce cost or improve reliability, (3) what unusual signals appeared that need investigation. Output concise GitHub-flavored markdown with these sections in order:

# AI Activity Summary (week of <window>)
A 2-3 sentence overview using the topline numbers (workflows run, tokens used, cache hit ratio, stepper-handled ratio).

## What went well
2-4 bullet points. Specific. Use numbers.

## What to fix
2-4 bullet points naming concrete next actions. If the stepper bailed to LLM with reasons that look fixable (e.g. "no active portal adapter" — a config gap, not a reasoning gap), say so plainly. Tie each suggestion to a specific number from the data.

## Worth investigating
2-3 bullet points naming workflows or task types that look anomalous. Reference workflow IDs only when they appear in topExpensiveWorkflows.

Rules:
- Speak in plain language. The reader can't read code.
- Round numbers (1,234 → "~1.2K"). Render percentages as "X%".
- Never invent data not present in the JSON. If a section has nothing useful to say, write "Nothing notable this week."
- Total length: ~250 words. Be concrete, not flowery.`;

export interface InsightsReport {
  /** Markdown body suitable for email / Slack / a UI. */
  markdown: string;
  /** Raw snapshot the markdown was derived from. */
  snapshot: InsightsSnapshot;
  /** Tokens spent on this report itself (Haiku, so cheap). */
  reportTokens: { input: number; output: number; model: string };
  /** ISO timestamp of generation. */
  generatedAt: string;
}

export async function generateInsightsReport(daysBack = 7): Promise<InsightsReport> {
  const snapshot = await collectInsights(daysBack);
  const generatedAt = new Date().toISOString();

  // Edge case: nothing happened. Don't burn tokens — return a static body.
  if (snapshot.orchestratorTurns === 0 && snapshot.routerDecisions.stepperHandled === 0) {
    const start = new Date(snapshot.window.start).toLocaleDateString();
    const end = new Date(snapshot.window.end).toLocaleDateString();
    return {
      markdown: `# AI Activity Summary (${start} – ${end})\n\nNo orchestrator activity in this window. Nothing to report.`,
      snapshot,
      reportTokens: { input: 0, output: 0, model: 'none' },
      generatedAt,
    };
  }

  // Compact the snapshot so the Haiku call stays small. Send only what the
  // model needs to write the report; drop fields with zero signal.
  const compactPayload = {
    window: snapshot.window,
    topline: {
      orchestratorTurns: snapshot.orchestratorTurns,
      totalTokensUsed: snapshot.totalTokensUsed,
      cacheHitRatio: snapshot.cacheHitRatio,
      cacheCreationTokens: snapshot.totalCacheCreationTokens,
      cacheReadTokens: snapshot.totalCacheReadTokens,
    },
    stepperUsage: {
      handled: snapshot.routerDecisions.stepperHandled,
      bailReasons: snapshot.routerDecisions.bailedToLLM,
      outcomes: snapshot.stepperOutcomes,
    },
    workflows: snapshot.workflowOutcomes,
    taskFailures: snapshot.topTaskFailures,
    topExpensive: snapshot.topExpensiveWorkflows.map((w) => ({
      workflowId: w.workflowId.slice(0, 8),
      tokensUsed: w.tokensUsed,
    })),
  };

  const userMessage = `Generate the weekly AI orchestrator report from this telemetry snapshot.\n\nDATA:\n\`\`\`json\n${JSON.stringify(compactPayload, null, 2)}\n\`\`\``;

  const response = await callLLM({
    model: process.env['AI_MODEL_CLASSIFIER'] || 'claude-haiku-4-5-20251001',
    maxTokens: 1500,
    system: REPORT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  if (!response.text) {
    logger.warn('Insights report generator: empty response from Haiku');
    return {
      markdown: '_(Report generation returned no content — try again later.)_',
      snapshot,
      reportTokens: { input: response.inputTokens, output: response.outputTokens, model: response.model },
      generatedAt,
    };
  }

  return {
    markdown: response.text,
    snapshot,
    reportTokens: { input: response.inputTokens, output: response.outputTokens, model: response.model },
    generatedAt,
  };
}
