import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { getBillingPortalUrl, createSubscription, changeSubscriptionTier, createCheckoutSession, stripe } from '../services/stripe.service';
import { config } from '../config';
import { logger } from '../utils/logger';

const INCLUDED_PER_TIER: Record<number, number> = { 1: 1, 2: 3, 3: Infinity };
const EXTRA_PRICE_PER_TIER: Record<number, number> = { 1: 150, 2: 100, 3: 75 };

export const subscribeSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const changePlanSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const checkoutSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

type SubscribeBody = z.infer<typeof subscribeSchema>;

export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = req.client;

    const locationCountResult = await db('locations')
      .where({ client_id: req.clientId })
      .count('id as cnt')
      .first();
    const locationCount = parseInt(String((locationCountResult as Record<string, unknown>)?.cnt ?? 0), 10);

    let hasPaymentMethod = false;
    if (client.stripe_customer_id) {
      try {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: client.stripe_customer_id as string,
          type: 'card',
          limit: 1,
        });
        hasPaymentMethod = paymentMethods.data.length > 0;
      } catch (e) {
        logger.warn('Could not fetch payment methods from Stripe', { error: (e as Error).message });
      }
    }

    const GRACE_PERIOD_DAYS = 3;
    let graceDaysRemaining: number | null = null;
    if (client.subscription_status === 'past_due' && client.payment_failed_at) {
      const failedAt = new Date(client.payment_failed_at as string);
      const elapsedDays = (Date.now() - failedAt.getTime()) / (1000 * 60 * 60 * 24);
      graceDaysRemaining = Math.max(0, Math.ceil(GRACE_PERIOD_DAYS - elapsedDays));
    }

    let trialEndsAt: string | null = null;
    let trialDaysRemaining: number | null = null;
    if (client.subscription_status === 'trialing' && client.trial_ends_at) {
      trialEndsAt = new Date(client.trial_ends_at as string).toISOString();
      const msLeft = new Date(trialEndsAt).getTime() - Date.now();
      trialDaysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    }

    const tier = (client.subscription_tier as number) ?? 1;
    const included = INCLUDED_PER_TIER[tier] ?? 1;
    const extraLocationCount = included === Infinity ? 0 : Math.max(0, locationCount - included);
    const extraLocationCostPerMonth = extraLocationCount * (EXTRA_PRICE_PER_TIER[tier] ?? 150);

    ok(res, {
      tier: client.subscription_tier,
      status: client.subscription_status,
      currentPeriodEnd: client.subscription_current_period_end,
      locationCount,
      includedLocationCount: included === Infinity ? null : included,
      extraLocationCount,
      extraLocationCostPerMonth,
      hasPaymentMethod,
      paymentFailedAt: client.payment_failed_at ?? null,
      graceDaysRemaining,
      trialEndsAt,
      trialDaysRemaining,
    });
  } catch (e) {
    next(e);
  }
}

export async function subscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tier } = req.body as SubscribeBody;
    const client = req.client;

    // Get user's stripe_customer_id
    const user = await db('users').where({ id: req.userId }).first();
    if (!user) {
      err(res, 'User not found', 404, 'NOT_FOUND');
      return;
    }

    if (!user.stripe_customer_id) {
      err(res, 'No Stripe customer found. Please contact support.', 400, 'NO_STRIPE_CUSTOMER');
      return;
    }

    if (client.stripe_subscription_id) {
      err(res, 'Already subscribed. Use the billing portal to change plans.', 400, 'ALREADY_SUBSCRIBED');
      return;
    }

    const subscription = await createSubscription(user.stripe_customer_id as string, tier);

    await db('clients').where({ id: req.clientId }).update({
      stripe_subscription_id: subscription.id,
      subscription_tier: tier,
      subscription_status: subscription.status === 'trialing' ? 'active' : subscription.status,
      updated_at: new Date(),
    });

    ok(res, {
      subscriptionId: subscription.id,
      status: subscription.status,
      clientSecret: (subscription.latest_invoice as { payment_intent?: { client_secret?: string } } | null)?.payment_intent?.client_secret ?? null,
    });
  } catch (e) {
    next(e);
  }
}

export async function portal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await db('users').where({ id: req.userId }).first();
    if (!user || !user.stripe_customer_id) {
      err(res, 'No Stripe customer associated with this account', 400, 'NO_STRIPE_CUSTOMER');
      return;
    }

    const returnUrl = `${config.appUrl}/dashboard/billing`;
    const url = await getBillingPortalUrl(user.stripe_customer_id as string, returnUrl);

    ok(res, { url });
  } catch (e) {
    next(e);
  }
}

export async function changePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = changePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR');
      return;
    }

    const { tier } = parsed.data;
    const client = req.client;

    if (!client.stripe_subscription_id) {
      err(res, 'No active subscription found', 400, 'NO_SUBSCRIPTION');
      return;
    }
    if (client.subscription_tier === tier) {
      err(res, 'Already on this plan', 400, 'SAME_PLAN');
      return;
    }

    await changeSubscriptionTier(client.stripe_subscription_id as string, tier);
    await db('clients').where({ id: req.clientId }).update({ subscription_tier: tier, updated_at: new Date() });

    ok(res, { tier, changed: true });
  } catch (e) {
    next(e);
  }
}

export async function checkout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR');
      return;
    }
    const { tier } = parsed.data;
    const client = req.client;

    if (client.stripe_subscription_id) {
      err(res, 'Already subscribed. Use change-plan to switch tiers.', 400, 'ALREADY_SUBSCRIBED');
      return;
    }

    const user = await db('users').where({ id: req.userId }).first();
    if (!user?.stripe_customer_id) {
      err(res, 'No Stripe customer found. Please contact support.', 400, 'NO_STRIPE_CUSTOMER');
      return;
    }

    const successUrl = `${config.appUrl}/dashboard/settings?tab=billing&checkout=success`;
    const cancelUrl = `${config.appUrl}/dashboard/settings?tab=billing`;
    const session = await createCheckoutSession(user.stripe_customer_id as string, tier, successUrl, cancelUrl);

    ok(res, { url: session.url });
  } catch (e) {
    next(e);
  }
}
