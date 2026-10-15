import { randomUUID } from 'crypto';
import { catalog, isPlanKey, planFor, BillingInterval } from '../config/plans';
import { subscriptionDetails } from '../services/stripe-catalog';
import { previewBillingChange, setupBillingCard, confirmBillingChange, billingChangeStatus, pendingBillingChange, cancelBillingChange } from '../services/billing-change.service';
import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { stripe, getOrCreateStripeCustomer, createCheckoutSession, createSubscriptionIntent, getBillingPortalUrl, handleWebhookEvent, validatePromoCode } from '../services/stripe.service';
import { config } from '../config';
import { logger } from '../utils/logger';

export function planCatalog(_req: Request, res: Response) { ok(res, catalog); }

export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = req.client;
    const trialEndsAt = client.trial_ends_at ? new Date(client.trial_ends_at as string) : null;
    const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000)) : null;
    const locationCount = await db('locations').where({ client_id: req.clientId }).count('id as cnt').first();
    const locCount = parseInt(String((locationCount as any)?.cnt ?? 0), 10);

    let currentPrice: { amount: number; interval: string; currency: string } | null = null;
    if (client.stripe_subscription_id) {
      const sub = await stripe.subscriptions.retrieve(client.stripe_subscription_id as string);
      currentPrice = { amount: sub.items.data.reduce((sum, i) => sum + (i.price.unit_amount ?? 0) * (i.quantity ?? 1), 0), interval: sub.items.data[0]?.price.recurring?.interval ?? 'month', currency: sub.currency };
    }
    ok(res, {
      planKey: planFor(client).key,
      pricingVersion: client.pricing_version,
      interval: client.billing_interval ?? 'month',
      currentPrice,
      limits: planFor(client),
      usage: await db('plan_usage').where({ client_id: req.clientId, period: new Date().toISOString().slice(0, 7) }).select('scope', 'metric', 'used'),
      status: client.subscription_status,
      canManageBilling: req.teamRole === 'owner' || req.teamRole === 'admin',
      trialEndsAt: client.subscription_status === 'trialing' ? trialEndsAt?.toISOString() ?? null : null,
      trialDaysLeft: client.subscription_status === 'trialing' ? trialDaysLeft : null,
      locationsLimit: client.locations_limit ?? 1,
      locationCount: locCount,
      currentPeriodEnd: client.subscription_current_period_end ?? null,
      paymentFailedAt: client.payment_failed_at ?? null,
      publishableKey: config.stripe.publishableKey,
      productLine: (client.product_line as string | null) ?? 'pro',
    });
  } catch (e) { next(e); }
}

export async function checkout(req: Request, res: Response, next: NextFunction): Promise<void> {
  err(res, 'Choose a plan on the billing page to preview and confirm payment.', 409, 'PREVIEW_REQUIRED');
}

export async function subscriptionIntent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const plan = req.body.plan === 'lite' ? 'starter' : req.body.plan;
    const interval: BillingInterval = req.body.interval ?? 'month';
    if (!isPlanKey(plan) || !['month', 'year'].includes(interval)) { err(res, 'Choose a plan and billing interval.', 400, 'INVALID_INPUT'); return; }
    const extraLocations = Number(req.body.extraLocations ?? 0);
    const definition = catalog.plans[plan];
    if (!Number.isInteger(extraLocations) || extraLocations < 0 || definition.includedLocations + extraLocations > definition.maxLocations) { err(res, 'Invalid location capacity.', 400, 'INVALID_INPUT'); return; }
    const promotionCodeId = typeof req.body.promotionCodeId === 'string' ? req.body.promotionCodeId : undefined;
    const user = await db('users').where({ id: req.userId }).first();
    if (!user) { err(res, 'User not found', 404, 'NOT_FOUND'); return; }
    // Serialize checkout changes for this client, including simultaneous tabs.
    // Superseded unpaid intents must not remain payable after switching plans.
    const fingerprint = JSON.stringify({ plan, interval, extraLocations, promotionCodeId: promotionCodeId ?? null });
    const prepared = await db.transaction(async trx => {
      await trx('users').where({ id: req.userId }).forUpdate().first();
      const client = await trx('clients').where({ user_id: req.userId }).forUpdate().first();
      if (!client) return null;
      if (client.pricing_version === 'legacy') throw Object.assign(new Error('Your existing billing is preserved. Contact support before changing it.'), { status: 409 });
      const locationCount = Number((await trx('locations').where({ client_id: client.id }).count('* as n').first())?.n ?? 0);
      if (locationCount > definition.includedLocations + extraLocations) throw Object.assign(new Error('Choose which extra locations to remove in Settings > Locations before subscribing to this capacity.'), { status: 409 });
      if (client.pending_checkout) {
        if (client.pending_checkout.fingerprint !== fingerprint) throw Object.assign(new Error('A checkout is still being confirmed. Retry your previous plan choice before starting a different checkout.'), { status: 409 });
        if (Date.now() - client.pending_checkout.startedAt > 23 * 3600000) throw Object.assign(new Error('This checkout needs review. Contact support before trying again.'), { status: 409 });
        return { clientId: client.id, attempt: client.pending_checkout, existing: false as const };
      }
      if (client.stripe_subscription_id) {
        const existing = await stripe.subscriptions.retrieve(client.stripe_subscription_id as string);
        if (['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(existing.status)) return { existing: true as const };
        if (existing.status === 'incomplete') await stripe.subscriptions.cancel(existing.id);
      }
      const customerId = await getOrCreateStripeCustomer(req.userId!, user.email as string, trx);
      const attempt = { id: randomUUID(), fingerprint, startedAt: Date.now(), customerId };
      await trx('clients').where({ id: client.id }).update({ pending_checkout: JSON.stringify(attempt) });
      return { clientId: client.id, attempt, existing: false as const };
    });
    if (!prepared) { err(res, 'Client not found', 404, 'NOT_FOUND'); return; }
    if (prepared.existing) { err(res, 'A subscription already exists. Open billing settings to manage it.', 409, 'SUBSCRIPTION_EXISTS'); return; }
    let result;
    try {
      result = await db.transaction(async trx => {
        const client = await trx('clients').where({ id: prepared.clientId }).forUpdate().first();
        if (client.pending_checkout?.id !== prepared.attempt.id) return { existing: true as const };
        const intent = await createSubscriptionIntent(prepared.attempt.customerId, extraLocations, req.userId!, promotionCodeId, plan, interval, `checkout-${prepared.attempt.id}`);
        await trx('clients').where({ id: client.id }).update({
          stripe_subscription_id: intent.subscriptionId, pending_checkout: null,
          ...(!intent.paymentRequired ? {
            subscription_status: 'active', product_line: plan === 'starter' ? 'lite' : 'pro',
            plan_key: plan, pricing_version: catalog.version, billing_interval: interval,
            locations_limit: definition.includedLocations + extraLocations,
            subscription_current_period_end: new Date(intent.currentPeriodEnd * 1000), payment_failed_at: null,
          } : {}), updated_at: new Date(),
        });
        return { ...intent, existing: false as const };
      });
    } catch (e) {
      if (['StripeInvalidRequestError', 'StripeCardError'].includes((e as { type?: string }).type ?? '')) {
        await db('clients').where({ id: prepared.clientId }).whereRaw("pending_checkout->>'id' = ?", [prepared.attempt.id]).update({ pending_checkout: null });
      }
      throw e;
    }
    if (!result) { err(res, 'Client not found', 404, 'NOT_FOUND'); return; }
    if (result.existing) {
      err(res, 'A subscription already exists. Open billing settings to manage your payment method or plan.', 409, 'SUBSCRIPTION_EXISTS');
      return;
    }
    ok(res, { amountDue: result.amountDue, clientSecret: result.clientSecret, paymentRequired: result.paymentRequired, subscriptionId: result.subscriptionId, publishableKey: config.stripe.publishableKey });
  } catch (e) { next(e); }
}

