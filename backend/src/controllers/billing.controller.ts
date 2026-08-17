import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { getOrCreateStripeCustomer, createCheckoutSession, createSubscriptionIntent, upgradeToProSubscription, getBillingPortalUrl, handleWebhookEvent, validatePromoCode } from '../services/stripe.service';
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
      trialEndsAt: trialEndsAt?.toISOString() ?? null,
      trialDaysLeft,
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
    const customerId = await getOrCreateStripeCustomer(req.userId!, user.email as string);
    const { clientSecret, subscriptionId } = await createSubscriptionIntent(customerId, extraLocations, req.userId!, promotionCodeId, plan);
    // Persist the subscription id now so the sub-id-matched webhooks (invoice.payment_succeeded,
    // invoice.payment_failed, customer.subscription.deleted) work for the embedded-payment flow.
    // (Previously only checkout.session.completed set this — never the subscription-intent path.)
    await db('clients').where({ user_id: req.userId }).update({ stripe_subscription_id: subscriptionId });
    ok(res, { clientSecret, subscriptionId, publishableKey: config.stripe.publishableKey });
  } catch (e) { next(e); }
}

/**
 * POST /billing/upgrade — upgrade an active Lite subscriber to Pro.
 * Returns a clientSecret if additional payment confirmation is needed (proration +
 * setup fee), or null if covered by credit. product_line flips to 'pro' on the
 * invoice.payment_succeeded webhook once the upgrade invoice is paid.
 */
export async function upgrade(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = req.client;
    if (!client) { err(res, 'Client not found', 404, 'NOT_FOUND'); return; }
    if (client.product_line !== 'lite') { err(res, 'Account is already on Pro', 400, 'ALREADY_PRO'); return; }
    if (!client.stripe_subscription_id) { err(res, 'No active subscription to upgrade', 400, 'NO_SUBSCRIPTION'); return; }

    const promotionCodeId = typeof req.body.promotionCodeId === 'string' ? req.body.promotionCodeId : undefined;
    const result = await upgradeToProSubscription(client.stripe_subscription_id as string, req.userId!, promotionCodeId);
    ok(res, { ...result, publishableKey: config.stripe.publishableKey });
  } catch (e) { next(e); }
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
    const user = await db('users').where({ id: req.userId }).first();
    if (!user?.email) { err(res, 'No billing account found', 400, 'NO_STRIPE_CUSTOMER'); return; }
    // Customers are created lazily now (#177), so a user who has never checked
    // out has no stripe_customer_id yet. Create on demand rather than erroring.
    const customerId = await getOrCreateStripeCustomer(req.userId!, user.email as string);
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
