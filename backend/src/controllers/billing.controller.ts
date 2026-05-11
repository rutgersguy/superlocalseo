import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { getOrCreateStripeCustomer, createCheckoutSession, createSubscriptionIntent, getBillingPortalUrl, handleWebhookEvent, validatePromoCode } from '../services/stripe.service';
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
    });
  } catch (e) { next(e); }
}

export async function checkout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const extraLocations = Math.max(0, parseInt(req.body.extraLocations ?? '0', 10));
    const user = await db('users').where({ id: req.userId }).first();
    if (!user) { err(res, 'User not found', 404, 'NOT_FOUND'); return; }

    const customerId = await getOrCreateStripeCustomer(req.userId!, user.email as string);
    const successUrl = `${config.appUrl}/billing/success`;
    const cancelUrl = `${config.appUrl}/settings`;
    const session = await createCheckoutSession(customerId, extraLocations, successUrl, cancelUrl, req.userId!);

    ok(res, { url: session.url });
  } catch (e) { next(e); }
}

export async function subscriptionIntent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const extraLocations = Math.max(0, parseInt(req.body.extraLocations ?? '0', 10));
    const promotionCodeId = typeof req.body.promotionCodeId === 'string' ? req.body.promotionCodeId : undefined;
    const user = await db('users').where({ id: req.userId }).first();
    if (!user) { err(res, 'User not found', 404, 'NOT_FOUND'); return; }
    const customerId = await getOrCreateStripeCustomer(req.userId!, user.email as string);
    const { clientSecret, subscriptionId } = await createSubscriptionIntent(customerId, extraLocations, req.userId!, promotionCodeId);
    ok(res, { clientSecret, subscriptionId, publishableKey: config.stripe.publishableKey });
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
    if (!user?.stripe_customer_id) { err(res, 'No billing account found', 400, 'NO_STRIPE_CUSTOMER'); return; }
    const url = await getBillingPortalUrl(user.stripe_customer_id as string, `${config.appUrl}/settings`);
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
