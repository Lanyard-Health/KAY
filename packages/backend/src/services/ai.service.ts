import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import type { AiRecommendationType, AiRecommendationStatus } from '@prisma/client';

const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
const AI_MODEL = process.env['AI_MODEL'] || 'claude-sonnet-4-20250514';
const AI_DAILY_TOKEN_BUDGET = parseInt(process.env['AI_DAILY_TOKEN_BUDGET'] || '100000', 10);

let client: Anthropic | null = null;

export function sanitizeUserInput(input: string, maxLength = 500): string {
  // Bound input length BEFORE running regexes to prevent ReDoS on adversarial strings
  const bounded = input.slice(0, maxLength);
  return bounded
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded input (max 500 chars) limits backtracking; non-capturing groups reduce paths
    .replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|rules?)\b/gi, '[redacted]')
    .replace(/\b(?:system|assistant)\s*:/gi, '[redacted]')
    .replace(/```/g, '')
    .trim();
}

export function getClient(): Anthropic {
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

  const [recResult, chatResult] = await Promise.all([
    prisma.aiRecommendation.aggregate({
      where: { createdAt: { gte: startOfDay } },
      _sum: { promptTokens: true, completionTokens: true },
    }),
    prisma.chatMessage.aggregate({
      where: { role: 'assistant', createdAt: { gte: startOfDay } },
      _sum: { promptTokens: true, completionTokens: true },
    }),
  ]);

  const promptTokens = (recResult._sum.promptTokens || 0) + (chatResult._sum.promptTokens || 0);
  const completionTokens = (recResult._sum.completionTokens || 0) + (chatResult._sum.completionTokens || 0);

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
  providerId?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.type) where['type'] = filters.type;
  if (filters?.status) where['status'] = filters.status;
  if (filters?.enrollmentId) where['enrollmentId'] = filters.enrollmentId;
  if (filters?.providerId) where['providerId'] = filters.providerId;

  return prisma.aiRecommendation.findMany({
    where,
    include: {
      enrollment: {
        include: {
          provider: { select: { firstName: true, lastName: true, npi: true } },
          payer: { select: { name: true } },
        },
      },
      provider: {
        select: { id: true, firstName: true, lastName: true, npi: true },
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
// Expiration Alerts
// ===========================

interface ExpirationAlertResult {
  generated: number;
  skipped: number;
  providersProcessed: number;
  errors: string[];
}

const EXPIRATION_ALERT_SYSTEM_PROMPT = `You are an expert healthcare credentialing coordinator. You help credentialing staff manage credential renewals proactively.

When given a list of expiring credentials for a provider, generate a clear, actionable alert for each credential with:
- A concise title describing what's expiring
- Specific renewal guidance (steps to take, typical timelines, common pitfalls)
- An urgency score from 1-10 based on days until expiration and credential importance

Always respond in valid JSON format as specified in each prompt. Be specific and actionable.`;

export async function generateExpirationAlerts(
  days: number = 90
): Promise<ExpirationAlertResult> {
  const budget = await checkTokenBudget();
  if (!budget.allowed) {
    logger.info('[ExpirationAlerts] Token budget exhausted, skipping');
    return { generated: 0, skipped: 0, providersProcessed: 0, errors: ['Token budget exhausted'] };
  }

  // Reuse the expiration service to get upcoming expirations
  const { ExpirationService } = await import('./expiration.service.js');
  const expirationService = new ExpirationService();
  const expirations = await expirationService.getUpcomingExpirations(days);

  if (expirations.length === 0) {
    logger.info('[ExpirationAlerts] No upcoming expirations found');
    return { generated: 0, skipped: 0, providersProcessed: 0, errors: [] };
  }

  // Group by provider
  const byProvider = new Map<string, typeof expirations>();
  for (const exp of expirations) {
    const existing = byProvider.get(exp.providerId) || [];
    existing.push(exp);
    byProvider.set(exp.providerId, existing);
  }

  let generated = 0;
  let skipped = 0;
  let providersProcessed = 0;
  const errors: string[] = [];

  for (const [providerId, providerExpirations] of byProvider) {
    // Check budget before each provider
    const currentBudget = await checkTokenBudget();
    if (!currentBudget.allowed) {
      logger.info('[ExpirationAlerts] Token budget exhausted mid-run, stopping');
      errors.push('Token budget exhausted mid-run');
      break;
    }

    try {
      // Dedup: find existing pending priority_alert recommendations for this provider
      const existingAlerts = await prisma.aiRecommendation.findMany({
        where: {
          providerId,
          type: 'priority_alert',
          status: 'pending',
        },
        select: { metadata: true },
      });

      const existingCredentialIds = new Set<string>();
      for (const alert of existingAlerts) {
        const meta = alert.metadata as Record<string, unknown> | null;
        const credId = meta?.['credentialId'];
        if (credId && typeof credId === 'string') {
          existingCredentialIds.add(credId);
        }
      }

      // Filter out credentials that already have pending alerts
      const newExpirations = providerExpirations.filter(
        (exp) => !existingCredentialIds.has(exp.id)
      );

      if (newExpirations.length === 0) {
        skipped += providerExpirations.length;
        continue;
      }

      // Build prompt for this provider
      const credentialList = newExpirations
        .map(
          (exp, i) =>
            `${i + 1}. [${exp.id}] ${exp.type}: ${exp.name} — expires ${exp.expirationDate.toLocaleDateString()} (${exp.daysUntilExpiration} days)`
        )
        .join('\n');

      const userMessage = `Generate renewal alerts for the following expiring credentials for provider ${newExpirations[0]!.providerName}:

${credentialList}

Respond with JSON only:
{
  "alerts": [
    {
      "credentialId": "the credential id from brackets above",
      "title": "Short alert title",
      "content": "Specific renewal guidance and action steps",
      "reasoning": "Brief explanation of urgency",
      "urgencyScore": 1-10
    }
  ]
}`;

      const anthropic = getClient();
      const response = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 1500,
        system: EXPIRATION_ALERT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        errors.push(`No text response for provider ${providerId}`);
        continue;
      }

      let parsed: {
        alerts: Array<{
          credentialId: string;
          title: string;
          content: string;
          reasoning: string;
          urgencyScore: number;
        }>;
      };
      try {
        const jsonStr = textContent.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(jsonStr);
      } catch {
        errors.push(`Failed to parse AI response for provider ${providerId}`);
        continue;
      }

      if (!Array.isArray(parsed.alerts)) {
        errors.push(`Invalid response structure for provider ${providerId}`);
        continue;
      }

      // Create recommendations for each alert
      const tokensPerAlert = {
        prompt: Math.ceil(response.usage.input_tokens / parsed.alerts.length),
        completion: Math.ceil(response.usage.output_tokens / parsed.alerts.length),
      };

      for (const alert of parsed.alerts) {
        // Find the matching expiration to get metadata
        const matchingExp = newExpirations.find((e) => e.id === alert.credentialId);
        if (!matchingExp) continue;

        await prisma.aiRecommendation.create({
          data: {
            providerId,
            enrollmentId: null,
            type: 'priority_alert' as AiRecommendationType,
            status: 'pending' as AiRecommendationStatus,
            title: alert.title,
            content: alert.content,
            reasoning: alert.reasoning,
            metadata: {
              credentialId: matchingExp.id,
              credentialType: matchingExp.type,
              credentialName: matchingExp.name,
              expirationDate: matchingExp.expirationDate.toISOString(),
              daysUntilExpiration: matchingExp.daysUntilExpiration,
              urgencyScore: alert.urgencyScore,
            },
            promptTokens: tokensPerAlert.prompt,
            completionTokens: tokensPerAlert.completion,
            modelUsed: AI_MODEL,
          },
        });
        generated++;
      }

      skipped += providerExpirations.length - newExpirations.length;
      providersProcessed++;

      logger.info(
        `[ExpirationAlerts] Provider ${providerId}: ${parsed.alerts.length} alerts generated, ${providerExpirations.length - newExpirations.length} skipped (dedup)`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Provider ${providerId}: ${message}`);
      logger.error(`[ExpirationAlerts] Error processing provider ${providerId}:`, err);
    }
  }

  logger.info(
    `[ExpirationAlerts] Complete: ${generated} generated, ${skipped} skipped, ${providersProcessed} providers processed`
  );

  return { generated, skipped, providersProcessed, errors };
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
