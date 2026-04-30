import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { getBillingPortalUrl, createSubscription, stripe } from '../services/stripe.service';
import { config } from '../config';
import { logger } from '../utils/logger';

export const subscribeSchema = z.object({
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

    ok(res, {
      tier: client.subscription_tier,
      status: client.subscription_status,
      currentPeriodEnd: client.subscription_current_period_end,
      locationCount,
      hasPaymentMethod,
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
