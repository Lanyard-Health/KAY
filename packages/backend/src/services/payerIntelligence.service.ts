import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getClient, checkTokenBudget, sanitizeUserInput } from './ai.service.js';
import type { AiRecommendationType, AiRecommendationStatus } from '@prisma/client';
import { getCached, setCache } from '../utils/cache.js';

const AI_MODEL = process.env['AI_MODEL'] || 'claude-sonnet-4-20250514';

// ===========================
// Types
// ===========================

export interface PayerAnalytics {
  payerId: string;
  payerName: string;
  payerType: string | null;
  totalEnrollments: number;
  activeEnrollments: number;
  approvalRate: number | null;
  denialRate: number | null;
  avgDaysToApproval: number | null;
  avgDaysInCurrentStatus: number | null;
  enrollmentsStuckOver60Days: number;
  statusDistribution: Record<string, number>;
  insufficientData: boolean;
}

export interface PayerLeaderboardItem {
  payerId: string;
  payerName: string;
  payerType: string | null;
  difficultyScore: number;
  approvalRate: number | null;
  denialRate: number | null;
  avgDaysToApproval: number | null;
  totalEnrollments: number;
  stuckCount: number;
}

export interface PayerAIInsight {
  riskAssessment: string;
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: Array<{
    action: string;
    priority: string;
    reasoning: string;
  }>;
  optimalFollowUpStrategy: {
    frequencyDays: number;
    bestApproach: string;
    escalationThreshold: string;
  };
  comparisonInsight: string;
}

// ===========================
// Analytics (pure data, no AI)
// ===========================

const ANALYTICS_TTL = 5 * 60 * 1000; // 5 minutes

