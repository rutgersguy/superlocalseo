import Stripe from 'stripe';
import { config } from '../config';
import { catalog, PlanKey, BillingInterval, isPlanKey, priceLookup, recurringAmount } from '../config/plans';
const api = new Stripe(config.stripe.secretKey);
export async function catalogPrice(plan: PlanKey, interval: BillingInterval, addon = false): Promise<Stripe.Price> {
  const key = priceLookup(plan, interval, addon);
  const prices = await api.prices.list({ lookup_keys: [key], active: true, limit: 2 });
  const price = prices.data[0];
  const p = catalog.plans[plan];
  const expected = addon ? interval === 'year' ? p.extraAnnual : p.extraMonthly : recurringAmount(plan, interval);
  if (prices.data.length !== 1 || price.unit_amount !== expected || price.currency !== catalog.currency || price.recurring?.interval !== interval || price.recurring.interval_count !== 1) {
    throw Object.assign(new Error('This plan is temporarily unavailable. Please try again later.'), { status: 503 });
  }
  return price;
}
export function subscriptionDetails(sub: Stripe.Subscription) {
  const base = sub.items.data.find(i => i.price.metadata?.catalogVersion === catalog.version && i.price.metadata?.kind === 'base' && isPlanKey(i.price.metadata.plan));
  if (!base) return null;
  const plan = base.price.metadata.plan as PlanKey;
  const interval = base.price.recurring?.interval as BillingInterval;
  if (!['month', 'year'].includes(interval)) return null;
  const extra = sub.items.data.filter(i => i.price.metadata?.catalogVersion === catalog.version && i.price.metadata.kind === 'location' && i.price.metadata.plan === plan).reduce((sum, i) => sum + (i.quantity ?? 0), 0);
  return { plan, interval, extra, capacity: catalog.plans[plan].includedLocations + extra, base };
}
