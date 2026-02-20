# Document Parsing Agent — Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an intelligent document parsing agent that extracts credential data from uploaded documents (licenses, certifications, insurance certificates) using Textract and Claude Vision, with confidence scoring and auto-save at ≥0.90 confidence.

**Architecture:** The document agent is a BullMQ worker that replaces the Phase 1 placeholder processor on the `agent-document` queue. It receives jobs containing document IDs and extraction hints, downloads files from S3, routes to the appropriate extraction engine (Textract for PDFs, Claude Vision for images/scans), maps extracted fields to internal Prisma credential schemas, and saves results with a confidence score. Below 0.90 confidence, it flags for human review instead of auto-saving.

**Tech Stack:** BullMQ (queue), AWS Textract (PDF extraction), Anthropic Claude API (vision extraction + document type detection), S3 (document storage), Prisma (credential persistence), Zod (field validation)

---

## Context for Implementer

### Existing Infrastructure You'll Use

- **S3 + Textract:** Already configured in `src/services/document.service.ts`. The `DocumentService` class has S3Client and TextractClient instances, `startOcrProcessing()`, `pollOcrResults()`, and `processOcrResults()` methods. You will NOT modify this file — the agent builds its own extraction pipeline that is more structured.
- **Agent Queues:** `src/agents/queues.ts` defines `QUEUE_NAMES.DOCUMENT = 'agent-document'`. The worker config in `src/agents/workers.ts` assigns `document_parser` agent with concurrency 2.
- **Event Logger:** `src/agents/event-logger.ts` — call `logAgentEvent()` for every significant action. It never throws.
- **WebSocket:** `src/agents/websocket.ts` — call `emitWorkflowEvent()` to push real-time updates.
- **Prisma Schema:** Credential models at `prisma/schema.prisma` — License (line 438), BoardCertification (479), MalpracticeInsurance (512), Education (561), ContinuingEducation (739). Document model (1058). `CredentialSource` enum (421) needs `agent_parsed` added.
- **Test Patterns:** Vitest v4, `vi.hoisted()` for mocks, `function()` not arrows for constructors, `vi.resetAllMocks()` not `clearAllMocks()`. Mock prisma via `tests/helpers/mock-prisma.ts`.

### Key Design Rules

1. Confidence ≥ 0.90 → auto-save credential with `source: 'agent_parsed'`
2. Confidence < 0.90 → save extraction results to `AgentTask.output` for human review, do NOT create credential
3. NEVER log PHI (SSN, DOB, tax ID) — redact before logging
4. PDF → Textract pipeline; Image (JPEG/PNG/TIFF) → Claude Vision pipeline
5. Unknown document type → Claude Haiku for classification first
6. Cross-validate NPI against NPPES when present

---

## Task 1: Add `agent_parsed` to CredentialSource enum

**Files:**
- Modify: `packages/backend/prisma/schema.prisma` (line 421-425, CredentialSource enum)
- Create: Migration file (auto-generated)

**Step 1: Add enum value to Prisma schema**

In `packages/backend/prisma/schema.prisma`, find:

```prisma
enum CredentialSource {
  manual_entry
  caqh_sync
  portal_import
}
```

Change to:

```prisma
enum CredentialSource {
  manual_entry
  caqh_sync
  portal_import
  agent_parsed
}
```

**Step 2: Generate and apply migration**

```bash
cd packages/backend
npx prisma migrate dev --name add_agent_parsed_credential_source
```

Expected: Migration created and applied.

**Step 3: Verify Prisma client regenerated**

```bash
npx prisma generate
```

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add agent_parsed to CredentialSource enum"
```

---

## Task 2: Document type classifier service

**Files:**
- Create: `packages/backend/src/agents/document-classifier.ts`
- Create: `packages/backend/src/agents/document-classifier.test.ts`

This service uses Claude Haiku to classify a document's type when it's unknown or ambiguous. It examines the first page of a document (as an image or extracted text) and returns a `DocumentType` enum value.

**Step 1: Write the failing test**

Create `packages/backend/src/agents/document-classifier.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

import { classifyDocumentType } from './document-classifier.js';

describe('document-classifier', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns a valid DocumentType from Claude response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'license' }],
    });

    const result = await classifyDocumentType({
      textContent: 'State of California Medical Board License No. A12345',
      mimeType: 'application/pdf',
    });

    expect(result).toBe('license');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.stringContaining('haiku'),
        max_tokens: 50,
      })
    );
  });

  it('returns "other" when Claude returns unrecognized type', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'unknown_thing' }],
    });

    const result = await classifyDocumentType({
      textContent: 'Some random text',
      mimeType: 'application/pdf',
    });

    expect(result).toBe('other');
  });

  it('returns "other" when Claude API fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));

    const result = await classifyDocumentType({
      textContent: 'Some text',
      mimeType: 'application/pdf',
    });

    expect(result).toBe('other');
  });

  it('sends image content when imageBase64 is provided', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'malpractice_certificate' }],
    });

    const result = await classifyDocumentType({
      imageBase64: 'base64encodeddata',
      mimeType: 'image/jpeg',
    });

    expect(result).toBe('malpractice_certificate');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ type: 'image' }),
            ]),
          }),
        ]),
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/agents/document-classifier.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `packages/backend/src/agents/document-classifier.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

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

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
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
    const anthropic = getClient();

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

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim().toLowerCase() : '';
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
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/agents/document-classifier.test.ts
```

Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/agents/document-classifier.ts src/agents/document-classifier.test.ts
git commit -m "feat: add document type classifier using Claude Haiku"
```

---

## Task 3: Field extraction service — Textract pipeline

**Files:**
- Create: `packages/backend/src/agents/extractors/textract-extractor.ts`
- Create: `packages/backend/src/agents/extractors/textract-extractor.test.ts`

This service takes a document buffer (PDF), sends it to AWS Textract for FORMS + TABLES analysis, and returns structured key-value pairs with per-field confidence scores.

**Step 1: Write the failing test**

Create `packages/backend/src/agents/extractors/textract-extractor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockSend = vi.fn();
vi.mock('@aws-sdk/client-textract', () => ({
  TextractClient: vi.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  AnalyzeDocumentCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { input };
  }),
}));

