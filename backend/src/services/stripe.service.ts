import Stripe from 'stripe';
import { config } from '../config';
import { db } from '../db/connection';
import { logger } from '../utils/logger';
import { sendPaymentFailedEmail } from './email.service';

export const stripe = new Stripe(config.stripe.secretKey);

export async function createCustomer(email: string, _name?: string): Promise<string> {
  const customer = await stripe.customers.create({ email });
  return customer.id;
}

export async function addLocationToSubscription(subscriptionId: string, _tier?: number): Promise<void> {
  if (!subscriptionId || !config.stripe.prices.location) return;
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items'] });
  const existing = sub.items.data.find((i) => i.price.id === config.stripe.prices.location);
  if (existing) {
    await stripe.subscriptionItems.update(existing.id, { quantity: (existing.quantity ?? 0) + 1, proration_behavior: 'create_prorations' });
  } else {
    await stripe.subscriptionItems.create({ subscription: subscriptionId, price: config.stripe.prices.location!, quantity: 1, proration_behavior: 'create_prorations' });
  }
}

export async function removeLocationFromSubscription(subscriptionId: string, _tier?: number): Promise<void> {
  if (!subscriptionId || !config.stripe.prices.location) return;
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items'] });
  const existing = sub.items.data.find((i) => i.price.id === config.stripe.prices.location);
  if (!existing) return;
  if ((existing.quantity ?? 1) <= 1) {
    await stripe.subscriptionItems.del(existing.id, { proration_behavior: 'create_prorations' });
  } else {
    await stripe.subscriptionItems.update(existing.id, { quantity: (existing.quantity ?? 1) - 1, proration_behavior: 'create_prorations' });
  }
}

export async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const user = await db('users').where({ id: userId }).first();
  if (user?.stripe_customer_id) return user.stripe_customer_id as string;
  const customer = await stripe.customers.create({ email, metadata: { userId } });
  await db('users').where({ id: userId }).update({ stripe_customer_id: customer.id });
  return customer.id;
}

export async function createCheckoutSession(
  customerId: string,
  extraLocations: number,
  successUrl: string,
  cancelUrl: string,
  userId: string,
): Promise<Stripe.Checkout.Session> {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: config.stripe.prices.setup!, quantity: 1 },
    { price: config.stripe.prices.base!, quantity: 1 },
  ];
  if (extraLocations > 0) {
    lineItems.push({ price: config.stripe.prices.location!, quantity: extraLocations });
  }

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: lineItems,
    subscription_data: { metadata: { userId, extraLocations: String(extraLocations) } },
    metadata: { userId, extraLocations: String(extraLocations) },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription' || !session.subscription || !session.customer) break;
      const userId = session.metadata?.userId;
      if (!userId) break;
      const extra = parseInt(session.metadata?.extraLocations ?? '0', 10);
      await db('clients')
        .where({ user_id: userId })
        .update({
          stripe_subscription_id: session.subscription as string,
          subscription_status: 'active',
          locations_limit: 1 + extra,
          updated_at: new Date(),
        });
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;
      if (!userId) break;
      const status = sub.status === 'active' ? 'active'
        : sub.status === 'past_due' ? 'past_due'
        : sub.status === 'canceled' ? 'canceled' : 'trialing';
      const locationItem = sub.items.data.find((i) => i.price.id === config.stripe.prices.location);
      const extra = locationItem?.quantity ?? 0;
      await db('clients')
        .where({ user_id: userId })
        .update({
          subscription_status: status,
          subscription_current_period_end: new Date(sub.current_period_end * 1000),
          locations_limit: 1 + extra,
          updated_at: new Date(),
        });
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await db('clients').where({ stripe_subscription_id: sub.id }).update({
        subscription_status: 'canceled',
        updated_at: new Date(),
      });
      break;
    }

    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      const subId = (inv as any).subscription as string | undefined;
      if (!subId) break;
      await db('clients').where({ stripe_subscription_id: subId }).update({
        subscription_status: 'active',
        payment_failed_at: null,
        updated_at: new Date(),
      });
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      const subId = (inv as any).subscription as string | undefined;
      if (!subId) break;
      await db('clients').where({ stripe_subscription_id: subId }).update({
        subscription_status: 'past_due',
        payment_failed_at: new Date(),
        updated_at: new Date(),
      });
      const failedClient = await db('clients').where({ stripe_subscription_id: subId }).first();
      if (failedClient) {
        const failedUser = await db('users').where({ id: failedClient.user_id }).first();
        if (failedUser) void sendPaymentFailedEmail(failedUser.email as string, failedClient.business_name as string);
      }
      logger.warn('Payment failed', { subscriptionId: subId });
      break;
    }
  }
}
