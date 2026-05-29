import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { callLLM, setLLMClientForTesting, resetLLMClient } from './llm.js';

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function makeRateLimitError(): Anthropic.APIError {
  const err = new Anthropic.APIError(429, { error: { message: 'rate limited' } }, 'rate limited', undefined);
  return err;
}

function makeSuccessResponse(): unknown {
  return {
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    stop_reason: 'end_turn',
  };
}

describe('callLLM retry with backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetLLMClient();
  });

  it('returns successfully on first try when no error', async () => {
    const mockCreate = vi.fn().mockResolvedValue(makeSuccessResponse());
    setLLMClientForTesting({ messages: { create: mockCreate } } as unknown as Anthropic);

    const promise = callLLM({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('ok');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds on the second attempt', async () => {
    const mockCreate = vi
      .fn()
      .mockRejectedValueOnce(makeRateLimitError())
      .mockResolvedValue(makeSuccessResponse());
    setLLMClientForTesting({ messages: { create: mockCreate } } as unknown as Anthropic);

    const promise = callLLM({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('ok');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries up to 3 total attempts then throws the last 429', async () => {
    const mockCreate = vi.fn().mockRejectedValue(makeRateLimitError());
    setLLMClientForTesting({ messages: { create: mockCreate } } as unknown as Anthropic);

    const promise = callLLM({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    const assertion = expect(promise).rejects.toBeInstanceOf(Anthropic.APIError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(mockCreate).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('does NOT retry on non-429 errors', async () => {
    const otherErr = new Anthropic.APIError(500, { error: { message: 'server error' } }, 'server error', undefined);
    const mockCreate = vi.fn().mockRejectedValue(otherErr);
    setLLMClientForTesting({ messages: { create: mockCreate } } as unknown as Anthropic);

    const promise = callLLM({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    const assertion = expect(promise).rejects.toBe(otherErr);
    await vi.runAllTimersAsync();
    await assertion;

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
