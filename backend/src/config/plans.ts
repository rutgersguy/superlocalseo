import catalog from './plan-catalog.json';
export { catalog };
export type PlanKey = keyof typeof catalog.plans;
export type BillingInterval = 'month' | 'year';
export const isPlanKey = (value: unknown): value is PlanKey => typeof value === 'string' && Object.prototype.hasOwnProperty.call(catalog.plans, value);
export function planFor(client: Record<string, any>) {
  const key: PlanKey = client.subscription_status === 'trialing' ? 'pro' : isPlanKey(client.plan_key) ? client.plan_key : client.product_line === 'lite' ? 'starter' : 'pro';
  return { key, ...catalog.plans[key] };
}
export function priceLookup(plan: PlanKey, interval: BillingInterval, addon = false) {
  return `sls_${catalog.version}_${plan}_${interval}${addon ? '_location' : ''}`;
}
export function recurringAmount(plan: PlanKey, interval: BillingInterval, extra = 0) {
  const p = catalog.plans[plan];
  return interval === 'year' ? p.annual + p.extraAnnual * extra : p.monthly + p.extraMonthly * extra;
}
