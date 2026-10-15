import { catalog, PlanKey, BillingInterval } from '../config/plans';
import { catalogPrice, subscriptionDetails } from './stripe-catalog';
import Stripe from 'stripe';
import { config } from '../config';
import { db } from '../db/connection';
import { logger } from '../utils/logger';



export const stripe = new Stripe(config.stripe.secretKey);

export async function createCustomer(email: string, _name?: string): Promise<string> {
  const customer = await stripe.customers.create({ email });
  return customer.id;
}

export async function addLocationToSubscription(subscriptionId: string, _tier?: number): Promise<void> {
  if (!subscriptionId || !config.stripe.prices.location) return;
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items'] });
  const existing = sub.items.data.find((i) => i.price.metadata?.kind === 'location' || i.price.id === config.stripe.prices.location);
  if (existing) {
    await stripe.subscriptionItems.update(existing.id, { quantity: (existing.quantity ?? 0) + 1, proration_behavior: 'create_prorations' });
  } else {
    await stripe.subscriptionItems.create({ subscription: subscriptionId, price: config.stripe.prices.location!, quantity: 1, proration_behavior: 'create_prorations' });
  }
}

export async function removeLocationFromSubscription(subscriptionId: string, _tier?: number, idempotencyKey?: string): Promise<void> {
  if (!subscriptionId || !config.stripe.prices.location) return;
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items'] });
  if (sub.pending_update) throw Object.assign(new Error('Finish the pending billing change before removing a location.'), { status: 409 });
  const existing = sub.items.data.find((i) => i.price.metadata?.kind === 'location' || i.price.id === config.stripe.prices.location);
  if (!existing) return;
  if ((existing.quantity ?? 1) <= 1) {
    await stripe.subscriptionItems.del(existing.id, { proration_behavior: 'create_prorations' }, { idempotencyKey });
  } else {
    await stripe.subscriptionItems.update(existing.id, { quantity: (existing.quantity ?? 1) - 1, proration_behavior: 'create_prorations' }, { idempotencyKey });
  }
}

export async function getOrCreateStripeCustomer(userId: string, email: string, executor: typeof db = db): Promise<string> {
  const user = await executor('users').where({ id: userId }).first();
  if (user?.stripe_customer_id) return user.stripe_customer_id as string;
  const customer = await stripe.customers.create({ email, metadata: { userId } }, { idempotencyKey: `customer-${userId}` });
  await executor('users').where({ id: userId }).update({ stripe_customer_id: customer.id });
  return customer.id;
}

// ─── Promo codes ─────────────────────────────────────────────────────────────

export async function listPromoCodes(): Promise<Array<{
  id: string; code: string; active: boolean;
  discount: string; duration: string; applyTo: string; redemptions: number; maxRedemptions: number | null;
  expiresAt: number | null;
}>> {
  const promos = await stripe.promotionCodes.list({ limit: 100, expand: ['data.coupon'] });
  return promos.data.map((p) => {
    const c = p.coupon;
    let discount = '';
    if (c.percent_off) discount = `${c.percent_off}% off`;
    else if (c.amount_off) discount = `$${(c.amount_off / 100).toFixed(0)} off`;
    const duration = c.duration === 'forever' ? 'forever'
      : c.duration === 'once' ? 'first invoice only'
      : `${c.duration_in_months ?? '?'} months`;
    const applyTo = (c.metadata?.applyTo as string | undefined) ?? 'all';
    return {
      id: p.id, code: p.code, active: p.active,
      discount, duration, applyTo,
      redemptions: p.times_redeemed,
      maxRedemptions: p.max_redemptions ?? null,
      expiresAt: p.expires_at ?? null,
    };
  });
}

export interface CreatePromoParams {
  code: string;
  type: 'percent' | 'amount';
  value: number;
  applyTo: 'all' | 'setup' | 'monthly';
  duration: 'once' | 'forever' | 'repeating';
  durationMonths?: number;
  maxRedemptions?: number;
  expiresAt?: string;
}

