import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

import { extractWithVision } from './vision-extractor.js';

describe('vision-extractor', () => {
  beforeEach(() => {
    mockCreate.mockReset();
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
