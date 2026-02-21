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

/** @internal Visible for testing only */
export let textractClient: TextractClient | null = null;

/** @internal Reset singleton for testing */
export function _resetTextractClient(): void {
  textractClient = null;
}

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