import { extractWithTextract } from './textract-extractor.js';

describe('textract-extractor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('extracts key-value pairs from Textract FORMS response', async () => {
    mockSend.mockResolvedValueOnce({
      Blocks: [
        { BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Id: 'k1', Confidence: 99.5,
          Relationships: [
            { Type: 'VALUE', Ids: ['v1'] },
            { Type: 'CHILD', Ids: ['w1'] },
          ] },
        { BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Id: 'v1',
          Relationships: [{ Type: 'CHILD', Ids: ['w2'] }] },
        { BlockType: 'WORD', Id: 'w1', Text: 'License Number' },
        { BlockType: 'WORD', Id: 'w2', Text: 'MD12345' },
      ],
    });

    const result = await extractWithTextract(Buffer.from('fake-pdf'));

    expect(result.fields).toHaveProperty('License Number');
    expect(result.fields['License Number']!.value).toBe('MD12345');
    expect(result.fields['License Number']!.confidence).toBeCloseTo(0.995);
    expect(result.averageConfidence).toBeCloseTo(0.995);
  });

  it('returns empty fields when no KEY_VALUE_SET blocks found', async () => {
    mockSend.mockResolvedValueOnce({
      Blocks: [
        { BlockType: 'LINE', Id: 'l1', Text: 'Some text' },
      ],
    });

    const result = await extractWithTextract(Buffer.from('fake-pdf'));

    expect(Object.keys(result.fields)).toHaveLength(0);
    expect(result.averageConfidence).toBe(0);
  });

  it('includes raw text lines for fallback parsing', async () => {
    mockSend.mockResolvedValueOnce({
      Blocks: [
        { BlockType: 'LINE', Id: 'l1', Text: 'State Medical License' },
        { BlockType: 'LINE', Id: 'l2', Text: 'No: MD12345' },
      ],
    });

    const result = await extractWithTextract(Buffer.from('fake-pdf'));

    expect(result.rawLines).toContain('State Medical License');
    expect(result.rawLines).toContain('No: MD12345');
  });

  it('handles Textract API errors gracefully', async () => {
    mockSend.mockRejectedValueOnce(new Error('Textract unavailable'));

    await expect(extractWithTextract(Buffer.from('fake'))).rejects.toThrow('Textract extraction failed');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/agents/extractors/textract-extractor.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `packages/backend/src/agents/extractors/textract-extractor.ts`:

```typescript
import { TextractClient, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { logger } from '../../utils/logger.js';

export interface ExtractedField {
  value: string;
  confidence: number;
}

export interface TextractResult {
  fields: Record<string, ExtractedField>;
  rawLines: string[];
  averageConfidence: number;
}

let textractClient: TextractClient | null = null;

function getTextractClient(): TextractClient {
  if (!textractClient) {
    const isLocalStack = process.env['USE_LOCALSTACK'] === 'true';
    const s3Endpoint = process.env['S3_ENDPOINT'];

    textractClient = new TextractClient({
      region: process.env['AWS_REGION'] || 'us-east-1',
      ...(isLocalStack && s3Endpoint && {
        endpoint: s3Endpoint,
        credentials: {
          accessKeyId: process.env['AWS_ACCESS_KEY_ID'] || 'test',
          secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || 'test',
        },
      }),
    });
  }
  return textractClient;
}

/**
 * Extracts key-value pairs and raw text from a document buffer using AWS Textract.
 * Uses synchronous AnalyzeDocument (max 10 pages) for agent-driven extraction.
 */
export async function extractWithTextract(buffer: Buffer): Promise<TextractResult> {
  try {
    const client = getTextractClient();

    const command = new AnalyzeDocumentCommand({
      Document: { Bytes: buffer },
      FeatureTypes: ['FORMS', 'TABLES'],
    });

    const response = await client.send(command);
    const blocks = response.Blocks || [];

    // Extract key-value pairs
    const fields: Record<string, ExtractedField> = {};
    let totalConfidence = 0;
    let fieldCount = 0;

    for (const block of blocks) {
      if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')) {
        const keyText = getTextFromBlock(block, blocks);
        const valueBlock = getValueBlock(block, blocks);

        if (valueBlock) {
          const valueText = getTextFromBlock(valueBlock, blocks);
          const confidence = (block.Confidence || 0) / 100;

          if (keyText && valueText) {
            fields[keyText] = { value: valueText, confidence };
            totalConfidence += confidence;
            fieldCount++;
          }
        }
      }
    }

    // Extract raw text lines for fallback
    const rawLines = blocks
      .filter((b) => b.BlockType === 'LINE' && b.Text)
      .map((b) => b.Text!);

    const averageConfidence = fieldCount > 0 ? totalConfidence / fieldCount : 0;

    logger.info(`Textract extracted ${fieldCount} fields, avg confidence: ${averageConfidence.toFixed(3)}`);

    return { fields, rawLines, averageConfidence };
  } catch (err) {
    logger.error('Textract extraction failed', { error: (err as Error).message });
    throw new Error(`Textract extraction failed: ${(err as Error).message}`);
  }
}

function getTextFromBlock(block: any, allBlocks: any[]): string {
  if (block.Text) return block.Text;

  const childIds = block.Relationships?.find((r: any) => r.Type === 'CHILD')?.Ids || [];
  const childBlocks = allBlocks.filter((b: any) => childIds.includes(b.Id));

  return childBlocks
    .filter((b: any) => b.BlockType === 'WORD')
    .map((b: any) => b.Text)
    .join(' ');
}

function getValueBlock(keyBlock: any, allBlocks: any[]): any {
  const valueRelation = keyBlock.Relationships?.find((r: any) => r.Type === 'VALUE');
  if (!valueRelation) return null;
  return allBlocks.find((b: any) => valueRelation.Ids.includes(b.Id));
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/agents/extractors/textract-extractor.test.ts
```

Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/agents/extractors/
git commit -m "feat: add Textract extraction pipeline for document agent"
```

---

## Task 4: Field extraction service — Claude Vision pipeline

**Files:**
- Create: `packages/backend/src/agents/extractors/vision-extractor.ts`
- Create: `packages/backend/src/agents/extractors/vision-extractor.test.ts`

This service takes an image buffer (JPEG/PNG/TIFF) and uses Claude Vision to extract structured credential fields. It prompts Claude with the document type and expected fields, receiving structured JSON back.

**Step 1: Write the failing test**

Create `packages/backend/src/agents/extractors/vision-extractor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

import { extractWithVision } from './vision-extractor.js';

describe('vision-extractor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('extracts fields from an image with confidence scores', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          fields: {
            licenseNumber: { value: 'MD12345', confidence: 0.95 },
            state: { value: 'California', confidence: 0.98 },
            expirationDate: { value: '2027-06-30', confidence: 0.92 },
          },
        }),
      }],
    });

    const result = await extractWithVision({
      imageBase64: 'base64data',
      mimeType: 'image/jpeg',
      documentType: 'license',
      extractionHints: ['licenseNumber', 'state', 'expirationDate'],
    });

    expect(result.fields).toHaveProperty('licenseNumber');
    expect(result.fields['licenseNumber']!.value).toBe('MD12345');
    expect(result.fields['licenseNumber']!.confidence).toBe(0.95);
    expect(result.averageConfidence).toBeCloseTo(0.95);
  });

  it('sends correct image content to Claude', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"fields":{}}' }],
    });

    await extractWithVision({
      imageBase64: 'testdata',
      mimeType: 'image/png',
      documentType: 'license',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image',
                source: expect.objectContaining({
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'testdata',
                }),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('handles invalid JSON response gracefully', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not valid json' }],
    });

    const result = await extractWithVision({
      imageBase64: 'data',
      mimeType: 'image/jpeg',
      documentType: 'license',
    });

    expect(result.fields).toEqual({});
    expect(result.averageConfidence).toBe(0);
  });

  it('handles API errors gracefully', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Vision API down'));

    await expect(
      extractWithVision({
        imageBase64: 'data',
        mimeType: 'image/jpeg',
        documentType: 'license',
      })
    ).rejects.toThrow('Vision extraction failed');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/agents/extractors/vision-extractor.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `packages/backend/src/agents/extractors/vision-extractor.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/agents/extractors/vision-extractor.test.ts
```

Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/agents/extractors/
git commit -m "feat: add Claude Vision extraction pipeline for document agent"
```

---

## Task 5: Credential field mapper

**Files:**
- Create: `packages/backend/src/agents/credential-mapper.ts`
- Create: `packages/backend/src/agents/credential-mapper.test.ts`

This service maps raw extracted fields (from Textract or Vision) to the internal Prisma credential schemas. It handles field name normalization, date parsing, and validation.

**Step 1: Write the failing test**

Create `packages/backend/src/agents/credential-mapper.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { mapToCredential } from './credential-mapper.js';

describe('credential-mapper', () => {
  describe('license mapping', () => {
    it('maps extracted fields to License schema', () => {
      const result = mapToCredential('license', {
        licenseNumber: { value: 'MD12345', confidence: 0.95 },
        state: { value: 'California', confidence: 0.98 },
        issueDate: { value: '2020-01-15', confidence: 0.90 },
        expirationDate: { value: '2026-01-15', confidence: 0.92 },
      });

      expect(result.mapped).toEqual(expect.objectContaining({
        licenseNumber: 'MD12345',
        state: 'CA',
        issueDate: expect.any(Date),
        expirationDate: expect.any(Date),
      }));
      expect(result.unmappedFields).toHaveLength(0);
    });

    it('normalizes state names to abbreviations', () => {
      const result = mapToCredential('license', {
        state: { value: 'New York', confidence: 0.95 },
        licenseNumber: { value: 'NY999', confidence: 0.95 },
        issueDate: { value: '2020-01-01', confidence: 0.95 },
        expirationDate: { value: '2026-01-01', confidence: 0.95 },
      });

      expect(result.mapped['state']).toBe('NY');
    });

    it('tracks unmapped fields', () => {
      const result = mapToCredential('license', {
        licenseNumber: { value: 'MD12345', confidence: 0.95 },
        unknownField: { value: 'something', confidence: 0.80 },
        issueDate: { value: '2020-01-01', confidence: 0.95 },
        expirationDate: { value: '2026-01-01', confidence: 0.95 },
      });

      expect(result.unmappedFields).toContain('unknownField');
    });
  });

  describe('board_certification mapping', () => {
    it('maps extracted fields to BoardCertification schema', () => {
      const result = mapToCredential('board_certification', {
        certificationNumber: { value: 'CERT-789', confidence: 0.93 },
        boardName: { value: 'American Board of Psychiatry', confidence: 0.97 },
        specialty: { value: 'Psychiatry', confidence: 0.96 },
        initialCertificationDate: { value: '2018-06-01', confidence: 0.91 },
        expirationDate: { value: '2028-06-01', confidence: 0.90 },
      });

      expect(result.mapped).toEqual(expect.objectContaining({
        certificationNumber: 'CERT-789',
        boardName: 'American Board of Psychiatry',
        specialty: 'Psychiatry',
      }));
    });
  });

  describe('malpractice_certificate mapping', () => {
    it('maps insurance fields correctly', () => {
      const result = mapToCredential('malpractice_certificate', {
        carrierName: { value: 'ACME Insurance', confidence: 0.95 },
        policyNumber: { value: 'POL-456', confidence: 0.97 },
        perClaimAmount: { value: '1000000', confidence: 0.90 },
        aggregateAmount: { value: '3000000', confidence: 0.90 },
        effectiveDate: { value: '2025-01-01', confidence: 0.92 },
        expirationDate: { value: '2026-01-01', confidence: 0.93 },
      });

      expect(result.mapped).toEqual(expect.objectContaining({
        carrierName: 'ACME Insurance',
        policyNumber: 'POL-456',
        perClaimAmount: 1000000,
        aggregateAmount: 3000000,
      }));
    });
  });

  it('returns empty mapped for unsupported document types', () => {
    const result = mapToCredential('photo', {
      something: { value: 'data', confidence: 0.95 },
    });

    expect(result.mapped).toEqual({});
    expect(result.unmappedFields).toContain('something');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/agents/credential-mapper.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `packages/backend/src/agents/credential-mapper.ts`:

```typescript
import { logger } from '../utils/logger.js';

interface ExtractedField {
  value: string;
  confidence: number;
}

export interface MappingResult {
  mapped: Record<string, unknown>;
  unmappedFields: string[];
  fieldConfidences: Record<string, number>;
}

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

function normalizeState(value: string): string {
  if (value.length === 2) return value.toUpperCase();
  const lower = value.toLowerCase().trim();
  return STATE_NAMES[lower] ?? value;
}

function parseDate(value: string): Date | null {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseCurrency(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

type FieldMapper = (fields: Record<string, ExtractedField>) => {
  mapped: Record<string, unknown>;
  knownFields: string[];
};

const MAPPERS: Record<string, FieldMapper> = {
  license: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['licenseNumber', 'licenseType', 'state', 'issueDate', 'expirationDate', 'holderName', 'npi'];

    if (fields['licenseNumber']) mapped['licenseNumber'] = fields['licenseNumber'].value;
    if (fields['state']) mapped['state'] = normalizeState(fields['state'].value);
    if (fields['issueDate']) {
      const d = parseDate(fields['issueDate'].value);
      if (d) mapped['issueDate'] = d;
    }
    if (fields['expirationDate']) {
      const d = parseDate(fields['expirationDate'].value);
      if (d) mapped['expirationDate'] = d;
    }
    if (fields['licenseType']) mapped['licenseType'] = fields['licenseType'].value;
    if (fields['npi']) mapped['npi'] = fields['npi'].value;

    return { mapped, knownFields };
  },

  board_certification: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['certificationNumber', 'boardName', 'specialty', 'initialCertificationDate', 'expirationDate', 'holderName'];

    if (fields['certificationNumber']) mapped['certificationNumber'] = fields['certificationNumber'].value;
    if (fields['boardName']) mapped['boardName'] = fields['boardName'].value;
    if (fields['specialty']) mapped['specialty'] = fields['specialty'].value;
    if (fields['initialCertificationDate']) {
      const d = parseDate(fields['initialCertificationDate'].value);
      if (d) mapped['initialCertificationDate'] = d;
    }
    if (fields['expirationDate']) {
      const d = parseDate(fields['expirationDate'].value);
      if (d) mapped['expirationDate'] = d;
    }

    return { mapped, knownFields };
  },

  malpractice_certificate: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['carrierName', 'policyNumber', 'coverageType', 'perClaimAmount', 'aggregateAmount', 'effectiveDate', 'expirationDate', 'holderName'];

    if (fields['carrierName']) mapped['carrierName'] = fields['carrierName'].value;
    if (fields['policyNumber']) mapped['policyNumber'] = fields['policyNumber'].value;
    if (fields['coverageType']) mapped['coverageType'] = fields['coverageType'].value;
    if (fields['perClaimAmount']) {
      const n = parseCurrency(fields['perClaimAmount'].value);
      if (n !== null) mapped['perClaimAmount'] = n;
    }
    if (fields['aggregateAmount']) {
      const n = parseCurrency(fields['aggregateAmount'].value);
      if (n !== null) mapped['aggregateAmount'] = n;
    }
    if (fields['effectiveDate']) {
      const d = parseDate(fields['effectiveDate'].value);
      if (d) mapped['effectiveDate'] = d;
    }
    if (fields['expirationDate']) {
      const d = parseDate(fields['expirationDate'].value);
      if (d) mapped['expirationDate'] = d;
    }

    return { mapped, knownFields };
  },

  dea_certificate: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['deaNumber', 'schedules', 'state', 'issueDate', 'expirationDate', 'holderName'];

    if (fields['deaNumber']) mapped['licenseNumber'] = fields['deaNumber'].value;
    if (fields['state']) mapped['state'] = normalizeState(fields['state'].value);
    if (fields['issueDate']) {
      const d = parseDate(fields['issueDate'].value);
      if (d) mapped['issueDate'] = d;
    }
    if (fields['expirationDate']) {
      const d = parseDate(fields['expirationDate'].value);
      if (d) mapped['expirationDate'] = d;
    }

    return { mapped, knownFields };
  },

  diploma: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['institutionName', 'degree', 'fieldOfStudy', 'graduationDate', 'holderName'];

    if (fields['institutionName']) mapped['institutionName'] = fields['institutionName'].value;
    if (fields['degree']) mapped['degree'] = fields['degree'].value;
    if (fields['fieldOfStudy']) mapped['fieldOfStudy'] = fields['fieldOfStudy'].value;
    if (fields['graduationDate']) {
      const d = parseDate(fields['graduationDate'].value);
      if (d) mapped['graduationDate'] = d;
    }

    return { mapped, knownFields };
  },

  cme_certificate: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['courseName', 'courseProvider', 'credits', 'creditType', 'completionDate', 'holderName'];

    if (fields['courseName']) mapped['courseName'] = fields['courseName'].value;
    if (fields['courseProvider']) mapped['courseProvider'] = fields['courseProvider'].value;
    if (fields['credits']) {
      const n = parseFloat(fields['credits'].value);
      if (!isNaN(n)) mapped['credits'] = n;
    }
    if (fields['creditType']) mapped['creditType'] = fields['creditType'].value;
    if (fields['completionDate']) {
      const d = parseDate(fields['completionDate'].value);
      if (d) mapped['completionDate'] = d;
    }

    return { mapped, knownFields };
  },
};

/**
 * Maps extracted fields to the internal Prisma credential schema for a given document type.
 * Returns the mapped data, a list of unmapped fields, and per-field confidence scores.
 */
export function mapToCredential(
  documentType: string,
  fields: Record<string, ExtractedField>
): MappingResult {
  const mapper = MAPPERS[documentType];
  const fieldConfidences: Record<string, number> = {};

  for (const [key, field] of Object.entries(fields)) {
    fieldConfidences[key] = field.confidence;
  }

  if (!mapper) {
    logger.warn(`No credential mapper for document type: ${documentType}`);
    return {
      mapped: {},
      unmappedFields: Object.keys(fields),
      fieldConfidences,
    };
  }

  const { mapped, knownFields } = mapper(fields);
  const unmappedFields = Object.keys(fields).filter((k) => !knownFields.includes(k));

  if (unmappedFields.length > 0) {
    logger.info(`Unmapped fields for ${documentType}: ${unmappedFields.join(', ')}`);
  }

  return { mapped, unmappedFields, fieldConfidences };
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/agents/credential-mapper.test.ts
```

Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/agents/credential-mapper.ts src/agents/credential-mapper.test.ts
git commit -m "feat: add credential field mapper for document agent"
```

---

## Task 6: Document agent processor

**Files:**
- Create: `packages/backend/src/agents/document-agent.ts`
- Create: `packages/backend/src/agents/document-agent.test.ts`

This is the main document agent — the BullMQ job processor. It orchestrates the full pipeline: download from S3 → classify document type → extract fields (Textract or Vision) → map to credential schema → save if confidence ≥ 0.90 or flag for review.

**Step 1: Write the failing test**

Create `packages/backend/src/agents/document-agent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
}));

vi.mock('./websocket.js', () => ({
  emitWorkflowEvent: vi.fn(),
}));

const mockExtractTextract = vi.fn();
vi.mock('./extractors/textract-extractor.js', () => ({
  extractWithTextract: mockExtractTextract,
}));

const mockExtractVision = vi.fn();
vi.mock('./extractors/vision-extractor.js', () => ({
  extractWithVision: mockExtractVision,
}));

const mockClassify = vi.fn();
vi.mock('./document-classifier.js', () => ({
  classifyDocumentType: mockClassify,
}));

const mockMapToCredential = vi.fn();
vi.mock('./credential-mapper.js', () => ({
  mapToCredential: mockMapToCredential,
}));

import { processDocumentJob } from './document-agent.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from './event-logger.js';
import { emitWorkflowEvent } from './websocket.js';

describe('document-agent', () => {
  const mockS3Send = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const baseJobData = {
    workflowId: 'wf-1',
    taskId: 'task-1',
    documentId: 'doc-1',
    providerId: 'prov-1',
  };

  it('processes a PDF document through Textract pipeline', async () => {
    // Mock document lookup
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'license',
      providerId: 'prov-1',
    } as never);

    // Mock S3 download (tested separately)
    mockExtractTextract.mockResolvedValueOnce({
      fields: {
        'License Number': { value: 'MD12345', confidence: 0.95 },
        'State': { value: 'California', confidence: 0.98 },
      },
      rawLines: ['State Medical License'],
      averageConfidence: 0.965,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: { licenseNumber: 'MD12345', state: 'CA' },
      unmappedFields: [],
      fieldConfidences: { 'License Number': 0.95, 'State': 0.98 },
    });

    // Mock credential creation
    prismaMock.license.create.mockResolvedValueOnce({ id: 'lic-1' } as never);
    // Mock task update
    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    const result = await processDocumentJob(baseJobData);

    expect(result.status).toBe('completed');
    expect(result.extractionMethod).toBe('textract');
    expect(logAgentEvent).toHaveBeenCalled();
  });

  it('processes an image document through Vision pipeline', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.jpg',
      mimeType: 'image/jpeg',
      documentType: 'license',
      providerId: 'prov-1',
    } as never);

    mockExtractVision.mockResolvedValueOnce({
      fields: {
        licenseNumber: { value: 'MD12345', confidence: 0.96 },
      },
      averageConfidence: 0.96,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: { licenseNumber: 'MD12345' },
      unmappedFields: [],
      fieldConfidences: { licenseNumber: 0.96 },
    });

    prismaMock.license.create.mockResolvedValueOnce({ id: 'lic-1' } as never);
    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    const result = await processDocumentJob(baseJobData);

    expect(result.status).toBe('completed');
    expect(result.extractionMethod).toBe('vision');
  });

  it('flags for human review when confidence < 0.90', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'license',
      providerId: 'prov-1',
    } as never);

    mockExtractTextract.mockResolvedValueOnce({
      fields: { 'License Number': { value: 'MD???', confidence: 0.60 } },
      rawLines: [],
      averageConfidence: 0.60,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: { licenseNumber: 'MD???' },
      unmappedFields: [],
      fieldConfidences: { 'License Number': 0.60 },
    });

    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    const result = await processDocumentJob(baseJobData);

    expect(result.status).toBe('needs_review');
    expect(result.confidence).toBeLessThan(0.90);
    // Should NOT create a credential
    expect(prismaMock.license.create).not.toHaveBeenCalled();
  });

  it('classifies unknown document type before extraction', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'other',
      providerId: 'prov-1',
    } as never);

    mockClassify.mockResolvedValueOnce('license');

    mockExtractTextract.mockResolvedValueOnce({
      fields: { 'License Number': { value: 'MD12345', confidence: 0.95 } },
      rawLines: [],
      averageConfidence: 0.95,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: { licenseNumber: 'MD12345' },
      unmappedFields: [],
      fieldConfidences: { 'License Number': 0.95 },
    });

    prismaMock.license.create.mockResolvedValueOnce({ id: 'lic-1' } as never);
    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    const result = await processDocumentJob(baseJobData);

    expect(mockClassify).toHaveBeenCalled();
    expect(result.documentType).toBe('license');
  });

  it('emits WebSocket events during processing', async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce({
      id: 'doc-1',
      s3Key: 'documents/prov-1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'license',
      providerId: 'prov-1',
    } as never);

    mockExtractTextract.mockResolvedValueOnce({
      fields: {},
      rawLines: [],
      averageConfidence: 0,
    });

    mockMapToCredential.mockReturnValueOnce({
      mapped: {},
      unmappedFields: [],
      fieldConfidences: {},
    });

    prismaMock.agentTask.update.mockResolvedValueOnce({} as never);

    await processDocumentJob(baseJobData);

    expect(emitWorkflowEvent).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/agents/document-agent.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `packages/backend/src/agents/document-agent.ts`:

```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { logAgentEvent } from './event-logger.js';
import { emitWorkflowEvent } from './websocket.js';
import { extractWithTextract } from './extractors/textract-extractor.js';
import { extractWithVision } from './extractors/vision-extractor.js';
import { classifyDocumentType } from './document-classifier.js';
import { mapToCredential } from './credential-mapper.js';

const CONFIDENCE_THRESHOLD = 0.90;

const PDF_MIME_TYPES = ['application/pdf'];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];

// PHI fields that must never be logged
const PHI_FIELDS = ['ssn', 'socialSecurityNumber', 'taxId', 'dateOfBirth', 'dob'];

export interface DocumentJobData {
  workflowId: string;
  taskId?: string;
  documentId: string;
  providerId: string;
  extractionHints?: string[];
}

export interface DocumentJobResult {
  status: 'completed' | 'needs_review' | 'failed';
  documentId: string;
  documentType: string;
  extractionMethod: 'textract' | 'vision' | 'none';
  confidence: number;
  fieldsExtracted: number;
  credentialId?: string;
  error?: string;
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const s3Endpoint = process.env['S3_ENDPOINT'];
    s3Client = new S3Client({
      region: process.env['AWS_REGION'] || 'us-east-1',
      ...(s3Endpoint && {
        endpoint: s3Endpoint,
        forcePathStyle: true,
      }),
      ...(process.env['AWS_ACCESS_KEY_ID'] && {
        credentials: {
          accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
          secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
        },
      }),
    });
  }
  return s3Client;
}

async function downloadFromS3(s3Key: string): Promise<Buffer> {
  const client = getS3Client();
  const bucket = process.env['S3_BUCKET_NAME'] || 'credentials-documents';
  const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
  const response = await client.send(command);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function redactPhiFromFields(fields: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...fields };
  for (const key of PHI_FIELDS) {
    if (key in redacted) {
      redacted[key] = '[REDACTED]';
    }
  }
  return redacted;
}

// Map document type to Prisma model for credential creation
const CREDENTIAL_CREATORS: Record<string, (providerId: string, mapped: Record<string, unknown>) => Promise<{ id: string }>> = {
  license: async (providerId, mapped) => {
    return prisma.license.create({
      data: {
        providerId,
        licenseType: (mapped['licenseType'] as string) ?? 'state_medical',
        licenseNumber: mapped['licenseNumber'] as string,
        state: (mapped['state'] as string) ?? null,
        issueDate: mapped['issueDate'] as Date,
        expirationDate: mapped['expirationDate'] as Date,
        source: 'agent_parsed',
        status: 'active',
      },
    });
  },
  board_certification: async (providerId, mapped) => {
    return prisma.boardCertification.create({
      data: {
        providerId,
        boardType: 'abpn_psychiatry', // Default — will be refined in future
        boardName: mapped['boardName'] as string,
        specialty: mapped['specialty'] as string,
        initialCertificationDate: mapped['initialCertificationDate'] as Date,
        expirationDate: (mapped['expirationDate'] as Date) ?? null,
        certificationNumber: (mapped['certificationNumber'] as string) ?? null,
        source: 'agent_parsed',
        status: 'active',
      },
    });
  },
  malpractice_certificate: async (providerId, mapped) => {
    return prisma.malpracticeInsurance.create({
      data: {
        providerId,
        carrierName: mapped['carrierName'] as string,
        policyNumber: mapped['policyNumber'] as string,
        coverageType: 'occurrence',
        perClaimAmount: mapped['perClaimAmount'] as number,
        aggregateAmount: mapped['aggregateAmount'] as number,
        effectiveDate: mapped['effectiveDate'] as Date,
        expirationDate: mapped['expirationDate'] as Date,
        source: 'manual_entry', // MalpracticeInsurance doesn't have source field yet
        status: 'active',
      },
    });
  },
};

/**
 * Main document agent processor.
 * Downloads document from S3, extracts fields, maps to credential schema,
 * and auto-saves if confidence >= 0.90.
 */
export async function processDocumentJob(data: DocumentJobData): Promise<DocumentJobResult> {
  const { workflowId, taskId, documentId, providerId } = data;

  try {
    // 1. Fetch document metadata
    const document = await prisma.document.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    await logAgentEvent({
      workflowId,
      taskId,
      agent: 'document_parser',
      action: 'processing_started',
      data: { documentId, mimeType: document.mimeType, documentType: document.documentType },
    });

    emitWorkflowEvent(workflowId, 'agent:document_processing', {
      documentId,
      step: 'started',
    });

    // 2. Determine document type (classify if unknown)
    let documentType = document.documentType;
    if (documentType === 'other') {
      // Need to classify first — use raw text or first-page image
      documentType = await classifyDocumentType({
        textContent: `Document: ${document.originalFileName}`,
        mimeType: document.mimeType,
      });

      await logAgentEvent({
        workflowId,
        taskId,
        agent: 'document_parser',
        action: 'document_classified',
        data: { documentId, classifiedAs: documentType },
      });
    }

    // 3. Download document from S3
    const buffer = await downloadFromS3(document.s3Key);

    // 4. Extract fields based on MIME type
    let extractionMethod: 'textract' | 'vision' | 'none' = 'none';
    let extractedFields: Record<string, { value: string; confidence: number }> = {};
    let averageConfidence = 0;

    if (PDF_MIME_TYPES.includes(document.mimeType)) {
      extractionMethod = 'textract';
      const result = await extractWithTextract(buffer);
      extractedFields = result.fields;
      averageConfidence = result.averageConfidence;
    } else if (IMAGE_MIME_TYPES.includes(document.mimeType)) {
      extractionMethod = 'vision';
      const imageBase64 = buffer.toString('base64');
      const result = await extractWithVision({
        imageBase64,
        mimeType: document.mimeType,
        documentType,
        extractionHints: data.extractionHints,
      });
      extractedFields = result.fields;
      averageConfidence = result.averageConfidence;
    }

    emitWorkflowEvent(workflowId, 'agent:document_extracted', {
      documentId,
      method: extractionMethod,
      fieldCount: Object.keys(extractedFields).length,
      confidence: averageConfidence,
    });

    // 5. Map to credential schema
    const mapping = mapToCredential(documentType, extractedFields);

    await logAgentEvent({
      workflowId,
      taskId,
      agent: 'document_parser',
      action: 'fields_mapped',
      data: redactPhiFromFields({
        documentId,
        documentType,
        fieldCount: Object.keys(mapping.mapped).length,
        unmappedFields: mapping.unmappedFields,
        averageConfidence,
      }),
    });

    // 6. Save or flag for review based on confidence
    let credentialId: string | undefined;

    if (averageConfidence >= CONFIDENCE_THRESHOLD && Object.keys(mapping.mapped).length > 0) {
      const creator = CREDENTIAL_CREATORS[documentType];
      if (creator) {
        try {
          const credential = await creator(providerId, mapping.mapped);
          credentialId = credential.id;

          await logAgentEvent({
            workflowId,
            taskId,
            agent: 'document_parser',
            action: 'credential_saved',
            data: { documentId, credentialId, documentType, confidence: averageConfidence },
          });

          // Update document OCR status
          await prisma.document.update({
            where: { id: documentId },
            data: {
              ocrStatus: 'completed',
              ocrConfidence: averageConfidence,
              ocrData: extractedFields as any,
            },
          });
        } catch (err) {
          logger.error('Failed to save credential', { error: (err as Error).message, documentId });
          // Fall through to needs_review
        }
      }
    }

    const status = credentialId ? 'completed' : 'needs_review';

    // 7. Update task output
    if (taskId) {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: status === 'completed' ? 'completed' : 'in_progress',
          output: {
            documentId,
            documentType,
            extractionMethod,
            confidence: averageConfidence,
            fieldsExtracted: Object.keys(extractedFields).length,
            credentialId: credentialId ?? null,
            mappedData: redactPhiFromFields(mapping.mapped),
            needsReview: status === 'needs_review',
          },
        },
      });
    }

    emitWorkflowEvent(workflowId, 'agent:document_complete', {
      documentId,
      status,
      confidence: averageConfidence,
      credentialId,
    });

    return {
      status,
      documentId,
      documentType,
      extractionMethod,
      confidence: averageConfidence,
      fieldsExtracted: Object.keys(extractedFields).length,
      credentialId,
    };
  } catch (err) {
    const errorMsg = (err as Error).message;
    logger.error('Document agent failed', { error: errorMsg, documentId });

    await logAgentEvent({
      workflowId,
      taskId,
      agent: 'document_parser',
      action: 'processing_failed',
      data: { documentId, error: errorMsg },
      level: 'error',
    });

    emitWorkflowEvent(workflowId, 'agent:document_failed', {
      documentId,
      error: errorMsg,
    });

    return {
      status: 'failed',
      documentId,
      documentType: 'other',
      extractionMethod: 'none',
      confidence: 0,
      fieldsExtracted: 0,
      error: errorMsg,
    };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/agents/document-agent.test.ts
```

Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add src/agents/document-agent.ts src/agents/document-agent.test.ts
git commit -m "feat: add document agent processor with full extraction pipeline"
```

---

## Task 7: Wire document agent into BullMQ worker

**Files:**
- Modify: `packages/backend/src/agents/workers.ts`
- Modify: `packages/backend/src/agents/workers.test.ts`

Replace the placeholder processor for the `document_parser` worker with the real `processDocumentJob` function.

**Step 1: Update workers.ts**

In `packages/backend/src/agents/workers.ts`, add the import at the top:

```typescript
import { processDocumentJob } from './document-agent.js';
import type { DocumentJobData } from './document-agent.js';
```

Then modify the worker creation loop. Instead of using `createPlaceholderProcessor` for all workers, use the real processor for `document_parser`:

Find the loop in `initializeWorkers()` and change the processor selection:

```typescript
function getProcessor(agentName: string) {
  if (agentName === 'document_parser') {
    return async (job: Job) => {
      const data = job.data as DocumentJobData;
      return processDocumentJob(data);
    };
  }
  return createPlaceholderProcessor(agentName);
}
```

Then in the loop, replace `createPlaceholderProcessor(config.agentName)` with `getProcessor(config.agentName)`.

**Step 2: Update workers.test.ts**

Add mock for the document agent module at the top of the test file:

```typescript
vi.mock('./document-agent.js', () => ({
  processDocumentJob: vi.fn().mockResolvedValue({ status: 'completed' }),
}));
```

Add a test:

```typescript
it('uses real processor for document_parser worker', () => {
  initializeWorkers();

  // The document_parser worker should have a different processor than the placeholder
  const documentCall = MockWorker.mock.calls.find(
    (call: unknown[]) => call[0] === 'agent-document'
  );
  expect(documentCall).toBeDefined();
  // Processor is the second argument — it should be a function
  expect(typeof documentCall![1]).toBe('function');
});
```

**Step 3: Run tests**

```bash
npx vitest run src/agents/workers.test.ts
```

Expected: PASS.

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 5: Commit**

```bash
git add src/agents/workers.ts src/agents/workers.test.ts
git commit -m "feat: wire document agent processor into BullMQ worker"
```

---

## Task 8: Coordinator dispatch for document jobs

**Files:**
- Modify: `packages/backend/src/agents/coordinator.service.ts`
- Modify: `packages/backend/src/agents/coordinator.service.test.ts`

Add a `dispatchDocumentParsing` function to the coordinator that creates an `AgentTask` and enqueues a job to the document queue.

**Step 1: Add the function to coordinator.service.ts**

Add after the existing exports:

```typescript
export interface DispatchDocumentInput {
  workflowId: string;
  documentId: string;
  providerId: string;
  extractionHints?: string[];
}

export async function dispatchDocumentParsing(input: DispatchDocumentInput) {
  const { workflowId, documentId, providerId, extractionHints } = input;

  // Create task record
  const task = await prisma.agentTask.create({
    data: {
      workflowId,
      type: 'parse_document',
      stepNumber: 1,
      status: 'queued',
      input: { documentId, providerId, extractionHints: extractionHints ?? [] },
    },
  });

  // Enqueue job
  const queue = getQueue(QUEUE_NAMES.DOCUMENT);
  const job = await queue.add('parse_document', {
    workflowId,
    taskId: task.id,
    documentId,
    providerId,
    extractionHints,
  });

  // Update task with BullMQ job ID
  await prisma.agentTask.update({
    where: { id: task.id },
    data: { bullmqJobId: job.id ?? null },
  });

  await logAgentEvent({
    workflowId,
    taskId: task.id,
    agent: 'coordinator',
    action: 'document_parsing_dispatched',
    data: { documentId, taskId: task.id },
  });

  logger.info('Document parsing dispatched', { workflowId, documentId, taskId: task.id });

  return task;
}
```

**Step 2: Add tests to coordinator.service.test.ts**

Add at the end of the describe block:

```typescript
describe('dispatchDocumentParsing', () => {
  it('creates a task and enqueues a document parsing job', async () => {
    const fakeTask = {
      id: 'task-1',
      workflowId: 'wf-1',
      type: 'parse_document',
      stepNumber: 1,
      status: 'queued',
    };
    prismaMock.agentTask.create.mockResolvedValueOnce(fakeTask as never);
    prismaMock.agentTask.update.mockResolvedValueOnce({ ...fakeTask, bullmqJobId: 'job-1' } as never);

    const { dispatchDocumentParsing } = await import('./coordinator.service.js');
    const result = await dispatchDocumentParsing({
      workflowId: 'wf-1',
      documentId: 'doc-1',
      providerId: 'prov-1',
    });

    expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: 'wf-1',
        type: 'parse_document',
        status: 'queued',
      }),
    });

    expect(getQueue).toHaveBeenCalledWith('agent-document');
    expect(mockAdd).toHaveBeenCalledWith('parse_document', expect.objectContaining({
      workflowId: 'wf-1',
      documentId: 'doc-1',
      providerId: 'prov-1',
    }));

    expect(result.id).toBe('task-1');
  });
});
```

**Step 3: Run tests**

```bash
npx vitest run src/agents/coordinator.service.test.ts
```

Expected: PASS (11+ tests).

**Step 4: Commit**

```bash
git add src/agents/coordinator.service.ts src/agents/coordinator.service.test.ts
git commit -m "feat: add document parsing dispatch to coordinator service"
```

---

## Task 9: API route for triggering document parsing

**Files:**
- Modify: `packages/backend/src/routes/agent.routes.ts`
- Modify: `packages/backend/src/routes/agent.routes.test.ts`

Add a POST endpoint to dispatch document parsing for a specific document within a workflow.

**Step 1: Add route to agent.routes.ts**

Add a new Zod schema:

```typescript
const parseDocumentSchema = z.object({
  documentId: z.string().uuid(),
  providerId: z.string().uuid(),
  extractionHints: z.array(z.string()).optional(),
});
```

Add the import for `dispatchDocumentParsing` from coordinator service.

Add route:

```typescript
// POST /workflows/:id/parse-document — dispatch document parsing
agentRoutes.post(
  '/workflows/:id/parse-document',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const task = await dispatchDocumentParsing({
        workflowId: req.params['id']!,
        documentId: parsed.data.documentId,
        providerId: parsed.data.providerId,
        extractionHints: parsed.data.extractionHints,
      });

      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }
);
```

**Step 2: Add tests to agent.routes.test.ts**

Add mock for `dispatchDocumentParsing` and test:

```typescript
it('POST /workflows/:id/parse-document — dispatches document parsing', async () => {
  const mockDispatch = vi.fn().mockResolvedValueOnce({ id: 'task-1', status: 'queued' });
  // ... mock and test the endpoint returns 201
});

