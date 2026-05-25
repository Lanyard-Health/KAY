import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLLM, callLLMForText, setLLMClientForTesting, resetLLMClient } from './llm.js';
import type Anthropic from '@anthropic-ai/sdk';

function mockClient(response: Partial<Anthropic.Messages.Message> = {}): {
  create: ReturnType<typeof vi.fn>;
  client: Anthropic;
} {
  const defaultResp: Anthropic.Messages.Message = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text: 'hello', citations: null }],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    } as Anthropic.Messages.Message['usage'],
    container: null,
    ...response,
  };
  const create = vi.fn().mockResolvedValue(defaultResp);
  const client = { messages: { create } } as unknown as Anthropic;
  return { create, client };
}

describe('callLLM', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key';
  });

  afterEach(() => {
    resetLLMClient();
    setLLMClientForTesting(null);
  });

  it('calls SDK with non-cacheable system as plain string', async () => {
    const { create, client } = mockClient();
    setLLMClientForTesting(client);

    await callLLM({
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    expect(call.system).toBe('You are a helpful assistant.');
    expect(call.model).toBe('claude-sonnet-4-20250514');
    expect(call.max_tokens).toBe(100);
  });

  it('wraps system in cache_control array when cacheable=true', async () => {
    const { create, client } = mockClient();
    setLLMClientForTesting(client);

    await callLLM({
      system: 'cached prompt',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      cacheable: true,
    });

    const call = create.mock.calls[0][0];
    expect(call.system).toEqual([
      { type: 'text', text: 'cached prompt', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('adds cache_control to LAST tool only when cacheable=true', async () => {
    const { create, client } = mockClient();
    setLLMClientForTesting(client);

    const tools: Anthropic.Tool[] = [
      { name: 'a', description: 'A', input_schema: { type: 'object', properties: {} } },
      { name: 'b', description: 'B', input_schema: { type: 'object', properties: {} } },
      { name: 'c', description: 'C', input_schema: { type: 'object', properties: {} } },
    ];

    await callLLM({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      tools,
      cacheable: true,
    });

    const call = create.mock.calls[0][0];
    expect(call.tools).toHaveLength(3);
    expect(call.tools[0]).not.toHaveProperty('cache_control');
    expect(call.tools[1]).not.toHaveProperty('cache_control');
    expect(call.tools[2].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does not add cache_control to tools when cacheable=false', async () => {
    const { create, client } = mockClient();
    setLLMClientForTesting(client);

    const tools: Anthropic.Tool[] = [
      { name: 'a', description: 'A', input_schema: { type: 'object', properties: {} } },
    ];

    await callLLM({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      tools,
    });

    const call = create.mock.calls[0][0];
    expect(call.tools[0]).not.toHaveProperty('cache_control');
  });

  it('omits system from SDK call when not provided', async () => {
    const { create, client } = mockClient();
    setLLMClientForTesting(client);

    await callLLM({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    const call = create.mock.calls[0][0];
    expect(call).not.toHaveProperty('system');
  });

  it('honors custom model override', async () => {
    const { create, client } = mockClient();
    setLLMClientForTesting(client);

    await callLLM({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      model: 'claude-haiku-4-5-20251001',
    });

    const call = create.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5-20251001');
  });

  it('returns normalized response shape', async () => {
    const { client } = mockClient({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
        server_tool_use: null,
        service_tier: null,
      } as Anthropic.Messages.Message['usage'],
      content: [
        { type: 'text', text: 'first', citations: null },
        { type: 'text', text: 'second', citations: null },
      ],
      stop_reason: 'end_turn',
    });
    setLLMClientForTesting(client);

    const res = await callLLM({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(res.inputTokens).toBe(100);
    expect(res.outputTokens).toBe(50);
    expect(res.cacheCreationTokens).toBe(200);
    expect(res.cacheReadTokens).toBe(300);
    expect(res.text).toBe('first\nsecond');
    expect(res.content).toHaveLength(2);
    expect(res.stopReason).toBe('end_turn');
  });

  it('defaults cache fields to 0 when SDK omits them', async () => {
    const { client } = mockClient({
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      } as unknown as Anthropic.Messages.Message['usage'],
    });
    setLLMClientForTesting(client);

    const res = await callLLM({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(res.cacheCreationTokens).toBe(0);
    expect(res.cacheReadTokens).toBe(0);
  });

  it('propagates SDK errors unchanged', async () => {
    const create = vi.fn().mockRejectedValue(new Error('rate limited'));
    const client = { messages: { create } } as unknown as Anthropic;
    setLLMClientForTesting(client);

    await expect(
      callLLM({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      })
    ).rejects.toThrow('rate limited');
  });

  it('throws when ANTHROPIC_API_KEY is missing and no test client is set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    resetLLMClient();
    setLLMClientForTesting(null);

    await expect(
      callLLM({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      })
    ).rejects.toThrow('ANTHROPIC_API_KEY');
  });
});

describe('callLLMForText', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key';
  });

  afterEach(() => {
    resetLLMClient();
    setLLMClientForTesting(null);
  });

  it('returns joined text when content has text blocks', async () => {
    const { client } = mockClient({
      content: [{ type: 'text', text: 'answer', citations: null }],
    });
    setLLMClientForTesting(client);

    const text = await callLLMForText({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    });

    expect(text).toBe('answer');
  });

  it('throws when no text blocks are present', async () => {
    const { client } = mockClient({ content: [] });
    setLLMClientForTesting(client);

    await expect(
      callLLMForText({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      })
    ).rejects.toThrow('No text response');
  });
});
