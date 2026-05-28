import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { Prisma } from '@prisma/client';

const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];
const EMBEDDING_MODEL = process.env['EMBEDDING_MODEL'] || 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

export const VALID_EMBEDDING_COLUMNS = new Set([
  'payer_track_id',
  'payer_timeline_id',
  'payer_state_rule_id',
  'payer_form_id',
  'payer_requirement_id',
  'requirement_universal_id',
]);

// Source types map to the FK columns on KnowledgeBaseEmbedding
export type EmbeddingSourceType =
  | 'payerTrack'
  | 'payerRequirement'
  | 'payerStateRule'
  | 'payerTimeline'
  | 'payerForm'
  | 'requirementUniversal';

const SOURCE_TYPE_TO_COLUMN: Record<EmbeddingSourceType, string> = {
  payerTrack: 'payer_track_id',
  payerRequirement: 'payer_requirement_id',
  payerStateRule: 'payer_state_rule_id',
  payerTimeline: 'payer_timeline_id',
  payerForm: 'payer_form_id',
  requirementUniversal: 'requirement_universal_id',
};

const SOURCE_TYPE_TO_PRISMA_FIELD: Record<EmbeddingSourceType, string> = {
  payerTrack: 'payerTrackId',
  payerRequirement: 'payerRequirementId',
  payerStateRule: 'payerStateRuleId',
  payerTimeline: 'payerTimelineId',
  payerForm: 'payerFormId',
  requirementUniversal: 'requirementUniversalId',
};

export function isConfigured(): boolean {
  return !!OPENAI_API_KEY;
}

/**
 * Generate an embedding vector from text using OpenAI's embeddings API.
 * Returns a float array of length 1536.
 */
async function callEmbeddingsApi(text: string): Promise<Response> {
  return fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
}

function embeddingSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured — embeddings unavailable');
  }

  const trimmed = text.slice(0, 8000); // text-embedding-3-small has 8191 token limit

  // Retry on 429 with exponential backoff. Match the LLM wrapper's pattern:
  // 3 total attempts (1 initial + 2 retries), 1s/2s backoff.
  const MAX_RETRIES = 2;
  let response: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    response = await callEmbeddingsApi(trimmed);
    if (response.status !== 429 || attempt === MAX_RETRIES) {
      break;
    }
    const backoffMs = 1000 * Math.pow(2, attempt);
    logger.warn('OpenAI embeddings rate-limited, retrying with backoff', {
      attempt: attempt + 1,
      maxAttempts: MAX_RETRIES + 1,
      backoffMs,
    });
    await embeddingSleep(backoffMs);
  }

  if (!response || !response.ok) {
    const status = response?.status ?? 0;
    const errorBody = response ? await response.text() : 'no response';
    logger.error(`OpenAI embeddings API error: ${status} ${errorBody}`);
    const err = new Error(`Embeddings API returned ${status}`) as Error & { status?: number };
    err.status = status;
    throw err;
  }

  const result = await response.json() as {
    data: Array<{ embedding: number[] }>;
  };

  const entry = result.data[0];
  if (!entry) {
    throw new Error('Embeddings API returned empty data array');
  }
  return entry.embedding;
}

/**
 * Upsert an embedding for a knowledge base record.
 * If an embedding already exists for this source, it is replaced.
 * Called automatically on every knowledge base create/update.
 */
export async function upsertEmbedding(
  sourceType: EmbeddingSourceType,
  sourceId: string,
  contentText: string
): Promise<void> {
  if (!OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — skipping embedding generation');
    return;
  }

  let embedding: number[];
  try {
    embedding = await generateEmbedding(contentText);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) {
      // Vendor rate-limit after retries exhausted. Skip embedding rather than
      // failing the KB record save — the embedding can be backfilled later.
      logger.warn('OpenAI rate-limited — saving KB record without embedding', {
        sourceType,
        sourceId,
      });
      return;
    }
    throw err;
  }
  const prismaField = SOURCE_TYPE_TO_PRISMA_FIELD[sourceType];
  const dbColumn = SOURCE_TYPE_TO_COLUMN[sourceType];

  if (!VALID_EMBEDDING_COLUMNS.has(dbColumn)) {
    throw new Error('Invalid embedding column: ' + dbColumn);
  }

  // Delete existing embedding for this source record
  await prisma.$executeRaw`
    DELETE FROM knowledge_base_embeddings
    WHERE ${Prisma.raw(`"${dbColumn}"`)} = ${sourceId}
  `;

  // Insert new embedding using raw SQL (Prisma can't handle vector type natively)
  const vectorString = `[${embedding.join(',')}]`;

  await prisma.$executeRaw`
    INSERT INTO knowledge_base_embeddings (
      id, ${Prisma.raw(`"${dbColumn}"`)}, content_text, embedding, model_used, created_at, updated_at
    ) VALUES (
      ${generateCuid()},
      ${sourceId},
      ${contentText},
      ${vectorString}::vector,
      ${EMBEDDING_MODEL},
      NOW(),
      NOW()
    )
  `;

  logger.info(`Embedding upserted for ${sourceType}:${sourceId}`);
}

