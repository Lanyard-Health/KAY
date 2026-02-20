import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../utils/logger.js';

export interface ExtractedField {
  value: string;
  confidence: number;
}

export interface VisionExtractionResult {
  fields: Record<string, ExtractedField>;
  averageConfidence: number;
}

export interface VisionExtractionInput {
  imageBase64: string;
  mimeType: string;
  documentType: string;
  extractionHints?: string[];
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

const FIELD_HINTS: Record<string, string[]> = {
  license: ['licenseNumber', 'licenseType', 'state', 'issueDate', 'expirationDate', 'holderName', 'npi'],
  board_certification: ['certificationNumber', 'boardName', 'specialty', 'initialCertificationDate', 'expirationDate', 'holderName'],
  malpractice_certificate: ['policyNumber', 'carrierName', 'coverageType', 'perClaimAmount', 'aggregateAmount', 'effectiveDate', 'expirationDate', 'holderName'],
  dea_certificate: ['deaNumber', 'schedules', 'state', 'issueDate', 'expirationDate', 'holderName'],
  diploma: ['institutionName', 'degree', 'fieldOfStudy', 'graduationDate', 'holderName'],
  cme_certificate: ['courseName', 'courseProvider', 'credits', 'creditType', 'completionDate', 'holderName'],
};

function buildPrompt(documentType: string, hints?: string[]): string {
  const fields = hints ?? FIELD_HINTS[documentType] ?? [];
  const fieldList = fields.length > 0 ? `Expected fields: ${fields.join(', ')}` : 'Extract all visible credential fields.';

  return `Extract credential information from this ${documentType.replace(/_/g, ' ')} document image.

${fieldList}

Respond ONLY with valid JSON in this exact format:
{
  "fields": {
    "fieldName": { "value": "extracted value", "confidence": 0.95 }
  }
}

Rules:
- confidence: 0.0-1.0 based on how clearly you can read the value
- Dates in YYYY-MM-DD format
- Currency as numbers without $ or commas
- If a field is not visible, omit it
- Do NOT guess values — only extract what you can see`;
}

/**
 * Extracts credential fields from a document image using Claude Vision.
 * Returns structured fields with per-field confidence scores.
 */
export async function extractWithVision(input: VisionExtractionInput): Promise<VisionExtractionResult> {
  try {
    const anthropic = getClient();
    const mediaType = input.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const response = await anthropic.messages.create({
      model: process.env['AI_MODEL'] || 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: input.imageBase64 },
          },
          {
            type: 'text',
            text: buildPrompt(input.documentType, input.extractionHints),
          },
        ],
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Vision extractor: no JSON found in response');
      return { fields: {}, averageConfidence: 0 };
    }

    const parsed = JSON.parse(jsonMatch[0]) as { fields: Record<string, ExtractedField> };
    const fields = parsed.fields || {};

    // Calculate average confidence
    const values = Object.values(fields);
    const averageConfidence = values.length > 0
      ? values.reduce((sum, f) => sum + f.confidence, 0) / values.length
      : 0;

    logger.info(`Vision extracted ${values.length} fields, avg confidence: ${averageConfidence.toFixed(3)}`);

    return { fields, averageConfidence };
  } catch (err) {
    if ((err as Error).message?.includes('JSON')) {
      logger.warn('Vision extractor: invalid JSON in response');
      return { fields: {}, averageConfidence: 0 };
    }
    logger.error('Vision extraction failed', { error: (err as Error).message });
    throw new Error(`Vision extraction failed: ${(err as Error).message}`);
  }
}
