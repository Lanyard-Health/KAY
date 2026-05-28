import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set the OpenAI API key BEFORE importing the service — the module captures it
// at top-level (const OPENAI_API_KEY = process.env['OPENAI_API_KEY']).
vi.hoisted(() => {
  process.env['OPENAI_API_KEY'] = 'sk-test-key';
});

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mock prisma — not exercised by generateEmbedding directly, but the module loads it.
vi.mock('../utils/prisma.js', () => ({
  prisma: { $executeRaw: vi.fn(), $queryRaw: vi.fn() },
}));

const { generateEmbedding } = await import('./knowledgeBase.embedding.service.js');

function rateLimitResponse(): Response {
  return new Response(JSON.stringify({ error: { type: 'rate_limit_error' } }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });
}

function successResponse(): Response {
  return new Response(
    JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.1) }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('generateEmbedding — vendor 429 retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns embedding on first try when no error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(successResponse());

    const promise = generateEmbedding('hello world');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toHaveLength(1536);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds on the second attempt', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(successResponse());

    const promise = generateEmbedding('hello world');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toHaveLength(1536);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries up to 3 total attempts then throws a 429 error with status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(rateLimitResponse());

    const promise = generateEmbedding('hello world');
    const assertion = expect(promise).rejects.toMatchObject({ status: 429 });
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('does NOT retry on non-429 errors', async () => {
    const fiveHundred = new Response(JSON.stringify({ error: 'server' }), { status: 500 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fiveHundred);

    const promise = generateEmbedding('hello world');
    const assertion = expect(promise).rejects.toMatchObject({ status: 500 });
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