/**
 * Delete all embeddings associated with a source record.
 */
export async function deleteEmbeddings(
  sourceType: EmbeddingSourceType,
  sourceId: string
): Promise<void> {
  const dbColumn = SOURCE_TYPE_TO_COLUMN[sourceType];

  if (!VALID_EMBEDDING_COLUMNS.has(dbColumn)) {
    throw new Error('Invalid embedding column: ' + dbColumn);
  }

  await prisma.$executeRaw`
    DELETE FROM knowledge_base_embeddings
    WHERE ${Prisma.raw(`"${dbColumn}"`)} = ${sourceId}
  `;
}

export interface SimilarResult {
  id: string;
  contentText: string;
  similarity: number;
  payerTrackId: string | null;
  payerRequirementId: string | null;
  payerStateRuleId: string | null;
  payerTimelineId: string | null;
  payerFormId: string | null;
  requirementUniversalId: string | null;
}

/**
 * Search for the most similar knowledge base records using pgvector cosine similarity.
 * Returns top N results with their source IDs and similarity scores.
 */
export async function searchSimilar(
  query: string,
  topN: number = 10
): Promise<SimilarResult[]> {
  if (!OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — similarity search unavailable');
    return [];
  }

  const queryEmbedding = await generateEmbedding(query);
  const vectorString = `[${queryEmbedding.join(',')}]`;

  const results = await prisma.$queryRaw<SimilarResult[]>`
    SELECT
      id,
      content_text AS "contentText",
      1 - (embedding <=> ${vectorString}::vector) AS similarity,
      payer_track_id AS "payerTrackId",
      payer_requirement_id AS "payerRequirementId",
      payer_state_rule_id AS "payerStateRuleId",
      payer_timeline_id AS "payerTimelineId",
      payer_form_id AS "payerFormId",
      requirement_universal_id AS "requirementUniversalId"
    FROM knowledge_base_embeddings
    ORDER BY embedding <=> ${vectorString}::vector
    LIMIT ${topN}
  `;

  return results;
}

/**
 * Search similar records and hydrate with full source data.
 * Loads the actual PayerTrack, PayerRequirement, etc. records for each result.
 */
export async function searchSimilarWithSources(
  query: string,
  topN: number = 10
): Promise<Array<SimilarResult & { source: Record<string, unknown> | null }>> {
  const results = await searchSimilar(query, topN);

  const hydrated = await Promise.all(
    results.map(async (result) => {
      let source: Record<string, unknown> | null = null;

      if (result.payerTrackId) {
        source = await prisma.payerTrack.findUnique({
          where: { id: result.payerTrackId },
          include: { contacts: true, timelines: true, stateRules: true, forms: true },
        }) as Record<string, unknown> | null;
      } else if (result.payerRequirementId) {
        source = await prisma.payerRequirement.findUnique({
          where: { id: result.payerRequirementId },
        }) as Record<string, unknown> | null;
      } else if (result.payerStateRuleId) {
        source = await prisma.payerStateRule.findUnique({
          where: { id: result.payerStateRuleId },
        }) as Record<string, unknown> | null;
      } else if (result.payerTimelineId) {
        source = await prisma.payerTimeline.findUnique({
          where: { id: result.payerTimelineId },
        }) as Record<string, unknown> | null;
      } else if (result.payerFormId) {
        source = await prisma.payerForm.findUnique({
          where: { id: result.payerFormId },
        }) as Record<string, unknown> | null;
      } else if (result.requirementUniversalId) {
        source = await prisma.requirementUniversal.findUnique({
          where: { id: result.requirementUniversalId },
        }) as Record<string, unknown> | null;
      }

      return { ...result, source };
    })
  );

  return hydrated;
}

// Simple cuid-like ID generator (avoids adding a dependency)
function generateCuid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `c${timestamp}${random}`;
}
