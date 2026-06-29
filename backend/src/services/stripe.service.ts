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
  plan: 'lite' | 'pro' = 'pro',
): Promise<Stripe.Checkout.Session> {
  // Lite: single $99/mo recurring item, no setup fee, no extra locations.
  // Pro: $349/mo base. The $499 setup fee is waived unless STRIPE_SETUP_FEE_ENABLED=true.
  const chargeSetupFee = config.stripe.setupFeeEnabled && !!config.stripe.prices.setup;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = plan === 'lite'
    ? [{ price: config.stripe.prices.liteBase!, quantity: 1 }]
    : [
      ...(chargeSetupFee ? [{ price: config.stripe.prices.setup!, quantity: 1 }] : []),
      { price: config.stripe.prices.base!, quantity: 1 },
    ];
  const extra = plan === 'lite' ? 0 : extraLocations;
  if (extra > 0) {
    lineItems.push({ price: config.stripe.prices.location!, quantity: extra });
  }

  // subscription_data.metadata carries the plan onto the SUBSCRIPTION so later
  // customer.subscription.updated / invoice.payment_succeeded events can read it.
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: lineItems,
    subscription_data: { metadata: { userId, extraLocations: String(extra), plan } },
    metadata: { userId, extraLocations: String(extra), plan },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
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
    appliesTo = { products: [productId] };
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

export async function createSubscriptionIntent(
  customerId: string,
  extraLocations: number,
  userId: string,
  promotionCodeId?: string,
  plan: 'lite' | 'pro' = 'pro',
): Promise<{ clientSecret: string; subscriptionId: string }> {
  if (plan === 'lite') {
    // Lite: single recurring item, no setup fee, no extra locations.
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: config.stripe.prices.liteBase! }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { userId, extraLocations: '0', plan: 'lite' },
      ...(promotionCodeId ? { promotion_code: promotionCodeId } : {}),
    });
    const liteInvoice = sub.latest_invoice as Stripe.Invoice;
    const litePi = liteInvoice.payment_intent as Stripe.PaymentIntent;
    return { clientSecret: litePi.client_secret!, subscriptionId: sub.id };
  }

  const items: Stripe.SubscriptionCreateParams.Item[] = [
    { price: config.stripe.prices.base! },
  ];
  if (extraLocations > 0 && config.stripe.prices.location) {
    items.push({ price: config.stripe.prices.location, quantity: extraLocations });
  }

  // The $499 setup fee is waived by default. The whole setup-fee block (including the
  // setup-fee-only promo handling) only runs when STRIPE_SETUP_FEE_ENABLED=true.
  const chargeSetupFee = config.stripe.setupFeeEnabled && !!config.stripe.prices.setup;

  // Determine if this promo is setup-fee-only, which requires special handling:
  // - Do NOT apply promotion_code to the subscription (that would discount monthly charges)
  // - Instead, compute the discounted setup fee and inject it inline
  let setupOnlyDiscount = false;
  let setupInvoiceItems: Stripe.SubscriptionCreateParams.AddInvoiceItem[] = [];

  if (chargeSetupFee && promotionCodeId && config.stripe.prices.setup) {
    const promoCode = await stripe.promotionCodes.retrieve(promotionCodeId, { expand: ['coupon'] });
    const coupon = promoCode.coupon as Stripe.Coupon;
    const applyTo = (coupon.metadata?.applyTo as string | undefined) ?? 'all';

    if (applyTo === 'setup') {
      setupOnlyDiscount = true;
      const setupPrice = await stripe.prices.retrieve(config.stripe.prices.setup);
      const unitAmount = setupPrice.unit_amount ?? 0;
      let discountedAmount = unitAmount;
      if (coupon.percent_off) {
        discountedAmount = Math.round(unitAmount * (1 - coupon.percent_off / 100));
      } else if (coupon.amount_off) {
        discountedAmount = Math.max(0, unitAmount - coupon.amount_off);
      }
      if (discountedAmount > 0) {
        setupInvoiceItems = [{
          price_data: {
            currency: setupPrice.currency,
            product: typeof setupPrice.product === 'string' ? setupPrice.product : setupPrice.product.id,
            unit_amount: discountedAmount,
          },
        }];
      }
      // discountedAmount === 0 means free setup — omit the item entirely
    } else {
      setupInvoiceItems = config.stripe.prices.setup
        ? [{ price: config.stripe.prices.setup }]
        : [];
    }
  } else if (chargeSetupFee) {
    setupInvoiceItems = config.stripe.prices.setup
      ? [{ price: config.stripe.prices.setup }]
      : [];
  }

  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items,
    add_invoice_items: setupInvoiceItems,
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
    metadata: { userId, extraLocations: String(extraLocations), plan: 'pro' },
    ...(!setupOnlyDiscount && promotionCodeId ? { promotion_code: promotionCodeId } : {}),
  });

  const invoice = sub.latest_invoice as Stripe.Invoice;
  const pi = invoice.payment_intent as Stripe.PaymentIntent;

  return { clientSecret: pi.client_secret!, subscriptionId: sub.id };
}

