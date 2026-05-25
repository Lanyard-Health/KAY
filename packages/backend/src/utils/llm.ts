import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';

/**
 * LLM call wrapper. Single chokepoint for every Anthropic SDK call in the
 * backend. Three jobs:
 *
 *   1. Centralize client construction (lazy singleton, env-key lookup)
 *   2. Centralize prompt-caching wire format (system + last-tool markers)
 *   3. Return a normalized response shape so call sites don't recompute usage
 *      math or re-implement text extraction.
 *
 * Provider portability: this wrapper is intentionally Anthropic-typed today —
 * `content` returns `Anthropic.ContentBlock[]` so the orchestrator's tool-use
 * discriminated unions keep working. A future provider swap re-implements
 * `callLLM` to translate; call sites stay the shape they are.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export interface LLMCallParams {
  /** System prompt. Optional — vision-extractor and document-classifier
   *  pass everything in messages. */
  system?: string;
  messages: Anthropic.MessageParam[];
  /** Tool definitions. Required for orchestrator's tool-use loop. */
  tools?: Anthropic.Tool[];
  /** Model override. Defaults to AI_MODEL env (Sonnet). */
  model?: string;
  /** Required — caller knows the prompt shape, must pick a sane cap. */
  maxTokens: number;
  /** When true, marks system + last tool with cache_control: ephemeral.
   *  90% discount on cached input tokens. Use for hot paths where the same
   *  system prompt is sent repeatedly within 5 minutes. */
  cacheable?: boolean;
}

export interface LLMResponse {
  /** Raw SDK content blocks. Call sites that need tool_use discrimination
   *  filter this. Call sites that only want text should use `.text` below. */
  content: Anthropic.ContentBlock[];
  /** Convenience: joined text blocks. Empty string if no text blocks. */
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Echoed back so call sites can record which model was actually used. */
  model: string;
  stopReason: Anthropic.Messages.Message['stop_reason'];
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    client = new Anthropic({ apiKey, timeout: DEFAULT_TIMEOUT_MS });
  }
  return client;
}

/** Test seam — tests substitute a mock client without going through env. */
export function setLLMClientForTesting(mock: Anthropic | null): void {
  client = mock;
}

/** Lazy reset for tests that need a fresh client (env-var changes mid-run). */
export function resetLLMClient(): void {
  client = null;
}

function isConfigured(): boolean {
  return !!process.env['ANTHROPIC_API_KEY'];
}

export { isConfigured as isLLMConfigured };

export async function callLLM(params: LLMCallParams): Promise<LLMResponse> {
  const c = getClient();
  const model = params.model || process.env['AI_MODEL'] || DEFAULT_MODEL;

  // Build system prompt — cacheable wraps it in the array form Anthropic expects.
  const system = params.cacheable && params.system
    ? [{ type: 'text' as const, text: params.system, cache_control: { type: 'ephemeral' as const } }]
    : params.system;

  // Build tools — cacheable adds cache_control to the LAST tool so the entire
  // tools array (plus system) is cached as one prefix.
  const tools = params.tools
    ? params.cacheable
      ? params.tools.map((tool, idx, arr) =>
          idx === arr.length - 1
            ? ({ ...tool, cache_control: { type: 'ephemeral' as const } } as Anthropic.Tool)
            : tool
        )
      : params.tools
    : undefined;

  const createParams: Anthropic.MessageCreateParams = {
    model,
    max_tokens: params.maxTokens,
    messages: params.messages,
    ...(system !== undefined ? { system: system as Anthropic.MessageCreateParams['system'] } : {}),
    ...(tools ? { tools } : {}),
  };

  const response = await c.messages.create(createParams) as Anthropic.Messages.Message;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return {
    content: response.content,
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    model,
    stopReason: response.stop_reason,
  };
}

/** Sometimes call sites just want the joined text and don't care about usage.
 *  Thin convenience that throws if the model returned no text (most callers
 *  treat that as a fatal "AI didn't respond" condition anyway). */
export async function callLLMForText(params: LLMCallParams): Promise<string> {
  const res = await callLLM(params);
  if (!res.text) {
    logger.warn('LLM call returned no text content', { model: res.model, stopReason: res.stopReason });
    throw new Error('No text response from LLM');
  }
  return res.text;
}
