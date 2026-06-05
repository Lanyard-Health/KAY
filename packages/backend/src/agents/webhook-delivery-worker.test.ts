import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/crypto.js', () => ({
  encryptSafe: vi.fn((s: string) => `enc:${s}`),
  decryptSafe: vi.fn((s: string) => s.replace(/^enc:/, '')),
}));

vi.mock('../utils/ssrf-guard.js', () => ({
  checkSsrfSafety: vi.fn(),
}));

import { processWebhookDeliveryJob } from './webhook-delivery-worker.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { checkSsrfSafety } from '../utils/ssrf-guard.js';

import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';

const ssrfMock = checkSsrfSafety as unknown as ReturnType<typeof vi.fn>;
const fetchMock = vi.fn() as unknown as ReturnType<typeof vi.fn>;
(globalThis as any).fetch = fetchMock;

const TEST_SECRET = 'super-secret-key';
const SUB_ID = 'sub-1';
const DELIVERY_ID = 'del-1';
const URL = 'https://example.com/webhook';

interface CapturedUpdate {
  where: { id: string };
  data: Record<string, unknown>;
}

function makeJob(attemptsMade: number, attempts = 8): Job<{ deliveryId: string }> {
  return {
    id: `job-${attemptsMade}`,
    data: { deliveryId: DELIVERY_ID },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<{ deliveryId: string }>;
}

function makeDeliveryRow(overrides: Partial<{ active: boolean; deletedAt: Date | null }> = {}) {
  return {
    id: DELIVERY_ID,
    subscriptionId: SUB_ID,
    eventType: 'agent_event.created',
    eventId: 'src-event-1',
    payload: { eventId: 'src-event-1', workflowId: 'wf-1' },
    status: 'pending',
    attemptCount: 0,
    lastAttemptAt: null,
    responseStatus: null,
    responseSnippet: null,
    errorMessage: null,
    createdAt: new Date(),
    deliveredAt: null,
    subscription: {
      id: SUB_ID,
      url: URL,
      secretEncrypted: `enc:${TEST_SECRET}`,
      active: overrides.active ?? true,
      deletedAt: overrides.deletedAt ?? null,
    },
  };
}

function jsonResponse(status: number, body: string, contentType = 'application/json'): Response {
  // Use a real Web Streams body so readBodyCapped exercises the same path
  // it does in production. supports up to ~1 MB without backpressure issues.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': contentType },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ssrfMock.mockResolvedValue({ ok: true, ip: '93.184.216.34' });
  prismaMock.webhookDelivery.update.mockImplementation(async (args: unknown) => {
    const { data } = args as CapturedUpdate;
    return data as never;
  });
  prismaMock.webhookSubscription.update.mockResolvedValue({} as never);
});

afterEach(() => {
  fetchMock.mockReset();
});

describe('processWebhookDeliveryJob — success path', () => {
  it('marks delivered on 200 and updates subscription health', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, '{"ok":true}'));

    await processWebhookDeliveryJob(makeJob(0));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The first update is the delivery row.
    const deliveryUpdate = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(deliveryUpdate.where).toEqual({ id: DELIVERY_ID });
    expect(deliveryUpdate.data['status']).toBe('delivered');
    expect(deliveryUpdate.data['responseStatus']).toBe(200);
    expect(deliveryUpdate.data['deliveredAt']).toBeInstanceOf(Date);

    // Then the subscription row gets lastDeliveryAt + consecutiveFailures reset.
    const subUpdate = prismaMock.webhookSubscription.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(subUpdate.data['lastDeliveryAt']).toBeInstanceOf(Date);
    expect(subUpdate.data['consecutiveFailures']).toBe(0);
  });

  it('signs the request body with HMAC-SHA256 in t=<unix>,v1=<hex> format', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ''));

    await processWebhookDeliveryJob(makeJob(0));

    const fetchArgs = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    const headers = fetchArgs[1].headers;
    const sigHeader = headers['X-Lanyard-Signature'];
    expect(sigHeader).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);

    // Reconstruct the signature using the same secret + body and confirm match.
    const body = String(fetchArgs[1].body);
    const m = sigHeader!.match(/^t=(\d+),v1=([a-f0-9]{64})$/);
    expect(m).not.toBeNull();
    const [, ts, v1] = m!;
    const expected = createHmac('sha256', TEST_SECRET).update(`${ts}.${body}`).digest('hex');
    expect(v1).toBe(expected);

    // Routing headers
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Lanyard-Event-Type']).toBe('agent_event.created');
    expect(headers['X-Lanyard-Delivery-Id']).toBe(DELIVERY_ID);
  });
});

