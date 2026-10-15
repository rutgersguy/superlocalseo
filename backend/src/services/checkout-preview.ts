import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
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
  if (customer) await assertPromotionEligible(p, customer);
  return p;
}

const id = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id;
export async function assertPromotionEligible(p: Stripe.PromotionCode, customer: string): Promise<void> {
  const reject = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!p.active || !p.coupon.valid || (p.expires_at && p.expires_at <= Date.now()/1000) || (p.max_redemptions && p.times_redeemed >= p.max_redemptions) || (p.customer && id(p.customer) !== customer) || p.coupon.metadata?.applyTo === 'setup') reject('Invalid, expired or ineligible promo code.');
  const used = (d: Stripe.Discount | string | null | undefined): boolean => !!d && typeof d !== 'string' && id(d.promotion_code) === p.id;
  const owner = await stripe.customers.retrieve(customer);
  if (!owner.deleted && used(owner.discount)) reject('You have already redeemed this promo code. Leave the promo field blank to keep any ongoing discount.');
  // Once describes coupon duration, not customer redemption count. Finalized
  // invoice history survives removal of a consumed subscription discount.
  let after: string | undefined;
  do {
    const page = await stripe.invoices.list({ customer, limit: 100, ...(after ? { starting_after: after } : {}), expand: ['data.discounts'] });
    if (page.data.some(i => i.status !== 'draft' && (used(i.discount) || i.discounts?.some(d => !('deleted' in Object(d)) && used(d as Stripe.Discount))))) reject('You have already redeemed this promo code. It cannot be used again for an add-on or another subscription.');
    after = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (after);
  if (p.restrictions.first_time_transaction) {
    const [subscriptions, payments] = await Promise.all([
      stripe.subscriptions.list({ customer, status: 'all', limit: 1 }),
      stripe.paymentIntents.list({ customer, limit: 1 }),
    ]);
    if (subscriptions.data.length || payments.data.length) reject('This promo code is only available before your first transaction or subscription.');
  }
}

// Ask Stripe to price the full recurring items, without proration or customer
// balance. Do not present an initial-only discount as a renewal discount.
export async function previewRenewal(customer: string, items: Array<{ price: string; quantity: number }>, discounts: Array<{ id?: string; coupon: Stripe.Coupon; end?: number | null }>, interval: BillingInterval, renewalAt?: number, existing?: { subscription: string; items: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[] }) {
  const date = new Date(); date.setUTCMonth(date.getUTCMonth() + (interval === 'year' ? 12 : 1));
  const next = renewalAt ?? Math.floor(date.getTime()/1000);
  const ongoing = discounts.filter(d => {
    if (d.coupon.duration === 'once') return false;
    if (d.end) return d.end > next;
    if (d.coupon.duration !== 'repeating') return true;
    const ends = new Date(); ends.setUTCMonth(ends.getUTCMonth() + (d.coupon.duration_in_months ?? 0));
    return Math.floor(ends.getTime()/1000) > next;
  });
  const renewal = await stripe.invoices.createPreview({ customer, preview_mode: 'recurring', ...(existing ? { subscription: existing.subscription } : {}), subscription_details: { items: existing?.items ?? items }, discounts: ongoing.map(d => d.id ? { discount: d.id } : { coupon: d.coupon.id }) });
  return { renewalAmount: renewal.total, renewalDiscount: ongoing.map(d => discountLabel(d.coupon)).join('; ') || null };
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
  if (p) await assertPromotionEligible(p, customer);
  const invoice = await stripe.invoices.createPreview({ customer, subscription_details: { items }, discounts: p ? [{ promotion_code: p.id }] : [] });
  const renewal = await previewRenewal(customer, items, p ? [{ coupon: p.coupon }] : [], selection.interval);
  return { amountDue: invoice.amount_due, currency: invoice.currency, discount: p ? discountLabel(p.coupon) : null, ...renewal };
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
