import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

import { classifyDocumentType } from './document-classifier.js';

describe('document-classifier', () => {
  beforeEach(() => {
    mockCreate.mockReset();
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
