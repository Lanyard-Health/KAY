import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollectInsights = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());

vi.mock('./agent-insights.service.js', () => ({
  collectInsights: mockCollectInsights,
}));

vi.mock('../utils/llm.js', () => ({
  callLLM: mockCallLLM,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { generateInsightsReport } from './agent-insights-report.service.js';

const emptySnapshot = {
  window: { days: 7, start: '2026-05-19T00:00:00.000Z', end: '2026-05-26T00:00:00.000Z' },
  orchestratorTurns: 0,
  totalTokensUsed: 0,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  cacheHitRatio: null,
  routerDecisions: { stepperHandled: 0, bailedToLLM: [] },
  stepperOutcomes: [],
  workflowOutcomes: { completed: 0, failed: 0, cancelled: 0, activeStillRunning: 0 },
  topTaskFailures: [],
  topExpensiveWorkflows: [],
};

const busySnapshot = {
  ...emptySnapshot,
  orchestratorTurns: 12,
  totalTokensUsed: 100_000,
  totalCacheCreationTokens: 5_000,
  totalCacheReadTokens: 80_000,
  cacheHitRatio: 0.94,
  routerDecisions: {
    stepperHandled: 30,
    bailedToLLM: [{ reason: 'no active portal adapter', count: 12 }],
  },
};

describe('generateInsightsReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a static markdown body when nothing happened — no LLM call', async () => {
    mockCollectInsights.mockResolvedValue(emptySnapshot);

    const report = await generateInsightsReport(7);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(report.markdown).toContain('No orchestrator activity');
    expect(report.reportTokens.model).toBe('none');
    expect(report.snapshot).toEqual(emptySnapshot);
  });

  it('asks Haiku for a markdown report when there is activity', async () => {
    mockCollectInsights.mockResolvedValue(busySnapshot);
    mockCallLLM.mockResolvedValue({
      text: '# AI Activity Summary\n\nGood week.',
      inputTokens: 300,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      model: 'claude-haiku-4-5-20251001',
      stopReason: 'end_turn',
      content: [],
    });

    const report = await generateInsightsReport(7);

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const callArgs = mockCallLLM.mock.calls[0][0];
    expect(callArgs.model).toContain('haiku');
    expect(callArgs.system).toContain('weekly');
    expect(callArgs.messages[0].content).toContain('DATA:');
    expect(report.markdown).toContain('AI Activity Summary');
    expect(report.reportTokens).toEqual({
      input: 300,
      output: 200,
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('handles empty text response from the model gracefully', async () => {
    mockCollectInsights.mockResolvedValue(busySnapshot);
    mockCallLLM.mockResolvedValue({
      text: '',
      inputTokens: 300,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      model: 'claude-haiku-4-5-20251001',
      stopReason: 'end_turn',
      content: [],
    });

    const report = await generateInsightsReport(7);

    expect(report.markdown).toContain('try again');
    expect(report.reportTokens.input).toBe(300);
  });

  it('compacts the snapshot before sending — does not include full payerId/providerId fields in topExpensive', async () => {
    mockCollectInsights.mockResolvedValue({
      ...busySnapshot,
      topExpensiveWorkflows: [
        { workflowId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', tokensUsed: 9999, payerId: 'pay-secret', providerId: 'prov-secret' },
      ],
    });
    mockCallLLM.mockResolvedValue({
      text: '# Report',
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      model: 'claude-haiku-4-5-20251001',
      stopReason: 'end_turn',
      content: [],
    });

    await generateInsightsReport(7);

    const userMessage = mockCallLLM.mock.calls[0][0].messages[0].content;
    expect(userMessage).toContain('"workflowId": "aaaaaaaa"'); // truncated
    expect(userMessage).not.toContain('pay-secret');
    expect(userMessage).not.toContain('prov-secret');
  });
});