export async function getPayerAnalytics(payerId?: string): Promise<PayerAnalytics[]> {
  const cacheKey = `payer-analytics:${payerId || 'all'}`;
  const cached = getCached<PayerAnalytics[]>(cacheKey);
  if (cached) return cached;

  // Get all payers that have enrollments
  const payers = await prisma.payer.findMany({
    where: payerId ? { id: payerId } : undefined,
    select: { id: true, name: true, payerType: true },
  });

  const payerIds = payers.map(p => p.id);
  if (payerIds.length === 0) return [];

  // Get all enrollments for these payers
  const enrollments = await prisma.enrollment.findMany({
    where: { payerId: { in: payerIds } },
    select: {
      id: true,
      payerId: true,
      status: true,
      applicationDate: true,
      effectiveDate: true,
      updatedAt: true,
    },
  });

  // Group enrollments by payer
  const byPayer = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const existing = byPayer.get(e.payerId) || [];
    existing.push(e);
    byPayer.set(e.payerId, existing);
  }

  const now = Date.now();
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
  const results: PayerAnalytics[] = [];

  for (const payer of payers) {
    const payerEnrollments = byPayer.get(payer.id);
    if (!payerEnrollments || payerEnrollments.length === 0) continue;

    // Status distribution
    const statusDistribution: Record<string, number> = {};
    for (const e of payerEnrollments) {
      statusDistribution[e.status] = (statusDistribution[e.status] || 0) + 1;
    }

    const approved = statusDistribution['approved'] || 0;
    const denied = statusDistribution['denied'] || 0;
    const terminated = statusDistribution['terminated'] || 0;
    const total = payerEnrollments.length;
    const active = total - terminated;
    const decided = approved + denied;
    const insufficientData = total < 3;

    // Approval/denial rates (only meaningful with >= 3 enrollments)
    let approvalRate: number | null = null;
    let denialRate: number | null = null;
    if (!insufficientData && decided > 0) {
      approvalRate = Math.round((approved / decided) * 100);
      denialRate = Math.round((denied / decided) * 100);
    }

    // Avg days to approval (only for enrollments with both dates)
    const approvedWithDates = payerEnrollments.filter(
      e => e.status === 'approved' && e.applicationDate && e.effectiveDate
    );
    let avgDaysToApproval: number | null = null;
    if (approvedWithDates.length > 0) {
      const totalDays = approvedWithDates.reduce((sum, e) => {
        const days = Math.floor(
          (new Date(e.effectiveDate!).getTime() - new Date(e.applicationDate!).getTime()) / (1000 * 60 * 60 * 24)
        );
        return sum + Math.max(0, days);
      }, 0);
      avgDaysToApproval = Math.round(totalDays / approvedWithDates.length);
    }

    // Avg days in current status (non-terminal statuses)
    const inFlight = payerEnrollments.filter(
      e => ['in_progress', 'submitted', 'pending_review'].includes(e.status)
    );
    let avgDaysInCurrentStatus: number | null = null;
    if (inFlight.length > 0) {
      const totalDays = inFlight.reduce((sum, e) => {
        return sum + Math.floor((now - new Date(e.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
      }, 0);
      avgDaysInCurrentStatus = Math.round(totalDays / inFlight.length);
    }

    // Stuck enrollments (>60 days in non-terminal status)
    const stuckOver60 = inFlight.filter(
      e => (now - new Date(e.updatedAt).getTime()) > sixtyDaysMs
    ).length;

    results.push({
      payerId: payer.id,
      payerName: payer.name,
      payerType: payer.payerType,
      totalEnrollments: total,
      activeEnrollments: active,
      approvalRate,
      denialRate,
      avgDaysToApproval,
      avgDaysInCurrentStatus,
      enrollmentsStuckOver60Days: stuckOver60,
      statusDistribution,
      insufficientData,
    });
  }

  // Sort by total enrollments descending, limit to 50 for the "all" case
  results.sort((a, b) => b.totalEnrollments - a.totalEnrollments);
  const finalResults = payerId ? results : results.slice(0, 50);
  setCache(cacheKey, finalResults, ANALYTICS_TTL);
  return finalResults;
}

// ===========================
// Leaderboard
// ===========================

export async function getPayerLeaderboard(): Promise<PayerLeaderboardItem[]> {
  const cachedBoard = getCached<PayerLeaderboardItem[]>('payer-analytics:leaderboard');
  if (cachedBoard) return cachedBoard;

  const analytics = await getPayerAnalytics();

  // Only rank payers with sufficient data
  const eligible = analytics.filter(a => !a.insufficientData);
  if (eligible.length === 0) return [];

  // Normalize metrics for scoring (0-1 range)
  const maxDays = Math.max(...eligible.map(a => a.avgDaysToApproval ?? 0), 1);
  const maxStuck = Math.max(...eligible.map(a => a.enrollmentsStuckOver60Days), 1);

  const scored: PayerLeaderboardItem[] = eligible.map(a => {
    const denialScore = (a.denialRate ?? 0) / 100; // 0-1
    const timeScore = (a.avgDaysToApproval ?? 0) / maxDays; // 0-1
    const stuckScore = a.enrollmentsStuckOver60Days / maxStuck; // 0-1
    // Lower approval rate = higher difficulty
    const approvalPenalty = 1 - ((a.approvalRate ?? 100) / 100); // 0-1

    const difficultyScore = Math.round(
      (denialScore * 0.3 + timeScore * 0.3 + stuckScore * 0.2 + approvalPenalty * 0.2) * 100
    );

    return {
      payerId: a.payerId,
      payerName: a.payerName,
      payerType: a.payerType,
      difficultyScore,
      approvalRate: a.approvalRate,
      denialRate: a.denialRate,
      avgDaysToApproval: a.avgDaysToApproval,
      totalEnrollments: a.totalEnrollments,
      stuckCount: a.enrollmentsStuckOver60Days,
    };
  });

  scored.sort((a, b) => b.difficultyScore - a.difficultyScore);
  setCache('payer-analytics:leaderboard', scored, ANALYTICS_TTL);
  return scored;
}

// ===========================
// AI Analysis
// ===========================

const PAYER_INTELLIGENCE_PROMPT = `You are an expert healthcare credentialing analyst. You help credentialing staff understand payer enrollment patterns and develop strategic approaches.

Given enrollment analytics data for a specific payer, provide a structured strategic assessment. Be specific, actionable, and grounded in the data provided. If sample sizes are small, note that in your assessment.

Always respond in valid JSON format as specified in each prompt.`;

export async function analyzePayerWithAI(
  payerId: string
): Promise<{ insight: PayerAIInsight; recommendation: { id: string } }> {
  const budget = await checkTokenBudget();
  if (!budget.allowed) {
    throw new Error(`Daily token budget exceeded. Used ${budget.used}/${budget.budget} tokens today.`);
  }

  // Get analytics for this payer
  const analytics = await getPayerAnalytics(payerId);
  if (analytics.length === 0) {
    throw new Error(`No enrollment data found for payer ${payerId}`);
  }
  const payer = analytics[0]!;

  // Get portfolio-wide averages for comparison
  const allAnalytics = await getPayerAnalytics();
  const withRates = allAnalytics.filter(a => a.approvalRate !== null);
  const portfolioAvgApproval = withRates.length > 0
    ? Math.round(withRates.reduce((sum, a) => sum + (a.approvalRate ?? 0), 0) / withRates.length)
    : null;
  const withDays = allAnalytics.filter(a => a.avgDaysToApproval !== null);
  const portfolioAvgDays = withDays.length > 0
    ? Math.round(withDays.reduce((sum, a) => sum + (a.avgDaysToApproval ?? 0), 0) / withDays.length)
    : null;

  const userMessage = `Analyze enrollment patterns for this payer and provide strategic recommendations:

**Payer:** ${payer.payerName} (Type: ${payer.payerType || 'Unknown'})
**Total Enrollments:** ${payer.totalEnrollments}
**Active Enrollments:** ${payer.activeEnrollments}
**Approval Rate:** ${payer.approvalRate !== null ? `${payer.approvalRate}%` : 'N/A (insufficient data)'}
**Denial Rate:** ${payer.denialRate !== null ? `${payer.denialRate}%` : 'N/A'}
**Avg Days to Approval:** ${payer.avgDaysToApproval !== null ? `${payer.avgDaysToApproval} days` : 'N/A'}
**Avg Days in Current Status:** ${payer.avgDaysInCurrentStatus !== null ? `${payer.avgDaysInCurrentStatus} days` : 'N/A'}
**Enrollments Stuck >60 Days:** ${payer.enrollmentsStuckOver60Days}
**Status Distribution:** ${JSON.stringify(payer.statusDistribution)}

**Portfolio Comparison:**
- Portfolio avg approval rate: ${portfolioAvgApproval !== null ? `${portfolioAvgApproval}%` : 'N/A'}
- Portfolio avg days to approval: ${portfolioAvgDays !== null ? `${portfolioAvgDays} days` : 'N/A'}

${payer.insufficientData ? '**NOTE:** This payer has fewer than 3 enrollments. Data may not be statistically representative.' : ''}

Respond with JSON only:
{
  "riskAssessment": "high|medium|low",
  "summary": "2-3 sentence overview of this payer's enrollment patterns",
  "strengths": ["what's working well with this payer"],
  "risks": ["areas of concern"],
  "recommendations": [
    {
      "action": "specific actionable recommendation",
      "priority": "high|medium|low",
      "reasoning": "why this matters"
    }
  ],
  "optimalFollowUpStrategy": {
    "frequencyDays": 14,
    "bestApproach": "description of what works for this payer type",
    "escalationThreshold": "when to escalate"
  },
  "comparisonInsight": "how this payer compares to portfolio average"
}`;

  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    system: PAYER_INTELLIGENCE_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  let parsed: PayerAIInsight;
  try {
    const jsonStr = textContent.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse AI response as JSON');
  }

  if (!parsed.riskAssessment || !parsed.summary || !Array.isArray(parsed.recommendations)) {
    throw new Error('AI response missing required fields (riskAssessment, summary, recommendations)');
  }

  // Re-check budget after API call
  const finalBudget = await checkTokenBudget();
  if (!finalBudget.allowed) {
    throw new Error('Daily token budget exceeded during concurrent request.');
  }

  const recommendation = await prisma.aiRecommendation.create({
    data: {
      type: 'payer_intelligence' as AiRecommendationType,
      status: 'pending' as AiRecommendationStatus,
      title: `Payer Analysis: ${payer.payerName}`,
      content: JSON.stringify(parsed),
      reasoning: parsed.summary,
      metadata: {
        payerId: payer.payerId,
        payerName: payer.payerName,
        riskAssessment: parsed.riskAssessment,
        approvalRate: payer.approvalRate,
        avgDaysToApproval: payer.avgDaysToApproval,
      },
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      modelUsed: AI_MODEL,
    },
  });

  logger.info(`AI payer analysis for ${payer.payerName}, recommendation ${recommendation.id}`);

  return { insight: parsed, recommendation: { id: recommendation.id } };
}

// ===========================
// Past Insights
// ===========================

export async function getPayerInsights(payerId: string) {
  return prisma.aiRecommendation.findMany({
    where: {
      type: 'payer_intelligence',
      metadata: { path: ['payerId'], equals: payerId },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
}