export async function createPromoCode(params: CreatePromoParams): Promise<{ id: string; code: string }> {
  // For monthly-only codes, restrict the Stripe coupon to the base subscription product
  // so the setup fee line item on the first invoice is not discounted.
  let appliesTo: Stripe.CouponCreateParams.AppliesTo | undefined;
  if (params.applyTo === 'monthly' && config.stripe.prices.base) {
    const basePrice = await stripe.prices.retrieve(config.stripe.prices.base);
    const productId = typeof basePrice.product === 'string' ? basePrice.product : basePrice.product.id;
    const currentProducts = await Promise.all((Object.keys(catalog.plans) as PlanKey[]).map(async plan => { const price = await catalogPrice(plan, 'month'); return typeof price.product === 'string' ? price.product : price.product.id; }));
    appliesTo = { products: [...new Set([productId, ...currentProducts])] };
  }

  const couponParams: Stripe.CouponCreateParams = {
    duration: params.duration,
    ...(params.duration === 'repeating' ? { duration_in_months: params.durationMonths ?? 3 } : {}),
    ...(params.type === 'percent' ? { percent_off: params.value } : { amount_off: Math.round(params.value * 100), currency: 'usd' }),
    ...(appliesTo ? { applies_to: appliesTo } : {}),
    metadata: { applyTo: params.applyTo },
  };
  const coupon = await stripe.coupons.create(couponParams);
  const promoParams: Stripe.PromotionCodeCreateParams = {
    coupon: coupon.id,
    code: params.code.toUpperCase(),
    ...(params.maxRedemptions ? { max_redemptions: params.maxRedemptions } : {}),
    ...(params.expiresAt ? { expires_at: Math.floor(new Date(params.expiresAt).getTime() / 1000) } : {}),
  };
  const promo = await stripe.promotionCodes.create(promoParams);
  return { id: promo.id, code: promo.code };
}

export async function deactivatePromoCode(promoId: string): Promise<void> {
  await stripe.promotionCodes.update(promoId, { active: false });
}

export async function validatePromoCode(code: string): Promise<{ id: string; discount: string; duration: string; applyTo: string } | null> {
  const results = await stripe.promotionCodes.list({ code: code.toUpperCase(), active: true, limit: 1, expand: ['data.coupon'] });
  if (!results.data.length) return null;
  const p = results.data[0];
  const c = p.coupon as Stripe.Coupon;
  let discount = '';
  if (c.percent_off) discount = `${c.percent_off}% off`;
  else if (c.amount_off) discount = `$${(c.amount_off / 100).toFixed(0)} off`;
  const duration = c.duration === 'forever' ? 'forever'
    : c.duration === 'once' ? 'first invoice only'
    : `${c.duration_in_months ?? '?'} months`;
  const applyTo = (c.metadata?.applyTo as string | undefined) ?? 'all';
  return { id: p.id, discount, duration, applyTo };
}

interface SubscriptionIntentResult {
  clientSecret: string | null;
  subscriptionId: string;
  paymentRequired: boolean;
  currentPeriodEnd: number;
  amountDue: number;
}

function subscriptionIntentResult(sub: Stripe.Subscription): SubscriptionIntentResult {
  const invoice = typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
  const pi = typeof invoice?.payment_intent === 'object' ? invoice.payment_intent : null;
  // A missing PaymentIntent alone is not proof of payment. Stripe must confirm
  // both the active subscription and a paid invoice with nothing due.
  const noPaymentRequired = sub.status === 'active' && invoice?.paid === true
    && invoice.status === 'paid' && invoice.amount_due === 0;
  if (!noPaymentRequired && !pi?.client_secret) {
    throw new Error('Subscription requires payment but no payment confirmation is available');
  }
  return {
    clientSecret: noPaymentRequired ? null : pi!.client_secret,
    subscriptionId: sub.id,
    paymentRequired: !noPaymentRequired,
    currentPeriodEnd: sub.current_period_end,
    amountDue: invoice?.amount_due ?? 0,
  };
}

