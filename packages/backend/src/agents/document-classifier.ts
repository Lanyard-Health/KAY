import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { callLLM } from '../utils/llm.js';

const VALID_DOCUMENT_TYPES = [
  'license', 'board_certification', 'malpractice_certificate',
  'diploma', 'transcript', 'cv_resume', 'photo', 'government_id',
  'dea_certificate', 'cds_certificate', 'cme_certificate',
  'hospital_letter', 'reference_letter', 'w9', 'coi', 'cp575', 'other',
] as const;

type DocumentType = (typeof VALID_DOCUMENT_TYPES)[number];

export interface ClassifyInput {
  textContent?: string;
  imageBase64?: string;
  mimeType: string;
}

const SYSTEM_PROMPT = `You are a healthcare credentialing document classifier. Given document content, respond with EXACTLY ONE of these document types (nothing else):
license, board_certification, malpractice_certificate, diploma, transcript, cv_resume, photo, government_id, dea_certificate, cds_certificate, cme_certificate, hospital_letter, reference_letter, w9, coi, cp575, other

Respond with only the type name, no explanation.`;

/**
 * Uses Claude Haiku to classify a document into a DocumentType.
 * Returns 'other' if classification fails or is unrecognized.
 */
export async function classifyDocumentType(input: ClassifyInput): Promise<DocumentType> {
  try {
    const userContent: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    if (input.imageBase64) {
      const mediaType = input.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: input.imageBase64 },
      });
      userContent.push({ type: 'text', text: 'What type of healthcare credential document is this?' });
    } else if (input.textContent) {
      userContent.push({
        type: 'text',
        text: `Classify this document:\n\n${input.textContent.slice(0, 2000)}`,
      });
    } else {
      return 'other';
    }

    const response = await callLLM({
      model: process.env['AI_MODEL_CLASSIFIER'] || 'claude-haiku-4-5-20251001',
      maxTokens: 50,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = response.text.trim().toLowerCase();
    const cleaned = text.replace(/[^a-z_]/g, '') as DocumentType;

    if (VALID_DOCUMENT_TYPES.includes(cleaned)) {
      logger.info(`Document classified as: ${cleaned}`);
      return cleaned;
    }

    logger.warn(`Unrecognized classification: "${text}", defaulting to "other"`);
    return 'other';
  } catch (err) {
    logger.error('Document classification failed', { error: (err as Error).message });
    return 'other';
  }
}
