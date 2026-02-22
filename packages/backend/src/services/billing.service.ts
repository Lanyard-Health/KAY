import Stripe from 'stripe';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { getCached, setCache, invalidateCache } from '../utils/cache.js';

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] || '', {
  apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAN_PRICE_MAP: Record<string, string | undefined> = {
  STARTER: process.env['STRIPE_STARTER_PRICE_ID'],
  PROFESSIONAL: process.env['STRIPE_PROFESSIONAL_PRICE_ID'],
  ENTERPRISE: process.env['STRIPE_ENTERPRISE_PRICE_ID'],
};

function planFromPriceId(priceId: string): 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' {
  if (priceId === process.env['STRIPE_STARTER_PRICE_ID']) return 'STARTER';
  if (priceId === process.env['STRIPE_PROFESSIONAL_PRICE_ID']) return 'PROFESSIONAL';
  if (priceId === process.env['STRIPE_ENTERPRISE_PRICE_ID']) return 'ENTERPRISE';
  logger.warn(`Unknown Stripe price ID: ${priceId}, defaulting to STARTER`);
  return 'STARTER';
}

function mapStripeStatus(
  status: string,
): 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'PAUSED' {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
    case 'cancelled':
      return 'CANCELLED';
    case 'paused':
      return 'PAUSED';
    default:
      logger.warn(`Unknown Stripe subscription status: ${status}`);
      return 'ACTIVE';
  }
}

// ---------------------------------------------------------------------------
// 1. createCheckoutSession
// ---------------------------------------------------------------------------

export async function createCheckoutSession(
  practiceId: string,
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
): Promise<{ url: string }> {
  const priceId = PLAN_PRICE_MAP[plan];
  if (!priceId) {
    throw new Error(`No Stripe price ID configured for plan: ${plan}`);
  }

  // Get or create Stripe customer for this practice
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
  });

  let stripeCustomerId: string | undefined;

  // Check if a subscription already exists with a customer
  const existingSub = await prisma.subscription.findUnique({
    where: { practiceId },
  });

  if (existingSub?.stripeCustomerId) {
    stripeCustomerId = existingSub.stripeCustomerId;
  } else {
    const billingEmail =
      (practice as Record<string, unknown>)['billingEmail'] as string | undefined
      || (practice as Record<string, unknown>)['email'] as string | undefined
      || (practice as Record<string, unknown>)['contactEmail'] as string | undefined;

    const customer = await stripe.customers.create({
      email: billingEmail || undefined,
      name: practice.name,
      metadata: { practiceId },
    });
    stripeCustomerId = customer.id;
    logger.info(`Created Stripe customer ${customer.id} for practice ${practiceId}`);
  }

  const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:5190';

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { practiceId, plan },
    success_url: `${frontendUrl}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/settings/billing`,
    subscription_data: {
      metadata: { practiceId, plan },
      trial_period_days: 14,
    },
  });

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  logger.info(`Created checkout session for practice ${practiceId}, plan ${plan}`);
  return { url: session.url };
}

// ---------------------------------------------------------------------------
// 2. createPortalSession
// ---------------------------------------------------------------------------

