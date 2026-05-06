/**
 * Outbound webhook delivery worker (Phase 0.A PR 4, sub-chunk 4B).
 *
 * Single BullMQ Worker bound to the WEBHOOK_DELIVERY queue. Each job
 * delivers exactly one WebhookDelivery row to its subscription's URL and
 * mutates the row to reflect the outcome.
 *
 * Hardening (per PRD §7 Phase 0.A Addition 1):
 *   - SSRF re-check at delivery time (not just at create time) — defends
 *     against DNS rebinding where a hostname resolves to a public IP at
 *     subscription creation and a private IP at delivery.
 *   - HMAC-SHA256 over `${unix-timestamp}.${body}`, sent as
 *       X-Lanyard-Signature: t=<unix>,v1=<hex>
 *     so receivers can verify with constant-time comparison and a
 *     timestamp tolerance (mirrors Stripe's webhook signing convention).
 *   - 10-second hard timeout per attempt via AbortController.
 *   - Response body capped at 2 KB at read time and stored in
 *     WebhookDelivery.responseSnippet — schema permits any length so we
 *     can adjust the cap without migration.
 *   - TLS verification mandatory — we use Node's global fetch (undici),
 *     which validates certificates by default. We do NOT honor any
 *     Lanyard-specific env flag for cert bypass. The only Node-wide
 *     escape hatch is NODE_TLS_REJECT_UNAUTHORIZED, which is an
 *     operational/runtime concern outside this code.
 *   - Retry on 5xx, 408, 429, transport errors, and timeouts; do NOT
 *     retry on other 4xx (those are caller errors that retrying won't
 *     fix — receiver should be re-configured).
 *   - Once BullMQ exhausts the retry budget (attempts=8), the row is
 *     marked status='dead' as the DLQ marker.
 */
import type { Job, Worker } from 'bullmq';
import { Worker as BullWorker, UnrecoverableError } from 'bullmq';
import { createHmac } from 'node:crypto';

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { decryptSafe } from '../utils/crypto.js';
import { checkSsrfSafety } from '../utils/ssrf-guard.js';
import { getRedisConfig } from '../utils/redis.js';
import { QUEUE_NAMES, QUEUE_LOCK_DURATIONS } from './queues.js';

const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_CAP_BYTES = 2 * 1024; // 2 KB per Phase 0.A Addition 1
const RETRYABLE_HTTP_STATUSES = new Set([408, 429]);

export interface WebhookDeliveryJobData {
  deliveryId: string;
}

let worker: Worker | null = null;

function isRetryableStatus(status: number): boolean {
  if (status >= 500) return true;
  return RETRYABLE_HTTP_STATUSES.has(status);
}

/**
 * Read up to `cap` bytes of `response.body` and return as UTF-8 string.
 * Closes the underlying stream so we don't leak sockets when receivers
 * try to send more than the cap.
 */
async function readBodyCapped(response: Response, cap: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < cap) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = cap - total;
      if (value.byteLength <= remaining) {
        chunks.push(value);
        total += value.byteLength;
      } else {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        break;
      }
    }
  } finally {
    // Cancel signals the receiver we're done; without it the connection
    // stays open until the receiver finishes or our socket times out.
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return buf.toString('utf8');
}

