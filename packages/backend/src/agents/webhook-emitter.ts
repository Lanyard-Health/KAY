/**
 * Outbound webhook event emitter (Phase 0.A PR 4, sub-chunk 4B).
 *
 * Fan-out helper called from emit sites (event-logger, enrollment service).
 * Looks up active subscriptions for the given practice that requested the
 * event type, creates one WebhookDelivery row per subscription, and
 * enqueues a delivery job for each onto the WEBHOOK_DELIVERY BullMQ queue.
 *
 * Fail-soft contract:
 *   - Never throws. Returns the count of subscriptions that were enqueued
 *     (0 if practiceId is null, no matching subscriptions, or a DB error
 *     bubbles up). Caller code in the hot path (event-logger, enrollment
 *     service) treats this as side-effect-only and ignores failures so
 *     that webhook fanout never breaks the originating action.
 */
import type { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getQueue, QUEUE_NAMES } from './queues.js';

export const REGISTERED_EVENT_TYPES = [
  'agent_event.created',
  'enrollment.status_changed',
  'credential.expired',
] as const;

export type RegisteredEventType = (typeof REGISTERED_EVENT_TYPES)[number];

export interface EmitWebhookEventInput {
  eventType: RegisteredEventType;
  /**
   * Practice scope. Subscriptions are practice-owned, so an event with
   * no practice context (system-level, no provider linkage) does not
   * fan out — pass null and the emit becomes a no-op.
   */
  practiceId: string | null;
  payload: Prisma.InputJsonValue;
  /**
   * Optional reference to the row that triggered the event (e.g. the
   * AgentEvent.id, Enrollment.id). Stored on WebhookDelivery for forensics.
   */
  eventId?: string;
}

/**
 * Fan out an event to every active subscription that asked for this type
 * within the given practice. Returns the number of delivery jobs enqueued.
 */
export async function emitWebhookEvent(input: EmitWebhookEventInput): Promise<number> {
  if (!input.practiceId) return 0;

  try {
    const subs = await prisma.webhookSubscription.findMany({
      where: {
        practiceId: input.practiceId,
        deletedAt: null,
        active: true,
        eventTypes: { has: input.eventType },
      },
      select: { id: true },
    });

    if (subs.length === 0) return 0;

    const queue = getQueue(QUEUE_NAMES.WEBHOOK_DELIVERY);
    let enqueued = 0;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          const delivery = await prisma.webhookDelivery.create({
            data: {
              subscriptionId: sub.id,
              eventType: input.eventType,
              eventId: input.eventId ?? null,
              payload: input.payload,
              status: 'pending',
            },
            select: { id: true },
          });
          await queue.add('deliver', { deliveryId: delivery.id });
          enqueued += 1;
        } catch (err) {
          logger.warn('Failed to enqueue webhook delivery for subscription', {
            subscriptionId: sub.id,
            eventType: input.eventType,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );

    return enqueued;
  } catch (err) {
    logger.warn('Failed to emit webhook event — fanout skipped', {
      eventType: input.eventType,
      practiceId: input.practiceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
