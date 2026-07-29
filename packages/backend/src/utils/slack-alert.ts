import os from 'os';
import { logger } from './logger.js';
import { scrubMessage, redactValue } from './log-sanitizer.js';
import { getRequestId } from './request-context.js';

/**
 * Real-time operational alerts to Slack so a human knows something broke before
 * a customer reports it. Complements Sentry (which captures everything for
 * debugging) — this is the "wake someone up" channel for 5xx errors, crashed
 * workers, and unhandled rejections.
 *
 * Setup (one-time, by an operator):
 *   1. Slack → create an Incoming Webhook for the target channel.
 *   2. Set SLACK_ALERT_WEBHOOK_URL in the backend's Render env vars.
 * When the var is unset the alerter is a no-op (same pattern as Sentry's DSN),
 * so local/dev/test never post and CI needs no secret.
 *
 * Guarantees: never throws (alerting must not break the request that triggered
 * it), PII-scrubbed, and deduped so one incident doesn't flood the channel.
 */

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // same alert at most once per 5 min
const POST_TIMEOUT_MS = 3000;
const recentlySent = new Map<string, number>();

export interface SlackAlertOptions {
  title: string;
  level?: 'warning' | 'error' | 'fatal';
  error?: unknown;
  /** Structured extra fields; values are PII-scrubbed before sending. */
  context?: Record<string, unknown>;
  /** Where the alert originated, e.g. 'http-5xx', 'agent-worker'. */
  source?: string;
}

const LEVEL_EMOJI: Record<string, string> = {
  warning: ':warning:',
  error: ':rotating_light:',
  fatal: ':skull:',
};

function isDuplicate(key: string, now: number): boolean {
  const last = recentlySent.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return true;
  recentlySent.set(key, now);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (recentlySent.size > 500) {
    for (const [k, t] of recentlySent) {
      if (now - t >= DEDUP_WINDOW_MS) recentlySent.delete(k);
    }
  }
  return false;
}

function errorSummary(error: unknown): { name?: string; message?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: scrubMessage(error.message) };
  }
  if (error != null) return { message: scrubMessage(String(error)) };
  return {};
}

/**
 * Fire-and-forget a Slack alert. Returns true if a message was actually posted,
 * false if it was skipped (no webhook configured, or deduped). Never rejects.
 */
export async function sendSlackAlert(opts: SlackAlertOptions): Promise<boolean> {
  const webhook = process.env['SLACK_ALERT_WEBHOOK_URL'];
  if (!webhook) return false;

  try {
    const level = opts.level ?? 'error';
    const title = scrubMessage(opts.title);
    const err = errorSummary(opts.error);
    const now = Date.now();

    const dedupKey = `${level}|${title}|${err.name ?? ''}|${err.message ?? ''}`;
    if (isDuplicate(dedupKey, now)) return false;

    const env = process.env['NODE_ENV'] || 'development';
    const requestId = getRequestId();
    const fields: string[] = [`*env:* ${env}`, `*host:* ${os.hostname()}`];
    if (opts.source) fields.push(`*source:* ${opts.source}`);
    if (requestId) fields.push(`*request:* ${requestId}`);
    if (err.name) fields.push(`*error:* ${err.name}`);

    const lines = [
      `${LEVEL_EMOJI[level] ?? ':rotating_light:'} *${title}*`,
      fields.join('  ·  '),
    ];
    if (err.message) lines.push('```' + err.message.slice(0, 800) + '```');
    if (opts.context && Object.keys(opts.context).length > 0) {
      const safe = redactValue(opts.context);
      lines.push('```' + JSON.stringify(safe).slice(0, 800) + '```');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: lines.join('\n') }),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn('Slack alert POST returned non-2xx', { status: res.status });
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (postErr) {
    // Alerting failures must never propagate into the caller's path.
    logger.warn('Slack alert failed to send', {
      reason: postErr instanceof Error ? postErr.message : 'unknown',
    });
    return false;
  }
}

/** Test-only: clear the dedup cache between cases. */
export function __resetSlackAlertDedup(): void {
  recentlySent.clear();
}
