import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const queueAddMock = vi.fn();
vi.mock('./queues.js', async () => {
  const actual = await vi.importActual<typeof import('./queues.js')>('./queues.js');
  return {
    ...actual,
    getQueue: vi.fn(() => ({ add: queueAddMock })),
  };
});

import { emitWebhookEvent } from './webhook-emitter.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const PRACTICE_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.webhookDelivery.create.mockImplementation(async (args: unknown) => {
    const { data } = args as { data: { subscriptionId: string } };
    return { id: `delivery-for-${data.subscriptionId}` } as never;
  });
});

describe('emitWebhookEvent', () => {
  it('returns 0 and skips DB lookup when practiceId is null', async () => {
    const out = await emitWebhookEvent({
      eventType: 'agent_event.created',
      practiceId: null,
      payload: { x: 1 },
    });

    expect(out).toBe(0);
    expect(prismaMock.webhookSubscription.findMany).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('returns 0 when no subscriptions match the practice + event type', async () => {
    prismaMock.webhookSubscription.findMany.mockResolvedValueOnce([] as never);

    const out = await emitWebhookEvent({
      eventType: 'agent_event.created',
      practiceId: PRACTICE_ID,
      payload: { x: 1 },
    });

    expect(out).toBe(0);
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it('creates one WebhookDelivery row + enqueues one job per matching subscription', async () => {
    prismaMock.webhookSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-A' },
      { id: 'sub-B' },
      { id: 'sub-C' },
    ] as never);

    const out = await emitWebhookEvent({
      eventType: 'agent_event.created',
      practiceId: PRACTICE_ID,
      payload: { eventId: 'src-1' },
      eventId: 'src-1',
    });

    expect(out).toBe(3);
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledTimes(3);
    expect(queueAddMock).toHaveBeenCalledTimes(3);

    // Each enqueue references the freshly-created delivery id
    const enqueuedIds = queueAddMock.mock.calls.map((c) => (c[1] as { deliveryId: string }).deliveryId);
    expect(enqueuedIds.sort()).toEqual([
      'delivery-for-sub-A',
      'delivery-for-sub-B',
      'delivery-for-sub-C',
    ]);
  });

  it('queries with deletedAt:null + active:true + eventTypes has filter', async () => {
    prismaMock.webhookSubscription.findMany.mockResolvedValueOnce([] as never);

    await emitWebhookEvent({
      eventType: 'enrollment.status_changed',
      practiceId: PRACTICE_ID,
      payload: {},
    });

    const args = prismaMock.webhookSubscription.findMany.mock.calls[0]?.[0] as {
      where: {
        practiceId: string;
        deletedAt: null;
        active: true;
        eventTypes: { has: string };
      };
    };
    expect(args.where.practiceId).toBe(PRACTICE_ID);
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.active).toBe(true);
    expect(args.where.eventTypes.has).toBe('enrollment.status_changed');
  });

  it('returns 0 and logs warn when findMany throws (fail-soft)', async () => {
    prismaMock.webhookSubscription.findMany.mockRejectedValueOnce(new Error('boom') as never);

    const out = await emitWebhookEvent({
      eventType: 'agent_event.created',
      practiceId: PRACTICE_ID,
      payload: {},
    });

    expect(out).toBe(0);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('continues other subs when one delivery insert fails (per-sub fail-soft)', async () => {
    prismaMock.webhookSubscription.findMany.mockResolvedValueOnce([
      { id: 'sub-A' },
      { id: 'sub-bad' },
      { id: 'sub-C' },
    ] as never);
    prismaMock.webhookDelivery.create.mockImplementation(async (args: unknown) => {
      const { data } = args as { data: { subscriptionId: string } };
      if (data.subscriptionId === 'sub-bad') throw new Error('fk constraint');
      return { id: `delivery-for-${data.subscriptionId}` } as never;
    });

    const out = await emitWebhookEvent({
      eventType: 'agent_event.created',
      practiceId: PRACTICE_ID,
      payload: {},
    });

    expect(out).toBe(2); // sub-A + sub-C succeed
    expect(queueAddMock).toHaveBeenCalledTimes(2);
  });
});
