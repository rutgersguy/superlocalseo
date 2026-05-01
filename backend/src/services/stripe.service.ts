import Stripe from 'stripe';
import { config } from '../config';
import { db } from '../db/connection';
import { logger } from '../utils/logger';
import { deprovisionClient } from './emr_provisioning';

export const stripe = new Stripe(config.stripe.secretKey);

export async function createCustomer(email: string, businessName: string): Promise<string> {
  const customer = await stripe.customers.create({ email, name: businessName });
  return customer.id;
}

export async function createSubscription(customerId: string, tier: 1 | 2 | 3): Promise<Stripe.Subscription> {
  const priceId = { 1: config.stripe.prices.tier1, 2: config.stripe.prices.tier2, 3: config.stripe.prices.tier3 }[tier];
  if (!priceId) throw new Error(`No price ID configured for tier ${tier}`);

  return stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_period_days: 14,
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  });
}

export async function addLocationToSubscription(subscriptionId: string, tier: 1 | 2 | 3): Promise<void> {
  const priceId = { 1: config.stripe.prices.tier1Extra, 2: config.stripe.prices.tier2Extra, 3: config.stripe.prices.tier3Extra }[tier];
  if (!priceId) return;
  await stripe.subscriptionItems.create({ subscription: subscriptionId, price: priceId, quantity: 1 });
}

export async function removeLocationFromSubscription(subscriptionId: string, tier: 1 | 2 | 3): Promise<void> {
  const priceId = { 1: config.stripe.prices.tier1Extra, 2: config.stripe.prices.tier2Extra, 3: config.stripe.prices.tier3Extra }[tier];
  if (!priceId) return;
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items'] });
  const item = sub.items.data.find((i) => i.price.id === priceId);
  if (item) await stripe.subscriptionItems.del(item.id, { proration_behavior: 'create_prorations' });
}

export async function getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

// Handle key webhook events
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription;
      const status = sub.status === 'active' || sub.status === 'trialing' ? 'active'
        : sub.status === 'past_due' ? 'past_due'
        : sub.status === 'canceled' ? 'canceled' : 'suspended';
      await db('clients').where({ stripe_subscription_id: sub.id }).update({
        subscription_status: status,
        subscription_current_period_end: new Date(sub.current_period_end * 1000),
        updated_at: new Date(),
      });
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await db('clients').where({ stripe_subscription_id: sub.id }).update({ subscription_status: 'canceled', updated_at: new Date() });
      const canceledClient = await db('clients').where({ stripe_subscription_id: sub.id }).first();
      if (canceledClient) {
        void deprovisionClient(canceledClient.id as string);
      }
      break;
    }
    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      if (inv.subscription) {
        await db('clients').where({ stripe_subscription_id: inv.subscription }).update({
          subscription_status: 'active', payment_failed_at: null, updated_at: new Date(),
        });
      }
      break;
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      if (inv.subscription) {
        await db('clients').where({ stripe_subscription_id: inv.subscription }).update({
          subscription_status: 'past_due', payment_failed_at: new Date(), updated_at: new Date(),
        });
        logger.warn('Payment failed for subscription', { subscriptionId: inv.subscription });
      }
      break;
    }
    default:
      break;
  }
}