// Legacy callers must use the preview/confirm flow; opening a URL never charges.
export async function upgrade(_req: Request, res: Response): Promise<void> {
  err(res, 'Open Settings > Billing to preview and confirm your upgrade.', 409, 'PREVIEW_REQUIRED');
}

export async function validatePromo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!code) { err(res, 'Code is required', 400, 'INVALID_INPUT'); return; }
    const result = await validatePromoCode(code);
    if (!result) { err(res, 'Invalid or expired promo code', 404, 'PROMO_NOT_FOUND'); return; }
    ok(res, result);
  } catch (e) { next(e); }
}

export async function portal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await db('users').where({ id: req.client.user_id }).first();
    if (!user?.email) { err(res, 'No billing account found', 400, 'NO_STRIPE_CUSTOMER'); return; }
    // Customers are created lazily now (#177), so a user who has never checked
    // out has no stripe_customer_id yet. Create on demand rather than erroring.
    const customerId = await getOrCreateStripeCustomer(user.id as string, user.email as string);
    const url = await getBillingPortalUrl(customerId, `${config.appUrl}/dashboard/settings?tab=billing`);
    ok(res, { url });
  } catch (e) { next(e); }
}

export async function webhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sig = req.headers['stripe-signature'] as string;
    if (!sig) { res.status(400).json({ error: 'Missing signature' }); return; }
    if (!config.stripe.webhookSecret) { logger.warn('Stripe webhook secret not configured'); res.json({ received: true }); return; }
    const { stripe } = await import('../services/stripe.service');
    const event = stripe.webhooks.constructEvent(req.body as Buffer, sig, config.stripe.webhookSecret);
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (e) {
    logger.error('Webhook error', { error: (e as Error).message });
    res.status(400).json({ error: 'Webhook failed' });
  }
}

export async function previewChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { action, promoCode = '' } = req.body;
    if (!['upgrade', 'add_location', 'change_plan'].includes(action) || typeof promoCode !== 'string') {
      err(res, 'Choose an upgrade or an additional location.', 400, 'INVALID_INPUT'); return;
    }
    if (req.body.removeLocationIds !== undefined && (!Array.isArray(req.body.removeLocationIds) || req.body.removeLocationIds.some((id: unknown) => typeof id !== 'string'))) { err(res, 'Choose valid locations.', 400, 'INVALID_INPUT'); return; }
    ok(res, await previewBillingChange(req.clientId, action, promoCode, { plan: req.body.plan, interval: req.body.interval, capacity: req.body.capacity, removeLocationIds: req.body.removeLocationIds }));
  } catch (e) { billingChangeError(e, next); }
}
export async function setupCard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { ok(res, await setupBillingCard(req.clientId, req.params.id)); } catch (e) { billingChangeError(e, next); }
}
export async function confirmChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { ok(res, await confirmBillingChange(req.clientId, req.params.id)); } catch (e) { billingChangeError(e, next); }
}
export async function changeStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { ok(res, await billingChangeStatus(req.clientId, req.params.id)); } catch (e) { billingChangeError(e, next); }
}
function billingChangeError(error: unknown, next: NextFunction) {
  const e = error as Error & { type?: string; status?: number };
  if (e.type === 'StripeInvalidRequestError' || e.type === 'StripeCardError') e.status = 400;
  next(e);
}

export async function pendingChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { ok(res, await pendingBillingChange(req.clientId)); } catch (e) { billingChangeError(e, next); }
}
export async function cancelChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { ok(res, await cancelBillingChange(req.clientId, req.params.id)); } catch (e) { billingChangeError(e, next); }
}