function buildSignatureHeader(secret: string, body: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${body}`;
  const v1 = createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

interface AttemptOutcome {
  status: 'delivered' | 'failed' | 'dead';
  responseStatus: number | null;
  responseSnippet: string | null;
  errorMessage: string | null;
  retryable: boolean;
}

async function attemptDelivery(
  url: string,
  signedBody: string,
  signatureHeader: string,
  eventType: string,
  deliveryId: string
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Lanyard-Webhooks/1.0',
        'X-Lanyard-Signature': signatureHeader,
        'X-Lanyard-Event-Type': eventType,
        'X-Lanyard-Delivery-Id': deliveryId,
      },
      body: signedBody,
    });

    const snippet = await readBodyCapped(response, RESPONSE_BODY_CAP_BYTES);

    if (response.ok) {
      return {
        status: 'delivered',
        responseStatus: response.status,
        responseSnippet: snippet,
        errorMessage: null,
        retryable: false,
      };
    }
    const retryable = isRetryableStatus(response.status);
    return {
      status: retryable ? 'failed' : 'dead',
      responseStatus: response.status,
      responseSnippet: snippet,
      errorMessage: `HTTP ${response.status}`,
      retryable,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      responseStatus: null,
      responseSnippet: null,
      errorMessage: isAbort ? `Request timed out after ${REQUEST_TIMEOUT_MS} ms` : `Transport error: ${message}`,
      retryable: true,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function processWebhookDeliveryJob(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { deliveryId } = job.data;

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      subscription: {
        select: {
          id: true,
          url: true,
          secretEncrypted: true,
          active: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!delivery) {
    // Already deleted — nothing to do, swallow silently so BullMQ marks complete.
    logger.warn('WebhookDelivery row missing — skipping', { deliveryId });
    return;
  }
  if (!delivery.subscription || delivery.subscription.deletedAt || !delivery.subscription.active) {
    // Subscription was paused or removed between enqueue and processing.
    // Mark dead with a synthetic reason; do NOT throw (no point retrying).
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'dead',
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        errorMessage: 'Subscription paused or deleted between enqueue and delivery',
      },
    });
    return;
  }

  // SSRF re-check — DNS rebinding defense. Hostname may have resolved to a
  // public IP at subscription create time and a private IP now.
  const ssrf = await checkSsrfSafety(delivery.subscription.url);
  if (!ssrf.ok) {
    logger.warn('Webhook delivery rejected by SSRF re-check', {
      deliveryId,
      url: delivery.subscription.url,
      reason: ssrf.reason,
    });
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'dead',
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        errorMessage: `SSRF guard: ${ssrf.reason}`,
      },
    });
    // UnrecoverableError tells BullMQ to fail without further retries —
    // private-IP resolution is not a transient failure.
    throw new UnrecoverableError(`SSRF guard rejected delivery: ${ssrf.reason}`);
  }

  const secret = decryptSafe(delivery.subscription.secretEncrypted);
  const body = JSON.stringify(delivery.payload);
  const signatureHeader = buildSignatureHeader(secret, body);

  const outcome = await attemptDelivery(
    delivery.subscription.url,
    body,
    signatureHeader,
    delivery.eventType,
    delivery.id
  );

  // Compute terminal-vs-retry state. BullMQ's job.opts.attempts is the
  // configured retry budget; job.attemptsMade is the zero-indexed count of
  // attempts already made (this attempt counts as +1 in BullMQ's view).
  const totalAttempts = job.opts.attempts ?? 1;
  const isFinalAttempt = job.attemptsMade + 1 >= totalAttempts;
  const finalStatus: 'delivered' | 'failed' | 'dead' =
    outcome.status === 'delivered'
      ? 'delivered'
      : outcome.retryable && !isFinalAttempt
        ? 'failed'
        : 'dead';

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: finalStatus,
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      responseStatus: outcome.responseStatus,
      responseSnippet: outcome.responseSnippet,
      errorMessage: outcome.errorMessage,
      ...(finalStatus === 'delivered' ? { deliveredAt: new Date() } : {}),
    },
  });

  if (finalStatus === 'delivered') {
    await prisma.webhookSubscription
      .update({
        where: { id: delivery.subscription.id },
        data: { lastDeliveryAt: new Date(), consecutiveFailures: 0 },
      })
      .catch((err) => {
        logger.warn('Failed to update subscription lastDeliveryAt', { err });
      });
    return;
  }

  // Failed / dead: bump observability counters on the subscription. Done
  // best-effort so a counter-update failure doesn't break retry semantics.
  await prisma.webhookSubscription
    .update({
      where: { id: delivery.subscription.id },
      data: { lastFailureAt: new Date(), consecutiveFailures: { increment: 1 } },
    })
    .catch((err) => {
      logger.warn('Failed to update subscription failure counters', { err });
    });

  // Throw on retryable transient failures so BullMQ schedules a retry.
  // Throw with UnrecoverableError on non-retryable so BullMQ stops.
  if (outcome.retryable && !isFinalAttempt) {
    throw new Error(outcome.errorMessage ?? 'Retryable webhook delivery failure');
  }
  if (!outcome.retryable) {
    throw new UnrecoverableError(outcome.errorMessage ?? 'Non-retryable webhook delivery failure');
  }
  // retryable + final attempt → already marked dead; throw so BullMQ logs
  // it as 'failed' in its own job lifecycle (matches DLQ semantics).
  throw new Error(outcome.errorMessage ?? 'Webhook delivery exhausted retry budget');
}

export function initializeWebhookDeliveryWorker(): void {
  if (worker) {
    logger.warn('Webhook delivery worker already initialized — skipping');
    return;
  }
  const connection = getRedisConfig();
  worker = new BullWorker<WebhookDeliveryJobData>(
    QUEUE_NAMES.WEBHOOK_DELIVERY,
    processWebhookDeliveryJob,
    {
      connection,
      concurrency: 10,
      lockDuration: QUEUE_LOCK_DURATIONS[QUEUE_NAMES.WEBHOOK_DELIVERY],
      stalledInterval: QUEUE_LOCK_DURATIONS[QUEUE_NAMES.WEBHOOK_DELIVERY] + 30_000,
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[webhook-delivery] Job ${job.id} completed`, {
      deliveryId: job.data.deliveryId,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error(`[webhook-delivery] Job ${job?.id} failed: ${err.message}`, {
      deliveryId: job?.data.deliveryId,
      attemptsMade: job?.attemptsMade,
      error: err.message,
    });
  });

  logger.info('Webhook delivery worker initialized (concurrency 10, attempts 8)');
}

export async function closeWebhookDeliveryWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
  logger.info('Webhook delivery worker closed');
}