export async function createPortalSession(
  practiceId: string,
): Promise<{ url: string }> {
  const subscription = await prisma.subscription.findUnique({
    where: { practiceId },
  });

  if (!subscription?.stripeCustomerId) {
    throw new Error('No active subscription found for this practice');
  }

  const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:5190';

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${frontendUrl}/settings/billing`,
  });

  logger.info(`Created portal session for practice ${practiceId}`);
  return { url: session.url };
}

// ---------------------------------------------------------------------------
// 3. handleWebhook
// ---------------------------------------------------------------------------

export async function handleWebhook(
  rawBody: Buffer,
  signature: string,
): Promise<void> {
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env['STRIPE_WEBHOOK_SECRET']!,
    );
  } catch (err) {
    logger.error('Stripe webhook signature verification failed');
    throw new Error('Invalid webhook signature');
  }

  logger.info(`Processing Stripe webhook: ${event.type} (${event.id})`);

  switch (event.type) {
    case 'customer.subscription.created':
      await handleSubscriptionCreated(event);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event);
      break;
    case 'invoice.paid':
      await handleInvoicePaid(event);
      break;
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event);
      break;
    case 'customer.subscription.trial_will_end':
      await handleTrialWillEnd(event);
      break;
    default:
      logger.info(`Unhandled Stripe event type: ${event.type}`);
  }
}

async function handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const practiceId = sub.metadata?.['practiceId'];

  if (!practiceId) {
    logger.error('Subscription created event missing practiceId in metadata');
    return;
  }

  const priceId = sub.items.data[0]?.price?.id;
  const plan = priceId ? planFromPriceId(priceId) : 'STARTER';
  const periodStart = (sub as any).current_period_start;
  const periodEnd = (sub as any).current_period_end;

  const subscription = await prisma.subscription.upsert({
    where: { practiceId },
    create: {
      practiceId,
      stripeCustomerId: sub.customer as string,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId || null,
      plan,
      status: mapStripeStatus(sub.status),
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    },
    update: {
      stripeCustomerId: sub.customer as string,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId || null,
      plan,
      status: mapStripeStatus(sub.status),
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    },
  });

  invalidateCache('billing:');

  await logWebhookAudit(event.type, event.id, subscription.id);
  logger.info(`Subscription created for practice ${practiceId}: ${subscription.id}`);
}

async function handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const practiceId = sub.metadata?.['practiceId'];

  if (!practiceId) {
    logger.error('Subscription updated event missing practiceId in metadata');
    return;
  }

  const priceId = sub.items.data[0]?.price?.id;
  const plan = priceId ? planFromPriceId(priceId) : undefined;
  const periodStart = (sub as any).current_period_start;
  const periodEnd = (sub as any).current_period_end;

  const subscription = await prisma.subscription.update({
    where: { practiceId },
    data: {
      ...(plan && { plan }),
      ...(priceId && { stripePriceId: priceId }),
      status: mapStripeStatus(sub.status),
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    },
  });

  invalidateCache('billing:');

  await logWebhookAudit(event.type, event.id, subscription.id);
  logger.info(`Subscription updated for practice ${practiceId}`);
}

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const practiceId = sub.metadata?.['practiceId'];

  if (!practiceId) {
    logger.error('Subscription deleted event missing practiceId in metadata');
    return;
  }

  const subscription = await prisma.subscription.update({
    where: { practiceId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
    },
  });

  invalidateCache('billing:');

  await logWebhookAudit(event.type, event.id, subscription.id);
  logger.info(`Subscription cancelled for practice ${practiceId}`);
}

async function handleInvoicePaid(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subField = (invoice as any).subscription;
  const stripeSubscriptionId =
    typeof subField === 'string'
      ? subField
      : subField?.id as string | undefined;

  if (!stripeSubscriptionId) {
    logger.warn('Invoice paid event has no subscription ID, skipping');
    return;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId },
  });

  if (!subscription) {
    logger.warn(`No subscription found for Stripe subscription ${stripeSubscriptionId}`);
    return;
  }

  await prisma.invoice.create({
    data: {
      subscriptionId: subscription.id,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_paid || 0,
      status: invoice.status || 'paid',
      invoiceUrl: invoice.hosted_invoice_url || null,
      pdfUrl: invoice.invoice_pdf || null,
      periodStart: invoice.period_start
        ? new Date(invoice.period_start * 1000)
        : new Date(),
      periodEnd: invoice.period_end
        ? new Date(invoice.period_end * 1000)
        : new Date(),
      paidAt: new Date(),
    },
  });

  invalidateCache('billing:');

  await logWebhookAudit(event.type, event.id, subscription.id);
  logger.info(`Invoice paid recorded for subscription ${subscription.id}`);
}

async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subField2 = (invoice as any).subscription;
  const stripeSubscriptionId =
    typeof subField2 === 'string'
      ? subField2
      : subField2?.id as string | undefined;

  if (!stripeSubscriptionId) {
    logger.warn('Invoice payment failed event has no subscription ID, skipping');
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId },
  });

  if (!subscription) {
    logger.warn(`No subscription found for Stripe subscription ${stripeSubscriptionId}`);
    return;
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: 'PAST_DUE' },
  });

  invalidateCache('billing:');

  await logWebhookAudit(event.type, event.id, subscription.id);
  logger.warn(`Payment failed for subscription ${subscription.id}, set to PAST_DUE`);
}

async function handleTrialWillEnd(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const practiceId = sub.metadata?.['practiceId'];

  // TODO: Send notification email to practice admin
  logger.warn(
    `Trial ending soon for practice ${practiceId || 'unknown'}, subscription ${sub.id}`,
  );

  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: sub.id },
  });

  if (subscription) {
    await logWebhookAudit(event.type, event.id, subscription.id);
  }
}

async function logWebhookAudit(
  eventType: string,
  stripeEventId: string,
  subscriptionId: string,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: 'update',
        resourceType: 'subscription',
        resourceId: subscriptionId,
        changes: { eventType, stripeEventId },
      },
    });
  } catch (err) {
    logger.error(`Failed to log audit entry for webhook ${eventType}: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// 4. getSubscription
// ---------------------------------------------------------------------------

export async function getSubscription(practiceId: string) {
  const cacheKey = `billing:subscription:${practiceId}`;
  const cached = getCached<Awaited<ReturnType<typeof prisma.subscription.findUnique>>>(cacheKey);
  if (cached !== undefined) return cached;

  const subscription = await prisma.subscription.findUnique({
    where: { practiceId },
  });

  setCache(cacheKey, subscription, 60_000);
  return subscription;
}

// ---------------------------------------------------------------------------
// 5. getInvoices
// ---------------------------------------------------------------------------

export async function getInvoices(practiceId: string) {
  const cacheKey = `billing:invoices:${practiceId}`;
  const cached = getCached<Awaited<ReturnType<typeof prisma.invoice.findMany>>>(cacheKey);
  if (cached !== undefined) return cached;

  const subscription = await prisma.subscription.findUnique({
    where: { practiceId },
    select: { id: true },
  });

  if (!subscription) return [];

  const invoices = await prisma.invoice.findMany({
    where: { subscriptionId: subscription.id },
    orderBy: { createdAt: 'desc' },
  });

  setCache(cacheKey, invoices, 60_000);
  return invoices;
}

// ---------------------------------------------------------------------------
// 6. checkProviderLimit
// ---------------------------------------------------------------------------

export async function checkProviderLimit(
  practiceId: string,
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const subscription = await prisma.subscription.findUnique({
    where: { practiceId },
    select: { providerCount: true, providerLimit: true },
  });

  if (!subscription) {
    // No subscription — allow (admin/free tier)
    return { allowed: true, current: 0, limit: 0 };
  }

  return {
    allowed: subscription.providerCount < subscription.providerLimit,
    current: subscription.providerCount,
    limit: subscription.providerLimit,
  };
}

// ---------------------------------------------------------------------------
// 7. incrementProviderCount
// ---------------------------------------------------------------------------

export async function incrementProviderCount(practiceId: string): Promise<void> {
  const subscription = await prisma.subscription.update({
    where: { practiceId },
    data: {
      providerCount: { increment: 1 },
    },
  });

  // Report metered usage to Stripe if subscription item ID is available
  if (subscription.stripeSubscriptionId) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId,
      );
      const subscriptionItemId = stripeSub.items.data[0]?.id;

      if (subscriptionItemId) {
        // Report metered usage — method varies by Stripe API version
        try {
          await (stripe as any).subscriptionItems.createUsageRecord(subscriptionItemId, {
            quantity: 1,
            timestamp: Math.floor(Date.now() / 1000),
            action: 'increment',
          });
        } catch {
          // Metered billing not configured — silently skip
        }
        logger.info(
          `Reported usage increment to Stripe for practice ${practiceId}`,
        );
      }
    } catch (err) {
      // Non-fatal — usage reporting failure shouldn't block provider creation
      logger.error(
        `Failed to report usage to Stripe for practice ${practiceId}: ${err}`,
      );
    }
  }

  invalidateCache('billing:');
  logger.info(`Provider count incremented for practice ${practiceId}`);
}