describe('processWebhookDeliveryJob — retry + DLQ semantics', () => {
  it('marks failed (transient) and throws on 503 when retry budget remains', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(503, 'try again later'));

    // attemptsMade=0, attempts=8 → 7 retries remain → should mark 'failed' + throw
    await expect(processWebhookDeliveryJob(makeJob(0, 8))).rejects.toThrow(/HTTP 503/);

    const deliveryUpdate = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(deliveryUpdate.data['status']).toBe('failed');
    expect(deliveryUpdate.data['responseStatus']).toBe(503);

    const subUpdate = prismaMock.webhookSubscription.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(subUpdate.data['lastFailureAt']).toBeInstanceOf(Date);
    expect((subUpdate.data['consecutiveFailures'] as { increment: number }).increment).toBe(1);
  });

  it('marks dead on 503 when the retry budget is exhausted (DLQ)', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(503, ''));

    // attemptsMade=7, attempts=8 → final attempt → mark 'dead'
    await expect(processWebhookDeliveryJob(makeJob(7, 8))).rejects.toThrow(/HTTP 503/);

    const deliveryUpdate = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(deliveryUpdate.data['status']).toBe('dead');
    expect(deliveryUpdate.data['responseStatus']).toBe(503);
  });

  it('marks dead and throws UnrecoverableError on non-retryable 4xx', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(400, 'bad request'));

    await expect(processWebhookDeliveryJob(makeJob(0, 8))).rejects.toBeInstanceOf(UnrecoverableError);

    const deliveryUpdate = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(deliveryUpdate.data['status']).toBe('dead');
    expect(deliveryUpdate.data['responseStatus']).toBe(400);
  });

  it('treats 408 as retryable', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(408, ''));

    await expect(processWebhookDeliveryJob(makeJob(0, 8))).rejects.toThrow(/HTTP 408/);

    const u = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(u.data['status']).toBe('failed'); // retryable + not final
  });

  it('treats 429 as retryable', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(429, ''));

    await expect(processWebhookDeliveryJob(makeJob(0, 8))).rejects.toThrow(/HTTP 429/);

    const u = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(u.data['status']).toBe('failed');
  });
});

describe('processWebhookDeliveryJob — body cap', () => {
  it('truncates response bodies larger than 2 KB at storage time', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    const big = 'x'.repeat(10 * 1024);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, big));

    await processWebhookDeliveryJob(makeJob(0));

    const u = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    const snippet = u.data['responseSnippet'] as string;
    expect(snippet.length).toBe(2048);
    expect(snippet).toBe('x'.repeat(2048));
  });
});

describe('processWebhookDeliveryJob — SSRF re-check + transport errors', () => {
  it('marks dead and throws UnrecoverableError when SSRF guard rejects at delivery time', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    ssrfMock.mockResolvedValueOnce({ ok: false, reason: 'IPv4 in 10.0.0.0/8' });

    await expect(processWebhookDeliveryJob(makeJob(0, 8))).rejects.toBeInstanceOf(UnrecoverableError);

    expect(fetchMock).not.toHaveBeenCalled();
    const u = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(u.data['status']).toBe('dead');
    expect(u.data['errorMessage']).toMatch(/SSRF guard/);
  });

  it('marks failed (retryable) on transport error and throws plain Error', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED 93.184.216.34:443'));

    await expect(processWebhookDeliveryJob(makeJob(0, 8))).rejects.toThrow(/Transport error/);

    const u = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(u.data['status']).toBe('failed');
    expect(u.data['errorMessage']).toMatch(/Transport error/);
  });

  it('marks failed on AbortError (timeout) and throws timeout error', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(makeDeliveryRow() as never);
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValueOnce(abortErr);

    await expect(processWebhookDeliveryJob(makeJob(0, 8))).rejects.toThrow(/timed out after 10000 ms/);

    const u = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(u.data['status']).toBe('failed');
  });
});

describe('processWebhookDeliveryJob — paused/deleted subscription', () => {
  it('marks dead without firing fetch when subscription is soft-deleted', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(
      makeDeliveryRow({ deletedAt: new Date() }) as never
    );

    await processWebhookDeliveryJob(makeJob(0, 8));

    expect(fetchMock).not.toHaveBeenCalled();
    const u = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(u.data['status']).toBe('dead');
    expect(u.data['errorMessage']).toMatch(/paused or deleted/);
  });

  it('marks dead without firing fetch when subscription is paused (active=false)', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(
      makeDeliveryRow({ active: false }) as never
    );

    await processWebhookDeliveryJob(makeJob(0, 8));

    expect(fetchMock).not.toHaveBeenCalled();
    const u = prismaMock.webhookDelivery.update.mock.calls[0]?.[0] as CapturedUpdate;
    expect(u.data['status']).toBe('dead');
  });
});

describe('processWebhookDeliveryJob — missing row', () => {
  it('returns silently when delivery row no longer exists', async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValueOnce(null as never);

    await expect(processWebhookDeliveryJob(makeJob(0, 8))).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.update).not.toHaveBeenCalled();
  });
});
