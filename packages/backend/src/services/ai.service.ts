import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import type { AiRecommendationType, AiRecommendationStatus } from '@prisma/client';

const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
const AI_MODEL = process.env['AI_MODEL'] || 'claude-sonnet-4-20250514';
const AI_DAILY_TOKEN_BUDGET = parseInt(process.env['AI_DAILY_TOKEN_BUDGET'] || '100000', 10);

let client: Anthropic | null = null;

export function sanitizeUserInput(input: string, maxLength = 500): string {
  return input
    .replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, '[redacted]')
    .replace(/\b(system|assistant)\s*:/gi, '[redacted]')
    .replace(/```/g, '')
    .slice(0, maxLength)
    .trim();
}

function getClient(): Anthropic {
  if (!client) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return client;
}

// ===========================
// Configuration
// ===========================

export function isConfigured(): boolean {
  return !!ANTHROPIC_API_KEY;
}

export function getModelInfo() {
  return {
    configured: isConfigured(),
    model: AI_MODEL,
    dailyTokenBudget: AI_DAILY_TOKEN_BUDGET,
  };
}

// ===========================
// Token Budget
// ===========================

export async function getTodayTokenUsage() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const result = await prisma.aiRecommendation.aggregate({
    where: {
      createdAt: { gte: startOfDay },
    },
    _sum: {
      promptTokens: true,
      completionTokens: true,
    },
  });

  const promptTokens = result._sum.promptTokens || 0;
  const completionTokens = result._sum.completionTokens || 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export async function checkTokenBudget() {
  const usage = await getTodayTokenUsage();
  const remaining = AI_DAILY_TOKEN_BUDGET - usage.totalTokens;

  return {
    allowed: remaining > 0,
    used: usage.totalTokens,
    budget: AI_DAILY_TOKEN_BUDGET,
    remaining: Math.max(0, remaining),
  };
}

// ===========================
// System Prompt
// ===========================

const SYSTEM_PROMPT = `You are an expert healthcare credentialing coordinator with deep knowledge of payer enrollment processes, follow-up strategies, and industry best practices.

Your role is to help credentialing staff at a behavioral health practice manage their payer enrollment pipeline effectively. You provide:

1. **Follow-up email drafts** — Professional, context-aware emails to payers about enrollment applications. You adjust tone based on follow-up count:
   - 1st follow-up: Polite check-in, professional introduction
   - 2nd follow-up: Friendly reminder with gentle urgency
   - 3rd follow-up: More assertive, referencing timeline and impact
   - 4th follow-up: Firm but professional, requesting specific escalation path
   - 5th+ follow-up: Requesting supervisor contact, documenting pattern of delays

2. **Strategy recommendations** — Actionable advice for moving enrollments forward, identifying bottlenecks, and suggesting alternative approaches.

3. **Priority assessments** — Urgency scores (1-10) based on enrollment age, revenue impact, patient access needs, and payer responsiveness patterns.

Always respond in valid JSON format as specified in each prompt. Be specific, actionable, and grounded in healthcare credentialing best practices.`;

// ===========================
// Email Generation
// ===========================

interface GenerateEmailOptions {
  tone?: 'polite' | 'assertive' | 'urgent';
  additionalContext?: string;
}

interface GeneratedEmail {
  subject: string;
  body: string;
  htmlBody: string;
  tone: string;
  escalationLevel: number;
}

export async function generateFollowUpEmail(
  enrollmentId: string,
  options?: GenerateEmailOptions
): Promise<{ email: GeneratedEmail; recommendation: { id: string } }> {
  const budget = await checkTokenBudget();
  if (!budget.allowed) {
    throw new Error(`Daily token budget exceeded. Used ${budget.used}/${budget.budget} tokens today.`);
  }

  const enrollment = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      provider: true,
      payer: true,
    },
  });

  if (!enrollment) {
    throw new Error(`Enrollment ${enrollmentId} not found`);
  }

  const followUpCount = await estimateFollowUpCount(enrollment);

  const daysSinceApplication = enrollment.applicationDate
    ? Math.floor((Date.now() - new Date(enrollment.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const daysSinceLastFollowUp = enrollment.lastFollowUpDate
    ? Math.floor((Date.now() - new Date(enrollment.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const userMessage = `Generate a follow-up email for this enrollment:

**Provider:** ${enrollment.provider.firstName} ${enrollment.provider.lastName}, ${enrollment.provider.providerType}
**NPI:** ${enrollment.provider.npi}
**Payer:** ${enrollment.payer.name} (ID: ${enrollment.payer.payerId})
**Enrollment Status:** ${enrollment.status}
**Product Types:** ${enrollment.productTypes.join(', ') || 'Not specified'}
**Application Date:** ${enrollment.applicationDate ? new Date(enrollment.applicationDate).toLocaleDateString() : 'Not recorded'}
**Days Since Application:** ${daysSinceApplication ?? 'Unknown'}
**Last Follow-Up:** ${enrollment.lastFollowUpDate ? new Date(enrollment.lastFollowUpDate).toLocaleDateString() : 'Never'}
**Days Since Last Follow-Up:** ${daysSinceLastFollowUp ?? 'N/A'}
**Follow-Up Count (estimated):** ${followUpCount}
**Provider Number:** ${enrollment.providerNumber || 'Not yet assigned'}
**Follow-Up Email Contact:** ${enrollment.followUpEmail || 'Not specified'}
${options?.additionalContext ? `**Additional Context:** ${sanitizeUserInput(options.additionalContext)}` : ''}
${options?.tone ? `**Requested Tone:** ${options.tone}` : ''}

Respond with JSON only:
{
  "subject": "Email subject line",
  "body": "Plain text email body",
  "htmlBody": "HTML formatted email body with proper paragraph tags",
  "tone": "polite|assertive|urgent",
  "escalationLevel": 1-5,
  "reasoning": "Brief explanation of your approach and tone choice"
}`;

  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  let parsed: GeneratedEmail & { reasoning?: string };
  try {
    const jsonStr = textContent.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse AI response as JSON');
  }

  if (!parsed.subject || !parsed.body || !parsed.htmlBody || !parsed.tone) {
    throw new Error('AI response missing required email fields (subject, body, htmlBody, tone)');
  }

  // Re-check budget after API call to guard against concurrent requests
  const finalBudget = await checkTokenBudget();
  if (!finalBudget.allowed) {
    throw new Error('Daily token budget exceeded during concurrent request.');
  }

  const recommendation = await prisma.aiRecommendation.create({
    data: {
      enrollmentId,
      type: 'follow_up_email' as AiRecommendationType,
      status: 'pending' as AiRecommendationStatus,
      title: parsed.subject,
      content: JSON.stringify({ subject: parsed.subject, body: parsed.body, htmlBody: parsed.htmlBody }),
      reasoning: parsed.reasoning || null,
      metadata: {
        tone: parsed.tone,
        escalationLevel: parsed.escalationLevel,
        followUpCount,
        options: options ? { tone: options.tone ?? null, additionalContext: options.additionalContext ?? null } : {},
      },
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      modelUsed: AI_MODEL,
    },
  });

  logger.info(`AI email generated for enrollment ${enrollmentId}, recommendation ${recommendation.id}`);

  return {
    email: {
      subject: parsed.subject,
      body: parsed.body,
      htmlBody: parsed.htmlBody,
      tone: parsed.tone,
      escalationLevel: parsed.escalationLevel,
    },
    recommendation: { id: recommendation.id },
  };
}

// ===========================
// Enrollment Analysis
// ===========================

interface EnrollmentAnalysis {
  urgencyScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
  nextSteps: string[];
  reasoning: string;
}

export async function analyzeEnrollment(enrollmentId: string): Promise<{ analysis: EnrollmentAnalysis; recommendation: { id: string } }> {
  const budget = await checkTokenBudget();
  if (!budget.allowed) {
    throw new Error(`Daily token budget exceeded. Used ${budget.used}/${budget.budget} tokens today.`);
  }

  const enrollment = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { provider: true, payer: true },
  });

  if (!enrollment) {
    throw new Error(`Enrollment ${enrollmentId} not found`);
  }

  const daysSinceApplication = enrollment.applicationDate
    ? Math.floor((Date.now() - new Date(enrollment.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const daysSinceLastFollowUp = enrollment.lastFollowUpDate
    ? Math.floor((Date.now() - new Date(enrollment.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const userMessage = `Analyze this enrollment and provide strategy recommendations:

**Provider:** ${enrollment.provider.firstName} ${enrollment.provider.lastName}, ${enrollment.provider.providerType}
**NPI:** ${enrollment.provider.npi}
**Payer:** ${enrollment.payer.name} (ID: ${enrollment.payer.payerId})
**Enrollment Status:** ${enrollment.status}
**Product Types:** ${enrollment.productTypes.join(', ') || 'Not specified'}
**Application Date:** ${enrollment.applicationDate ? new Date(enrollment.applicationDate).toLocaleDateString() : 'Not recorded'}
**Days Since Application:** ${daysSinceApplication ?? 'Unknown'}
**Effective Date:** ${enrollment.effectiveDate ? new Date(enrollment.effectiveDate).toLocaleDateString() : 'Not yet set'}
**Last Follow-Up:** ${enrollment.lastFollowUpDate ? new Date(enrollment.lastFollowUpDate).toLocaleDateString() : 'Never'}
**Days Since Last Follow-Up:** ${daysSinceLastFollowUp ?? 'N/A'}
**Provider Number:** ${enrollment.providerNumber || 'Not yet assigned'}
**Notes:** ${enrollment.notes || 'None'}

Respond with JSON only:
{
  "urgencyScore": 1-10,
  "riskLevel": "low|medium|high|critical",
  "recommendations": ["actionable recommendation 1", "..."],
  "nextSteps": ["specific next step 1", "..."],
  "reasoning": "Detailed explanation of your assessment"
}`;

  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  let parsed: EnrollmentAnalysis;
  try {
    const jsonStr = textContent.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse AI response as JSON');
  }

  if (typeof parsed.urgencyScore !== 'number' || !parsed.riskLevel || !Array.isArray(parsed.recommendations)) {
    throw new Error('AI response missing required analysis fields (urgencyScore, riskLevel, recommendations)');
  }

  // Re-check budget after API call to guard against concurrent requests
  const finalBudget = await checkTokenBudget();
  if (!finalBudget.allowed) {
    throw new Error('Daily token budget exceeded during concurrent request.');
  }

  const recommendation = await prisma.aiRecommendation.create({
    data: {
      enrollmentId,
      type: 'strategy' as AiRecommendationType,
      status: 'pending' as AiRecommendationStatus,
      title: `Strategy: ${enrollment.payer.name} - ${enrollment.provider.lastName}`,
      content: JSON.stringify(parsed),
      reasoning: parsed.reasoning,
      metadata: { urgencyScore: parsed.urgencyScore, riskLevel: parsed.riskLevel },
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      modelUsed: AI_MODEL,
    },
  });

  logger.info(`AI analysis for enrollment ${enrollmentId}, recommendation ${recommendation.id}`);

  return { analysis: parsed, recommendation: { id: recommendation.id } };
}

// ===========================
// Portfolio Analysis
// ===========================

interface PortfolioItem {
  enrollmentId: string;
  providerName: string;
  payerName: string;
  status: string;
  urgencyScore: number;
  riskLevel: string;
  recommendation: string;
  daysSinceApplication: number | null;
  daysSinceLastFollowUp: number | null;
}

interface PortfolioAnalysis {
  enrollments: PortfolioItem[];
  summary: string;
}

export async function analyzePortfolio(): Promise<{ analysis: PortfolioAnalysis; recommendation: { id: string } | null }> {
  const budget = await checkTokenBudget();
  if (!budget.allowed) {
    throw new Error(`Daily token budget exceeded. Used ${budget.used}/${budget.budget} tokens today.`);
  }

  const enrollments = await prisma.payerEnrollment.findMany({
    where: {
      status: { in: ['not_started', 'in_progress', 'submitted', 'pending_review'] },
    },
    include: { provider: true, payer: true },
    orderBy: { createdAt: 'asc' },
  });

  if (enrollments.length === 0) {
    return {
      analysis: { enrollments: [], summary: 'No active enrollments to analyze.' },
      recommendation: null,
    };
  }

  const enrollmentSummaries = enrollments.map((e, i) => {
    const daysSinceApp = e.applicationDate
      ? Math.floor((Date.now() - new Date(e.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const daysSinceFollowUp = e.lastFollowUpDate
      ? Math.floor((Date.now() - new Date(e.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return `${i + 1}. [${e.id}] ${e.provider.firstName} ${e.provider.lastName} (${e.provider.providerType}) → ${e.payer.name} | Status: ${e.status} | Applied: ${daysSinceApp ?? '?'} days ago | Last follow-up: ${daysSinceFollowUp ?? 'never'} days ago | Products: ${e.productTypes.join(', ') || 'N/A'}`;
  });

  const userMessage = `Analyze this portfolio of active enrollments and rank them by urgency. For each, provide an urgency score and one-line recommendation.

ENROLLMENTS:
${enrollmentSummaries.join('\n')}

Respond with JSON only:
{
  "enrollments": [
    {
      "enrollmentId": "the enrollment id from brackets above",
      "urgencyScore": 1-10,
      "riskLevel": "low|medium|high|critical",
      "recommendation": "One-line action recommendation"
    }
  ],
  "summary": "Brief overall portfolio assessment (2-3 sentences)"
}`;

  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI');
  }

  let parsed: { enrollments: { enrollmentId: string; urgencyScore: number; riskLevel: string; recommendation: string }[]; summary: string };
  try {
    const jsonStr = textContent.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse AI response as JSON');
  }

  if (!Array.isArray(parsed.enrollments) || typeof parsed.summary !== 'string') {
    throw new Error('AI response missing required portfolio fields (enrollments array, summary)');
  }

  // Re-check budget after API call to guard against concurrent requests
  const finalBudget = await checkTokenBudget();
  if (!finalBudget.allowed) {
    throw new Error('Daily token budget exceeded during concurrent request.');
  }

  const enrichedEnrollments: PortfolioItem[] = [];
  for (const aiItem of parsed.enrollments) {
    const enrollment = enrollments.find((e) => e.id === aiItem.enrollmentId);
    if (!enrollment) continue;

    const daysSinceApp = enrollment.applicationDate
      ? Math.floor((Date.now() - new Date(enrollment.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const daysSinceFollowUp = enrollment.lastFollowUpDate
      ? Math.floor((Date.now() - new Date(enrollment.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    enrichedEnrollments.push({
      enrollmentId: enrollment.id,
      providerName: `${enrollment.provider.firstName} ${enrollment.provider.lastName}`,
      payerName: enrollment.payer.name,
      status: enrollment.status as string,
      urgencyScore: aiItem.urgencyScore,
      riskLevel: aiItem.riskLevel,
      recommendation: aiItem.recommendation,
      daysSinceApplication: daysSinceApp,
      daysSinceLastFollowUp: daysSinceFollowUp,
    });
  }
  enrichedEnrollments.sort((a, b) => b.urgencyScore - a.urgencyScore);

  let savedRec: { id: string } | null = null;
  const firstEnrollment = enrollments[0];
  if (firstEnrollment) {
    const rec = await prisma.aiRecommendation.create({
      data: {
        enrollmentId: firstEnrollment.id,
        type: 'priority_alert' as AiRecommendationType,
        status: 'pending' as AiRecommendationStatus,
        title: 'Portfolio Priority Analysis',
        content: JSON.stringify({ enrollments: enrichedEnrollments, summary: parsed.summary }),
        reasoning: parsed.summary,
        metadata: {
          enrollmentCount: enrollments.length,
          highUrgencyCount: enrichedEnrollments.filter((e) => e.urgencyScore >= 7).length,
        },
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        modelUsed: AI_MODEL,
      },
    });
    savedRec = { id: rec.id };
  }

  // Create per-enrollment alerts for high urgency items
  const highUrgencyItems = enrichedEnrollments.filter(e => e.urgencyScore >= 7);
  if (highUrgencyItems.length > 0) {
    await prisma.aiRecommendation.createMany({
      data: highUrgencyItems.map(item => ({
        enrollmentId: item.enrollmentId,
        type: 'priority_alert' as AiRecommendationType,
        status: 'pending' as AiRecommendationStatus,
        title: `Priority: ${item.providerName} → ${item.payerName} (${item.urgencyScore}/10)`,
        content: JSON.stringify({
          urgencyScore: item.urgencyScore,
          riskLevel: item.riskLevel,
          recommendation: item.recommendation,
          daysSinceApplication: item.daysSinceApplication,
          daysSinceLastFollowUp: item.daysSinceLastFollowUp,
        }),
        reasoning: item.recommendation,
        metadata: { urgencyScore: item.urgencyScore, riskLevel: item.riskLevel },
        promptTokens: 0,
        completionTokens: 0,
        modelUsed: AI_MODEL,
      })),
    });
  }

  logger.info(`AI portfolio analysis complete: ${enrichedEnrollments.length} enrollments ranked`);

  return {
    analysis: { enrollments: enrichedEnrollments, summary: parsed.summary },
    recommendation: savedRec,
  };
}

// ===========================
// Recommendations CRUD
// ===========================

export async function getRecommendations(filters?: {
  type?: AiRecommendationType;
  status?: AiRecommendationStatus;
  enrollmentId?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.type) where['type'] = filters.type;
  if (filters?.status) where['status'] = filters.status;
  if (filters?.enrollmentId) where['enrollmentId'] = filters.enrollmentId;

  return prisma.aiRecommendation.findMany({
    where,
    include: {
      enrollment: {
        include: {
          provider: { select: { firstName: true, lastName: true, npi: true } },
          payer: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function updateRecommendationStatus(
  id: string,
  status: 'accepted' | 'dismissed',
  actedOnBy?: string
) {
  return prisma.aiRecommendation.update({
    where: { id },
    data: {
      status: status as AiRecommendationStatus,
      actedOnBy: actedOnBy || null,
      actedOnAt: new Date(),
    },
  });
}

// ===========================
// Helpers
// ===========================

async function estimateFollowUpCount(enrollment: {
  id: string;
  lastFollowUpDate: Date | null;
  applicationDate: Date | null;
  followUpFrequencyDays: number;
}): Promise<number> {
  const aiEmailCount = await prisma.aiRecommendation.count({
    where: { enrollmentId: enrollment.id, type: 'follow_up_email' },
  });

  if (aiEmailCount > 0) return aiEmailCount + 1;

  if (!enrollment.applicationDate || !enrollment.lastFollowUpDate) return 1;

  const daysSinceApp = Math.floor(
    (Date.now() - new Date(enrollment.applicationDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  return Math.max(1, Math.ceil(daysSinceApp / enrollment.followUpFrequencyDays));
}