export async function createSubscriptionIntent(
  customerId: string,
  extraLocations: number,
  userId: string,
  promotionCodeId?: string,
  plan: PlanKey | 'lite' = 'pro',
  interval: BillingInterval = 'month',
  idempotencyKey?: string,
): Promise<SubscriptionIntentResult> {
  if (promotionCodeId) {
    const promo = await stripe.promotionCodes.retrieve(promotionCodeId);
    if (promo.coupon.metadata?.applyTo === 'setup') throw Object.assign(new Error('This promo only applies to setup fees. These plans have no setup fee.'), { status: 400, type: 'StripeInvalidRequestError' });
  }
  const base = await catalogPrice(plan === 'lite' ? 'starter' : plan, interval);
  const items: Stripe.SubscriptionCreateParams.Item[] = [{ price: base.id }];
  if (extraLocations > 0) items.push({ price: (await catalogPrice(plan as PlanKey, interval, true)).id, quantity: extraLocations });
  const sub = await stripe.subscriptions.create({
    customer: customerId, items, payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
    metadata: { userId, extraLocations: String(extraLocations), plan, catalogVersion: catalog.version },
    discounts: promotionCodeId ? [{ promotion_code: promotionCodeId }] : [],
  }, idempotencyKey ? { idempotencyKey } : undefined);
  return subscriptionIntentResult(sub);
}

export async function getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

function subscriptionPlan(sub: Stripe.Subscription): 'lite' | 'pro' | undefined {
  const current = subscriptionDetails(sub);
  if (current) return current.plan === 'starter' ? 'lite' : 'pro';
  if (sub.items.data.some(i => i.price.id === config.stripe.prices.base)) return 'pro';
  if (sub.items.data.some(i => i.price.id === config.stripe.prices.liteBase)) return 'lite';
  return sub.metadata?.plan === 'lite' || sub.metadata?.plan === 'pro' ? sub.metadata.plan : undefined;
}

export async function syncPaidSubscription(subscriptionId: string, executor: typeof db = db): Promise<boolean> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
  const invoice = typeof sub.latest_invoice === 'string'
    ? await stripe.invoices.retrieve(sub.latest_invoice) : sub.latest_invoice;
  if (sub.status !== 'active' || sub.pending_update || !invoice?.paid) return false;
  const plan = subscriptionPlan(sub);
  if (!plan) return false;
  const extra = sub.items.data.find(i => i.price.id === config.stripe.prices.location)?.quantity ?? 0;
  const details = subscriptionDetails(sub);
  if (details && executor === db) return db.transaction(trx => syncPaidSubscription(subscriptionId, trx));
  if (details) await executor('clients').where({ stripe_subscription_id: sub.id }).forUpdate().first();
  const change = details ? await executor('billing_changes').where({ subscription_id: sub.id }).whereIn('status', ['confirming', 'payment_required']).whereNotNull('confirmed_at').orderBy('created_at', 'desc').first() : null;
  if (change && details && change.quote.targetPriceId === details.base.price.id && details.capacity === change.quote.targetCapacity && (!change.invoice_id || change.invoice_id === invoice.id)) {
    if (change.quote.removeLocationIds?.length) {
      await executor('active_locations as locations').where({ client_id: change.client_id }).whereIn('id', change.quote.removeLocationIds).update({ archived_at: new Date(), is_primary: false, updated_at: new Date() });
      if (!await executor('active_locations as locations').where({ client_id: change.client_id, is_primary: true }).first()) {
        const first = await executor('active_locations as locations').where({ client_id: change.client_id }).orderBy('created_at').first();
        if (first) await executor('active_locations as locations').where({ id: first.id }).update({ is_primary: true });
      }
    }
    await executor('billing_changes').where({ id: change.id }).update({ status: 'succeeded', invoice_id: invoice.id, updated_at: new Date() });
  }
  await executor('clients').where({ stripe_subscription_id: sub.id }).update({
    subscription_status: 'active', product_line: plan, locations_limit: details?.capacity ?? (plan === 'lite' ? 1 : 1 + extra),
    ...(details ? { plan_key: details.plan, pricing_version: catalog.version, billing_interval: details.interval } : {}),
    subscription_current_period_end: new Date(sub.current_period_end * 1000), payment_failed_at: null, updated_at: new Date(),
  });
  return true;
}