it('POST /workflows/:id/parse-document — validates input', async () => {
  // Send invalid body, expect 400
});
```

**Step 3: Run tests**

```bash
npx vitest run src/routes/agent.routes.test.ts
```

Expected: PASS.

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/routes/agent.routes.ts src/routes/agent.routes.test.ts
git commit -m "feat: add document parsing API endpoint"
```

---

## Task 10: End-to-end integration test

**Files:**
- No new files — uses existing infrastructure

This task verifies the full pipeline works end-to-end: API call → coordinator dispatches → document worker picks up job → extracts fields → maps → saves credential.

**Step 1: Run all agent tests**

```bash
npx vitest run src/agents/ src/routes/agent.routes.test.ts src/utils/redis.test.ts
```

Expected: All tests pass.

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Build and start backend**

```bash
npm run build --workspace=packages/backend
```

Verify it builds cleanly.

**Step 4: E2E test with curl**

Start the backend and test:

```bash
# Create a workflow
curl -s -X POST "http://localhost:3002/api/v1/agent/workflows" \
  -H "Authorization: Bearer dev-bypass" \
  -H "Content-Type: application/json" \
  -d '{"goal":"Parse uploaded documents","providerId":"<UUID>","priority":"normal"}'

# Dispatch document parsing (use a real document ID from the database)
curl -s -X POST "http://localhost:3002/api/v1/agent/workflows/<WORKFLOW_ID>/parse-document" \
  -H "Authorization: Bearer dev-bypass" \
  -H "Content-Type: application/json" \
  -d '{"documentId":"<DOC_ID>","providerId":"<UUID>"}'

# Check events
curl -s "http://localhost:3002/api/v1/agent/workflows/<WORKFLOW_ID>/events" \
  -H "Authorization: Bearer dev-bypass"
```

Expected: Workflow created, task dispatched, events logged showing document processing pipeline.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues from E2E testing"
```

---

## Summary

| Task | Description | New Files | Tests |
|------|-------------|-----------|-------|
| 1 | Add `agent_parsed` to CredentialSource | Migration | 0 |
| 2 | Document type classifier (Claude Haiku) | 2 | 4 |
| 3 | Textract extraction pipeline | 2 | 4 |
| 4 | Claude Vision extraction pipeline | 2 | 4 |
| 5 | Credential field mapper | 2 | 6 |
| 6 | Document agent processor | 2 | 5 |
| 7 | Wire into BullMQ worker | 0 (modify) | 1 |
| 8 | Coordinator dispatch function | 0 (modify) | 1 |
| 9 | API route for document parsing | 0 (modify) | 2 |
| 10 | End-to-end integration test | 0 | 0 |

**Total: ~10 new files, ~27 new tests**
