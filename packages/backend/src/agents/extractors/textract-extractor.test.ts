import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockSend, MockTextractClient, MockAnalyzeDocumentCommand } = vi.hoisted(() => {
  const mockSend = vi.fn();
  const MockTextractClient = vi.fn();
  const MockAnalyzeDocumentCommand = vi.fn();
  return { mockSend, MockTextractClient, MockAnalyzeDocumentCommand };
});

vi.mock('@aws-sdk/client-textract', () => ({
  TextractClient: MockTextractClient,
  AnalyzeDocumentCommand: MockAnalyzeDocumentCommand,
}));

import { extractWithTextract, _resetTextractClient } from './textract-extractor.js';

describe('textract-extractor', () => {
  beforeEach(() => {
    _resetTextractClient();
    vi.resetAllMocks();
    // Re-apply mock implementations after reset
    MockTextractClient.mockImplementation(function () {
      return { send: mockSend };
    });
    MockAnalyzeDocumentCommand.mockImplementation(function (input: unknown) {
      return { input };
    });
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
