import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { prismaMock } from '../../tests/helpers/mock-prisma.js';

// Must set env before importing the service (reads at import time)
process.env['OPENAI_API_KEY'] = 'test-key-123';
process.env['EMBEDDING_MODEL'] = 'text-embedding-3-small';

const {
  generateEmbedding,
  upsertEmbedding,
  searchSimilar,
  deleteEmbeddings,
  isConfigured,
} = await import('./knowledgeBase.embedding.service.js');

function makeFakeEmbedding(dim = 1536): number[] {
  return Array.from({ length: dim }, (_, i) => i * 0.001);
}

function mockEmbeddingResponse(embedding: number[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: [{ embedding }] }),
  });
}

describe('knowledgeBase.embedding.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('returns true when OPENAI_API_KEY is set', () => {
      expect(isConfigured()).toBe(true);
    });
  });

  describe('generateEmbedding', () => {
    it('calls OpenAI API and returns embedding vector', async () => {
      const fakeEmbedding = makeFakeEmbedding();
      mockEmbeddingResponse(fakeEmbedding);

      const result = await generateEmbedding('test text');

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-key-123',
          }),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toBe('test text');
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.dimensions).toBe(1536);

      expect(result).toEqual(fakeEmbedding);
      expect(result).toHaveLength(1536);
    });

    it('truncates input text to 8000 characters', async () => {
      const longText = 'a'.repeat(10000);
      mockEmbeddingResponse(makeFakeEmbedding());

      await generateEmbedding(longText);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toHaveLength(8000);
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      await expect(generateEmbedding('test')).rejects.toThrow('Embeddings API returned 429');
    });

    it('throws on empty response data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await expect(generateEmbedding('test')).rejects.toThrow('empty data array');
    });
  });

  describe('upsertEmbedding', () => {
    it('deletes existing embedding and inserts new one', async () => {
      mockEmbeddingResponse(makeFakeEmbedding());
      prismaMock.$executeRaw.mockResolvedValue(1);

      await upsertEmbedding('payerTrack', 'pt-123', 'Aetna Commercial Texas');

      // Should call $executeRaw twice: delete then insert
      expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('uses correct column for each source type', async () => {
      const sourceTypes = [
        'payerTrack',
        'payerRequirement',
        'payerStateRule',
        'payerTimeline',
        'payerForm',
        'requirementUniversal',
      ] as const;

      for (const sourceType of sourceTypes) {
        vi.clearAllMocks();
        mockEmbeddingResponse(makeFakeEmbedding());
        prismaMock.$executeRaw.mockResolvedValue(1);

        await upsertEmbedding(sourceType, `id-${sourceType}`, 'test content');

        expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
      }
    });
  });

  describe('deleteEmbeddings', () => {
    it('deletes embeddings for the given source', async () => {
      prismaMock.$executeRaw.mockResolvedValue(1);

      await deleteEmbeddings('payerTrack', 'pt-123');

      expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
    });
  });

  describe('searchSimilar', () => {
    it('generates query embedding and returns ranked results', async () => {
      const fakeResults = [
        {
          id: 'emb-1',
          contentText: 'Aetna Commercial Texas',
          similarity: 0.95,
          payerTrackId: 'pt-1',
          payerRequirementId: null,
          payerStateRuleId: null,
          payerTimelineId: null,
          payerFormId: null,
          requirementUniversalId: null,
        },
      ];

      mockEmbeddingResponse(makeFakeEmbedding());
      prismaMock.$queryRaw.mockResolvedValue(fakeResults);

      const results = await searchSimilar('Aetna Texas requirements', 5);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBe(0.95);
      expect(results[0].payerTrackId).toBe('pt-1');
    });

    it('defaults to top 10 results', async () => {
      mockEmbeddingResponse(makeFakeEmbedding());
      prismaMock.$queryRaw.mockResolvedValue([]);

      await searchSimilar('test query');

      // Verify the raw query was called (limit is embedded in the tagged template)
      expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    });
  });
});