/**
 * Upgrade a Lite subscriber to Pro.
 * - Swaps the subscription item liteBase → base (Pro)
 * - proration_behavior 'always_invoice' bills the prorated monthly difference now
 * - The $499 setup fee is WAIVED on upgrade — they're already a paying customer.
 *
 * product_line is intentionally NOT flipped here. The subscription now carries
 * metadata.plan='pro'; the client is promoted to Pro only when the upgrade invoice
 * actually pays (invoice.payment_succeeded webhook), so a failed payment never
 * grants free Pro access.
 *
 * @returns clientSecret for confirming the upgrade payment (null if no payment was
 *          required — e.g. covered by credit), and the proration invoiceId.
 */
export async function upgradeToProSubscription(
  subscriptionId: string,
  userId: string,
  promotionCodeId?: string,
): Promise<{ clientSecret: string | null; invoiceId: string }> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items'] });
  const liteItem = sub.items.data.find((i) => i.price.id === config.stripe.prices.liteBase);
  if (!liteItem) throw new Error('No Lite subscription item found — cannot upgrade.');

  // Setup fee waived on Lite→Pro upgrade — no invoice item added.

  const updatedSub = await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: liteItem.id, price: config.stripe.prices.base!, quantity: 1 }],
    proration_behavior: 'always_invoice',
    metadata: { ...sub.metadata, userId, plan: 'pro' },
    expand: ['latest_invoice.payment_intent'],
    ...(promotionCodeId ? { promotion_code: promotionCodeId } : {}),
  });

  const inv = updatedSub.latest_invoice as Stripe.Invoice | null;
  if (!inv) throw new Error('No invoice generated for upgrade — cannot confirm payment.');
  const pi = inv.payment_intent as Stripe.PaymentIntent | null;
  return { clientSecret: pi?.client_secret ?? null, invoiceId: inv.id! };
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
      const plan = (session.metadata?.plan ?? 'pro') as 'lite' | 'pro';
      const extra = plan === 'lite' ? 0 : parseInt(session.metadata?.extraLocations ?? '0', 10);
      await db('clients')
        .where({ user_id: userId })
        .update({
          stripe_subscription_id: session.subscription as string,
          subscription_status: 'active',
          locations_limit: plan === 'lite' ? 1 : 1 + extra,
          product_line: plan,
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
      const planFromMeta = sub.metadata?.plan as 'lite' | 'pro' | undefined;
      // NOTE: product_line is intentionally NOT set here. This event fires on the
      // Lite→Pro price swap BEFORE the upgrade invoice is paid; flipping here would
      // grant Pro on an unpaid upgrade. The flip happens only in invoice.payment_succeeded.
      await db('clients')
        .where({ user_id: userId })
        .update({
          subscription_status: status,
          subscription_current_period_end: new Date(sub.current_period_end * 1000),
          locations_limit: planFromMeta === 'lite' ? 1 : 1 + extra,
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

    // The webhook endpoint enables invoice.payment_succeeded; handle invoice.paid too
    // for parity. This is the authoritative point where a Lite→Pro upgrade takes
    // effect — product_line is promoted only once the upgrade invoice actually pays.
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const inv = event.data.object as Stripe.Invoice;
      const subId = (inv as any).subscription as string | undefined;
      if (!subId) break;

      let planUpdate: { product_line?: 'lite' | 'pro'; locations_limit?: number } = {};
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        const plan = sub.metadata?.plan as 'lite' | 'pro' | undefined;
        if (plan) {
          const locationItem = sub.items.data.find((i) => i.price.id === config.stripe.prices.location);
          const extra = locationItem?.quantity ?? 0;
          planUpdate = { product_line: plan, locations_limit: plan === 'lite' ? 1 : 1 + extra };
        }
      } catch { /* if the retrieve fails, still mark the invoice paid below */ }

      await db('clients').where({ stripe_subscription_id: subId }).update({
        subscription_status: 'active',
        payment_failed_at: null,
        ...planUpdate,
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
