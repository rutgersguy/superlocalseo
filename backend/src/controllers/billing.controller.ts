import { previewBillingChange, setupBillingCard, confirmBillingChange, billingChangeStatus, pendingBillingChange, cancelBillingChange } from '../services/billing-change.service';
import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { stripe, getOrCreateStripeCustomer, createCheckoutSession, createSubscriptionIntent, getBillingPortalUrl, handleWebhookEvent, validatePromoCode } from '../services/stripe.service';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = req.client;
    const trialEndsAt = client.trial_ends_at ? new Date(client.trial_ends_at as string) : null;
    const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000)) : null;
    const locationCount = await db('locations').where({ client_id: req.clientId }).count('id as cnt').first();
    const locCount = parseInt(String((locationCount as any)?.cnt ?? 0), 10);

    ok(res, {
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
  try {
    const plan = req.body.plan === 'lite' ? 'lite' : 'pro';
    const extraLocations = plan === 'lite' ? 0 : Math.max(0, parseInt(req.body.extraLocations ?? '0', 10));
    const user = await db('users').where({ id: req.userId }).first();
    if (!user) { err(res, 'User not found', 404, 'NOT_FOUND'); return; }

    const customerId = await getOrCreateStripeCustomer(req.userId!, user.email as string);
    const successUrl = `${config.appUrl}/billing/success`;
    const cancelUrl = `${config.appUrl}/dashboard/settings?tab=billing`;
    const session = await createCheckoutSession(customerId, extraLocations, successUrl, cancelUrl, req.userId!, plan);

    ok(res, { url: session.url });
  } catch (e) { next(e); }
}

export async function subscriptionIntent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const plan = req.body.plan === 'lite' ? 'lite' : 'pro';
    const extraLocations = plan === 'lite' ? 0 : Math.max(0, parseInt(req.body.extraLocations ?? '0', 10));
    const promotionCodeId = typeof req.body.promotionCodeId === 'string' ? req.body.promotionCodeId : undefined;
    const user = await db('users').where({ id: req.userId }).first();
    if (!user) { err(res, 'User not found', 404, 'NOT_FOUND'); return; }
    // Serialize checkout changes for this client, including simultaneous tabs.
    // Superseded unpaid intents must not remain payable after switching plans.
    const result = await db.transaction(async trx => {
      // Match account-deletion lock order and keep customer persistence on this
      // transaction's connection; a separate connection can wait on our own lock.
      await trx('users').where({ id: req.userId }).forUpdate().first();
      const client = await trx('clients').where({ user_id: req.userId }).forUpdate().first();
      if (!client) return null;
      if (client.stripe_subscription_id) {
        const existing = await stripe.subscriptions.retrieve(client.stripe_subscription_id as string);
        if (['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(existing.status)) {
          return { existing: true as const };
        }
        if (existing.status === 'incomplete') await stripe.subscriptions.cancel(existing.id);
      }
      const customerId = await getOrCreateStripeCustomer(req.userId!, user.email as string, trx);
      const intent = await createSubscriptionIntent(customerId, extraLocations, req.userId!, promotionCodeId, plan);
      await trx('clients').where({ id: client.id }).update({
        stripe_subscription_id: intent.subscriptionId,
        // The $0 invoice can be paid before its webhook can find this row.
        // Persist only the activation verified by the Stripe create response.
        ...(!intent.paymentRequired ? {
          subscription_status: 'active',
          product_line: plan,
          locations_limit: 1 + extraLocations,
          subscription_current_period_end: new Date(intent.currentPeriodEnd * 1000),
          payment_failed_at: null,
        } : {}),
        updated_at: new Date(),
      });
      return { ...intent, existing: false as const };
    });
    if (!result) { err(res, 'Client not found', 404, 'NOT_FOUND'); return; }
    if (result.existing) {
      err(res, 'A subscription already exists. Open billing settings to manage your payment method or plan.', 409, 'SUBSCRIPTION_EXISTS');
      return;
    }
    ok(res, { clientSecret: result.clientSecret, paymentRequired: result.paymentRequired, subscriptionId: result.subscriptionId, publishableKey: config.stripe.publishableKey });
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
    if (!['upgrade', 'add_location'].includes(action) || typeof promoCode !== 'string') {
      err(res, 'Choose an upgrade or an additional location.', 400, 'INVALID_INPUT'); return;
    }
    ok(res, await previewBillingChange(req.clientId, action, promoCode));
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
