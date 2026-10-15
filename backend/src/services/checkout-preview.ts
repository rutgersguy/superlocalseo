import jwt from 'jsonwebtoken';
import { config } from '../config';
import { catalog, isPlanKey, BillingInterval, PlanKey } from '../config/plans';
import { catalogPrice } from './stripe-catalog';
import { stripe } from './stripe.service';
export function discountLabel(c: { percent_off: number | null; amount_off: number | null; duration: string; duration_in_months?: number | null }) {
  return `${c.percent_off != null ? `${c.percent_off}% off` : `$${((c.amount_off ?? 0) / 100).toFixed(2)} off`} · ${c.duration === 'once' ? 'first invoice only; later changes and renewals are not discounted' : c.duration === 'forever' ? 'ongoing' : `${c.duration_in_months} months`}`;
}
export async function resolvePromotion(code: string, customer?: string) {
  const p = (await stripe.promotionCodes.list({ code: code.trim().toUpperCase(), active: true, limit: 1 })).data[0];
  if (!p || !p.coupon.valid || (p.expires_at && p.expires_at <= Date.now()/1000) || (p.max_redemptions && p.times_redeemed >= p.max_redemptions) || (p.customer && (typeof p.customer === 'string' ? p.customer : p.customer.id) !== customer) || p.coupon.metadata?.applyTo === 'setup') throw Object.assign(new Error('Invalid, expired or ineligible promo code.'), { status: 400 });
  return p;
}
export interface CheckoutSelection { plan: PlanKey; interval: BillingInterval; extraLocations: number; promotionCodeId?: string; }
export function checkoutSelection(body: any): CheckoutSelection {
  const plan = body.plan === 'lite' ? 'starter' : body.plan;
  const interval = body.interval ?? 'month'; const extraLocations = Number(body.extraLocations ?? 0);
  if (!isPlanKey(plan) || !['month', 'year'].includes(interval) || !Number.isInteger(extraLocations) || extraLocations < 0 || catalog.plans[plan].includedLocations + extraLocations > catalog.plans[plan].maxLocations) throw Object.assign(new Error('Choose a valid plan, billing interval and location capacity.'), { status: 400 });
  return { plan, interval, extraLocations, ...(body.promotionCodeId ? { promotionCodeId: body.promotionCodeId } : {}) };
}
export async function previewCheckout(customer: string, selection: CheckoutSelection) {
  const base = await catalogPrice(selection.plan, selection.interval);
  const items = [{ price: base.id, quantity: 1 }];
  if (selection.extraLocations) items.push({ price: (await catalogPrice(selection.plan, selection.interval, true)).id, quantity: selection.extraLocations });
  const p = selection.promotionCodeId ? await stripe.promotionCodes.retrieve(selection.promotionCodeId) : null;
  const invoice = await stripe.invoices.createPreview({ customer, subscription_details: { items }, discounts: p ? [{ promotion_code: p.id }] : [] });
  return { amountDue: invoice.amount_due, currency: invoice.currency, discount: p ? discountLabel(p.coupon) : null };
}
export function signCheckoutPreview(userId: string, selection: CheckoutSelection, amountDue: number) {
  return jwt.sign({ userId, selection, amountDue }, config.jwt.secret, { expiresIn: '15m', audience: 'checkout-preview' });
}
export function verifyCheckoutPreview(token: string, userId: string, selection: CheckoutSelection): number {
  try {
    const q = jwt.verify(token, config.jwt.secret, { audience: 'checkout-preview', algorithms: ['HS256'] }) as any;
    if (q.userId !== userId || JSON.stringify(q.selection) !== JSON.stringify(selection)) throw new Error('changed');
    return q.amountDue;
  } catch { throw Object.assign(new Error('Review the current total before confirming your subscription.'), { status: 409 }); }
}