export async function handleWebhookEvent(event: Stripe.Event, executor: typeof db = db): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription' || !session.subscription || !session.customer) break;
      const userId = session.metadata?.userId;
      if (!userId) break;
      const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      const user = await executor('users').where({ id: userId }).first();
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      if (!user || user.stripe_customer_id !== customerId || sub.metadata.userId !== userId) break;
      // Never replace a subscription selected by another checkout or trust session metadata for access.
      await executor('clients').where({ user_id: userId }).where(q => q.whereNull('stripe_subscription_id').orWhere('stripe_subscription_id', subId)).update({ stripe_subscription_id: subId, updated_at: new Date() });
      await syncPaidSubscription(subId, executor);
      break;
    }

    case 'customer.subscription.updated': {
      const eventSub = event.data.object as Stripe.Subscription;
      // A canceled/superseded incomplete checkout can emit updates after its
      // replacement is active. Never apply that event to another subscription,
      // and reconcile delayed events against Stripe's current status.
      const sub = await stripe.subscriptions.retrieve(eventSub.id);
      const userId = sub.metadata?.userId;
      if (!userId) break;
      const status = sub.status; // Nonpaying statuses must never become a fresh trial.
      // NOTE: product_line is intentionally NOT set here. This event fires on the
      // Lite→Pro price swap BEFORE the upgrade invoice is paid; flipping here would
      // grant Pro on an unpaid upgrade. The flip happens only in invoice.payment_succeeded.
      await executor('clients')
        .where({ user_id: userId, stripe_subscription_id: sub.id })
        .update({
          subscription_status: status,
          subscription_current_period_end: new Date(sub.current_period_end * 1000),
          updated_at: new Date(),
        });
      await syncPaidSubscription(sub.id, executor);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const canceled = await executor('clients')
        .where({ stripe_subscription_id: sub.id })
        .update({ subscription_status: 'canceled', updated_at: new Date() })
        .returning('id') as Array<{ id: string }>;

      for (const { id } of canceled) {
        await executor('billing_effects').insert({ id: `cancel:${sub.id}:${id}`, kind: 'deprovision', payload: JSON.stringify({ clientId: id, subscriptionId: sub.id }) }).onConflict('id').ignore();
      }
      break;
    }

    // The webhook endpoint enables invoice.payment_succeeded; handle invoice.paid too
    // for parity. This is the authoritative point where a Lite→Pro upgrade takes
    // effect — product_line is promoted only once the upgrade invoice actually pays.
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const inv = event.data.object as Stripe.Invoice;
      const subId = (inv as any).subscription as string | undefined;
      if (!subId) break;

      // Webhooks can arrive out of order. An old payment must not reactivate a
      // canceled subscription or grant a pending upgrade using newer metadata.
      // Retrieval failures propagate so Stripe retries instead of granting access.
      const sub = await stripe.subscriptions.retrieve(subId);
      const latestInvoiceId = typeof sub.latest_invoice === 'string'
        ? sub.latest_invoice : sub.latest_invoice?.id;
      if (sub.status !== 'active' || sub.pending_update || latestInvoiceId !== inv.id) break;

      await syncPaidSubscription(subId, executor);
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      const subId = (inv as any).subscription as string | undefined;
      if (!subId) break;
      // Webhooks can arrive after recovery or cancellation. Reconcile with
      // Stripe before an old failure can revoke currently paid access.
      const currentSub = await stripe.subscriptions.retrieve(subId);
      if (currentSub.pending_update) break; // A failed upgrade must preserve the paid Lite plan.
      const latestInvoiceId = typeof currentSub.latest_invoice === 'string'
        ? currentSub.latest_invoice : currentSub.latest_invoice?.id;
      if (latestInvoiceId !== inv.id || ['canceled', 'incomplete_expired'].includes(currentSub.status)) break;
      const currentInvoice = await stripe.invoices.retrieve(inv.id);
      if (currentInvoice.paid || currentInvoice.status !== 'open') break;
      await executor('clients').where({ stripe_subscription_id: subId }).update({
        subscription_status: 'past_due',
        payment_failed_at: new Date(),
        updated_at: new Date(),
      });
      const failedClient = await executor('clients').where({ stripe_subscription_id: subId }).first();
      if (failedClient) {
        const failedUser = await executor('users').where({ id: failedClient.user_id }).first();
        if (failedUser) await executor('billing_effects').insert({ id: `payment-failed:${inv.id}`, kind: 'payment_failed', payload: JSON.stringify({ clientId: failedClient.id, subscriptionId: subId, email: failedUser.email, businessName: failedClient.business_name }) }).onConflict('id').ignore();
      }
      logger.warn('Payment failed', { subscriptionId: subId });
      break;
    }
  }
}
