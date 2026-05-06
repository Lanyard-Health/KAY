/**
 * Per-model token pricing for Anthropic Claude.
 *
 * Source of truth: https://www.anthropic.com/pricing
 * Reviewed against the public pricing page on 2026-05-06.
 *
 * Rates are quoted in USD per 1,000 tokens; we store them as cents-per-token
 * (multiplied by 0.1 inline) so the arithmetic in `priceCents()` stays in
 * decimal cents and matches the `cost_cents Decimal(10,4)` schema column
 * without floating-point drift on small values.
 *
 * Maintenance: when AI_MODEL is changed in env config — or when Anthropic
 * publishes a new pricing tier — re-verify the rates against the pricing
 * page above and update the entries below. CONTRIBUTING note: any model
 * revision is required to trigger a pricing review (see Phase 0.A PR 3).
 *
 * The unknown-model path returns 0 cents and logs a warning rather than
 * throwing — telemetry is fail-soft, and an under-counted cost row is
 * preferable to losing the row entirely.
 */
import { logger } from './logger.js';

interface ModelRate {
  // Cents per input token (i.e. USD/1k * 0.1).
  inputCentsPerToken: number;
  // Cents per output token.
  outputCentsPerToken: number;
}

// USD per 1k tokens (from Anthropic pricing page) → cents per token.
//   $0.003 / 1k input  → 0.0003 ¢/token
//   $0.015 / 1k output → 0.0015 ¢/token
const SONNET_4_RATE: ModelRate = {
  inputCentsPerToken: 0.0003,
  outputCentsPerToken: 0.0015,
};

const MODEL_RATES: Record<string, ModelRate> = {
  'claude-sonnet-4-20250514': SONNET_4_RATE,
  'claude-sonnet-4': SONNET_4_RATE,
};

const DEFAULT_MODEL_KEY = 'claude-sonnet-4-20250514';

export function getModelRate(model: string | undefined): ModelRate | null {
  if (!model) return MODEL_RATES[DEFAULT_MODEL_KEY] ?? null;
  return MODEL_RATES[model] ?? null;
}

/**
 * Returns the cost in cents (as a number — caller stores it via Prisma Decimal).
 * Fail-soft: unknown model → 0 cents + warn-level log.
 */
export function priceCents(
  model: string | undefined,
  inputTokens: number,
  outputTokens: number
): number {
  const rate = getModelRate(model);
  if (!rate) {
    logger.warn('Unknown AI model for cost calculation — recording 0¢', { model });
    return 0;
  }
  if (inputTokens < 0 || outputTokens < 0) return 0;
  return inputTokens * rate.inputCentsPerToken + outputTokens * rate.outputCentsPerToken;
}
