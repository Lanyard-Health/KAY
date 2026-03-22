/**
 * Denial Triage Service
 *
 * When an enrollment status transitions to 'denied', this service:
 *   1. Searches the knowledge base for relevant payer requirements/rules
 *   2. Calls Claude to analyze the denial and produce a triage report
 *   3. Creates a DenialTriage record with recommended action
 *
 * Feature degrades gracefully if ANTHROPIC_API_KEY or OPENAI_API_KEY missing.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { searchSimilarWithSources } from './knowledgeBase.embedding.service.js';

// ─── Types ───────────────────────────────────────────────

export interface DenialTriageParams {
  enrollmentId: string;
  denialReason: string;
  denialDate?: Date;
}

export interface DenialTriageResult {
  triageCreated: boolean;
  triageId?: string;
  error?: string;
}

interface TriageAiResponse {
  recommendedAction: 'appeal' | 'reapply' | 'abandon' | 'needs_review';
  triageReport: string;
  identifiedGaps: Array<{ gap: string; severity: string; source?: string }>;
  recommendedSteps: Array<{ order: number; action: string; notes?: string }>;
}

// ─── AI Prompt ───────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a credentialing denial triage specialist for Lanyard Health. Your job is to analyze enrollment denials and recommend next steps.

You will receive:
1. The denial reason from the payer
2. Provider and payer context
3. Relevant knowledge base records about this payer's requirements, timelines, and rules

Analyze the denial and produce a JSON response with this exact structure:
{
  "recommendedAction": "appeal" | "reapply" | "abandon" | "needs_review",
  "triageReport": "A clear, concise narrative explaining the denial, likely root cause, and recommended path forward. 2-4 paragraphs.",
  "identifiedGaps": [
    { "gap": "description of a specific gap or missing requirement", "severity": "critical | major | minor", "source": "which KB record identified this" }
  ],
  "recommendedSteps": [
    { "order": 1, "action": "specific action to take", "notes": "additional context" }
  ]
}

Guidelines:
- "appeal" = denial appears incorrect or based on missing info that can be supplied
- "reapply" = application had real issues but they can be fixed for a new submission
- "abandon" = provider doesn't meet fundamental requirements for this payer/track
- "needs_review" = insufficient information to make a clear recommendation
- Be specific about gaps — reference payer requirements by name when possible
- Recommended steps should be actionable and ordered by priority
- If knowledge base context is limited, say so and recommend "needs_review"

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.`;

// ─── Core Logic ──────────────────────────────────────────

/**
 * Trigger denial triage for an enrollment.
 * Searches KB, calls AI, creates DenialTriage record.
 */
export async function triggerDenialTriage(
  prisma: PrismaClient,
  params: DenialTriageParams
): Promise<DenialTriageResult> {
  const { enrollmentId, denialReason, denialDate } = params;

  try {
    // 1. Fetch enrollment with provider and payer context
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        provider: { select: { firstName: true, lastName: true, npi: true, entityType: true, targetStates: true } },
        payer: { select: { name: true } },
        payerTrack: { select: { payerName: true, track: true, stateRegion: true, submissionMethod: true } },
      },
    });

    if (!enrollment) {
      return { triageCreated: false, error: 'Enrollment not found' };
    }

    // 2. Search knowledge base for relevant context
    const searchQuery = `${enrollment.payer.name} ${enrollment.payerTrack?.track || ''} ${enrollment.payerTrack?.stateRegion || ''} denial ${denialReason}`;
    let kbContext = '';

    try {
      const kbResults = await searchSimilarWithSources(searchQuery, 8);
      if (kbResults.length > 0) {
        kbContext = kbResults
          .map((r, i) => `[KB Record ${i + 1} (similarity: ${r.similarity.toFixed(3)})]:\n${r.contentText}`)
          .join('\n\n');
      }
    } catch (err) {
      logger.warn('Knowledge base search failed (embeddings may not be configured):', err);
      kbContext = 'Knowledge base search unavailable — embeddings not configured.';
    }

    // 3. Build AI prompt
    const userMessage = `## Denial Details
- **Payer**: ${enrollment.payer.name}
- **Track**: ${enrollment.payerTrack?.track || 'Unknown'}
- **State/Region**: ${enrollment.payerTrack?.stateRegion || 'Unknown'}
- **Submission Method**: ${enrollment.payerTrack?.submissionMethod || 'Unknown'}
- **Denial Reason**: ${denialReason}

## Provider Context
- **Name**: ${enrollment.provider.firstName} ${enrollment.provider.lastName}
- **NPI**: ${enrollment.provider.npi}
- **Entity Type**: ${enrollment.provider.entityType || 'Unknown'}

## Relevant Knowledge Base Records
${kbContext || 'No relevant knowledge base records found.'}

Analyze this denial and provide your triage assessment as JSON.`;

    // 4. Call Anthropic AI
    let triageResponse: TriageAiResponse;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let modelUsed: string | null = null;

    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const apiKey = process.env['ANTHROPIC_API_KEY'];

      if (!apiKey) {
        // No AI — create a basic triage record with needs_review
        logger.warn('ANTHROPIC_API_KEY not set — creating basic denial triage without AI analysis');
        triageResponse = {
          recommendedAction: 'needs_review',
          triageReport: `Enrollment denied by ${enrollment.payer.name}. Reason: ${denialReason}. AI analysis unavailable — manual review required.`,
          identifiedGaps: [],
          recommendedSteps: [{ order: 1, action: 'Review denial reason and payer requirements manually', notes: 'AI triage unavailable' }],
        };
      } else {
        const client = new Anthropic({ apiKey });
        const aiModel = process.env['AI_MODEL'] || 'claude-sonnet-4-20250514';

        const response = await client.messages.create({
          model: aiModel,
          max_tokens: 2000,
          system: TRIAGE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        });

        const textContent = response.content.find((c) => c.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          throw new Error('No text response from AI');
        }

        const jsonStr = textContent.text
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();

        triageResponse = JSON.parse(jsonStr) as TriageAiResponse;
        promptTokens = response.usage.input_tokens;
        completionTokens = response.usage.output_tokens;
        modelUsed = aiModel;
      }
    } catch (aiErr) {
      logger.error('AI triage generation failed:', aiErr);
      triageResponse = {
        recommendedAction: 'needs_review',
        triageReport: `Enrollment denied by ${enrollment.payer.name}. Reason: ${denialReason}. AI analysis failed — manual review required.`,
        identifiedGaps: [],
        recommendedSteps: [{ order: 1, action: 'Review denial reason and payer requirements manually', notes: 'AI triage failed' }],
      };
    }

    // 5. Create DenialTriage record
    const triage = await prisma.denialTriage.create({
      data: {
        enrollmentId,
        denialReason,
        denialDate: denialDate || new Date(),
        triageReport: triageResponse.triageReport,
        identifiedGaps: triageResponse.identifiedGaps as any,
        recommendedAction: triageResponse.recommendedAction,
        recommendedSteps: triageResponse.recommendedSteps as any,
        status: 'pending',
        reviewedBy: '',
        promptTokens,
        completionTokens,
        modelUsed,
      },
    });

    logger.info(`Denial triage created for enrollment ${enrollmentId}: ${triage.id} (action: ${triageResponse.recommendedAction})`);

    return { triageCreated: true, triageId: triage.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Denial triage failed for enrollment ${enrollmentId}: ${message}`);
    return { triageCreated: false, error: message };
  }
}
