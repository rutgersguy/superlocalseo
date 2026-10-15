import { catalog, PlanKey, BillingInterval, isPlanKey, recurringAmount } from '../config/plans';
import { catalogPrice, subscriptionDetails } from './stripe-catalog';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { db } from '../db/connection';
import { config } from '../config';
import { stripe, syncPaidSubscription } from './stripe.service';

export type BillingAction = 'upgrade' | 'add_location' | 'change_plan';
function problem(message: string, status = 409): never { throw Object.assign(new Error(message), { status, code: 'BILLING_CHANGE' }); }
const objectId = (value: string | { id: string } | null): string | null => typeof value === 'string' ? value : value?.id ?? null;
export function subscriptionFingerprint(sub: Stripe.Subscription): string {
  return JSON.stringify({ items: sub.items.data.map(i => [i.id, i.price.id, i.quantity]).sort(),
    end: sub.current_period_end, cancel: sub.cancel_at_period_end, discounts: sub.discounts });
}
export function changeItems(sub: Stripe.Subscription, action: BillingAction): Stripe.SubscriptionUpdateParams.Item[] {
  const lite = sub.items.data.find(i => i.price.id === config.stripe.prices.liteBase);
  const pro = sub.items.data.find(i => i.price.id === config.stripe.prices.base);
  if (action === 'upgrade') {
    if (!lite || pro) problem('This subscription is already on Pro or cannot be upgraded. Refresh billing.');
    return [{ id: lite.id, price: config.stripe.prices.base, quantity: 1 }];
  }
  if (!pro || lite) problem('Upgrade to Pro before adding another location.');
  const extra = sub.items.data.find(i => i.price.id === config.stripe.prices.location);
  return [{ ...(extra ? { id: extra.id } : {}), price: config.stripe.prices.location, quantity: (extra?.quantity ?? 0) + 1 }];
}
async function subscription(client: Record<string, any>): Promise<Stripe.Subscription> {
  if (!client.stripe_subscription_id) problem('An active subscription is required.');
  const sub = await stripe.subscriptions.retrieve(client.stripe_subscription_id, { expand: ['customer', 'latest_invoice.payment_intent'] });
  if (sub.status !== 'active' || sub.cancel_at_period_end) problem('Resume or resolve your subscription in the billing portal before changing it.');
  return sub;
}
function hasCard(sub: Stripe.Subscription): boolean {
  const customer = typeof sub.customer === 'object' && !sub.customer.deleted ? sub.customer : null;
  return !!(sub.default_payment_method || sub.default_source || customer?.invoice_settings.default_payment_method || customer?.default_source);
}
async function promotion(code: string, customer: string): Promise<Stripe.PromotionCode | undefined> {
  if (!code.trim()) return;
  const result = await stripe.promotionCodes.list({ code: code.trim(), active: true, limit: 1 });
  const p = result.data[0];
  if (!p || !p.coupon.valid || (p.expires_at && p.expires_at <= Date.now() / 1000)
    || (p.max_redemptions && p.times_redeemed >= p.max_redemptions)
    || (p.customer && objectId(p.customer) !== customer)) problem('Invalid or expired promo code.', 400);
  if (p.coupon.metadata?.applyTo === 'setup') problem('This code only applies to setup fees; there is no setup fee for this change.', 400);
  return p;
}
interface Quote {
  action: BillingAction; fingerprint: string; customerId: string; prorationDate: number;
  items: Stripe.SubscriptionUpdateParams.Item[]; promoCode: string; promotionId?: string;
  amountDue: number; currency: string; monthlyAmount: number; needsCard: boolean;
  discount: string | null;
  targetPlan?: PlanKey; interval?: BillingInterval; recurringAmount?: number; targetCapacity?: number;
  targetPriceId?: string; removeLocationIds?: string[]; locationFingerprint?: string; creditAmount?: number;
}
async function invoicePreview(sub: Stripe.Subscription, q: Pick<Quote, 'items' | 'prorationDate' | 'promotionId'>): Promise<Stripe.Invoice> {
  return stripe.invoices.createPreview({ customer: objectId(sub.customer)!, subscription: sub.id,
    subscription_details: { items: q.items, proration_date: q.prorationDate, proration_behavior: 'always_invoice' },
    ...(q.promotionId ? { discounts: [{ promotion_code: q.promotionId }] } : {}),
  });
}
async function assertPlanResources(executor: typeof db, clientId: string, plan: PlanKey, targetCapacity: number, removeLocationIds: string[]) {
  const target = catalog.plans[plan];
  // Keep historical data on inaccessible features; require explicit cleanup for
  // resources that remain usable but would exceed the destination plan's limits.
  const remaining = (await executor('locations').where({ client_id: clientId }).whereNotIn('id', removeLocationIds).select('id')).map(l => l.id);
  const keywordCounts = await executor('keywords').whereIn('location_id', remaining).groupBy('location_id').count('* as n');
  if (keywordCounts.some(r => Number(r.n) > target.keywords)) problem(`Remove extra keywords first. ${target.name} allows ${target.keywords} per retained location.`);
  const members = Number((await executor('team_members').where({ client_id: clientId }).where(q => q.whereNotNull('accepted_at').orWhere('invite_expires_at', '>', new Date())).count('* as n').first())?.n ?? 0);
  if (members + 1 > target.teamSeats) problem(`Remove extra team members first. ${target.name} includes ${target.teamSeats} seats including the owner.`);
  if (target.competitors > 0) {
    const count = Number((await executor('competitors').where({ client_id: clientId }).count('* as n').first())?.n ?? 0);
    if (count > target.competitors * targetCapacity) problem(`Remove extra competitors first. This capacity allows ${target.competitors * targetCapacity}.`);
  }
}
export async function previewBillingChange(clientId: string, action: BillingAction, promoCode: string, options: { plan?: PlanKey; interval?: BillingInterval; capacity?: number; removeLocationIds?: string[] } = {}) {
  const client = await db('clients').where({ id: clientId }).first();
  if (!client) problem('Account not found.', 404);
  const sub = await subscription(client);
  if (sub.pending_update || await db('billing_changes').where({ client_id: clientId }).whereIn('status', ['confirming', 'payment_required']).first())
    problem('Finish your pending billing change before starting another.');
  const customerId = objectId(sub.customer)!;
  const p = await promotion(promoCode, customerId);
  const details = subscriptionDetails(sub);
  if (client.pricing_version === 'legacy') problem('Your existing pricing is preserved. Contact support before changing your legacy plan.');
  const targetPlan = options.plan ?? details?.plan ?? 'pro';
  const interval = options.interval ?? details?.interval ?? 'month';
  if (!isPlanKey(targetPlan) || !['month', 'year'].includes(interval)) problem('Choose a valid plan and billing interval.', 400);
  const target = catalog.plans[targetPlan];
  const targetCapacity = action === 'add_location' ? (details?.capacity ?? 1) + 1 : options.capacity ?? target.includedLocations;
  if (!Number.isInteger(targetCapacity) || targetCapacity < target.includedLocations || targetCapacity > target.maxLocations) problem('Choose a valid number of locations for this plan.', 400);
  const locations = await db('locations').where({ client_id: clientId }).orderBy('id').select('id', 'name');
  const removeLocationIds = options.removeLocationIds ?? [];
  if (new Set(removeLocationIds).size !== removeLocationIds.length || removeLocationIds.some(id => !locations.some(l => l.id === id)) || removeLocationIds.length !== Math.max(0, locations.length - targetCapacity)) problem('Select exactly which locations to remove before reducing capacity.', 400);
  await assertPlanResources(db, clientId, targetPlan, targetCapacity, removeLocationIds);
  const base = await catalogPrice(targetPlan, interval);
  const oldBase = details?.base;
  if (!oldBase) problem('This subscription uses legacy pricing. Contact support before changing it.');
  const items: Stripe.SubscriptionUpdateParams.Item[] = [{ id: oldBase.id, price: base.id, quantity: 1 }];
  const extras = targetCapacity - target.includedLocations;
  const oldExtras = sub.items.data.filter(i => i.id !== oldBase.id);
  items.push(...oldExtras.map(i => ({ id: i.id, deleted: true })));
  if (extras) items.push({ price: (await catalogPrice(targetPlan, interval, true)).id, quantity: extras });
  const prorationDate = Math.floor(Date.now() / 1000);
  const preview = await invoicePreview(sub, { items, prorationDate, promotionId: p?.id });
  const quote: Quote = { action, fingerprint: subscriptionFingerprint(sub), customerId, items, prorationDate,
    promoCode: p?.code ?? '', promotionId: p?.id, amountDue: preview.amount_due, currency: preview.currency,
    targetPlan, interval, targetCapacity, targetPriceId: base.id, removeLocationIds, locationFingerprint: locations.map(l => l.id).join(','),
    recurringAmount: recurringAmount(targetPlan, interval, extras), creditAmount: Math.max(0, -preview.total),
    monthlyAmount: recurringAmount(targetPlan, 'month', extras), needsCard: preview.amount_due > 0 && !hasCard(sub),
    discount: p ? `${p.coupon.percent_off ? `${p.coupon.percent_off}% off` : 'Discount applied'} · ${p.coupon.duration === 'once' ? 'first invoice only' : p.coupon.duration === 'forever' ? 'ongoing' : `${p.coupon.duration_in_months} months`}` : null,
  };
  const id = randomUUID(); const expiresAt = new Date(Date.now() + 15 * 60000);
  await db('billing_changes').insert({ id, client_id: clientId, subscription_id: sub.id, quote: JSON.stringify(quote), expires_at: expiresAt });
  return { id, ...publicQuote(quote), expiresAt };
}
function publicQuote(q: Quote) { return { action: q.action, amountDue: q.amountDue, currency: q.currency, monthlyAmount: q.monthlyAmount, needsCard: q.needsCard, discount: q.discount, targetPlan: q.targetPlan, interval: q.interval, recurringAmount: q.recurringAmount, targetCapacity: q.targetCapacity, removeLocationIds: q.removeLocationIds, creditAmount: q.creditAmount }; }
async function lockedQuote(trx: typeof db, clientId: string, quoteId: string) {
  const client = await trx('clients').where({ id: clientId }).forUpdate().first();
  const row = await trx('billing_changes').where({ id: quoteId, client_id: clientId }).forUpdate().first();
  if (!row || !client) problem('Billing preview not found.', 404);
  if (client.stripe_subscription_id !== row.subscription_id) problem('Your subscription changed. Request a new preview.');
  return { row, client, quote: row.quote as Quote };
}
export async function setupBillingCard(clientId: string, quoteId: string) {
  return db.transaction(async trx => {
    const { row, quote } = await lockedQuote(trx, clientId, quoteId);
    if (row.status !== 'quoted' || new Date(row.expires_at).getTime() < Date.now()) problem('This preview expired. Request a new preview.');
    if (quote.amountDue <= 0) problem('No card is needed for this change.', 400);
    const setup = row.setup_intent_id ? await stripe.setupIntents.retrieve(row.setup_intent_id)
      : await stripe.setupIntents.create({ customer: quote.customerId, usage: 'off_session', payment_method_types: ['card'], metadata: { billingChangeId: row.id } }, { idempotencyKey: `billing-setup-${row.id}` });
    await trx('billing_changes').where({ id: row.id }).update({ setup_intent_id: setup.id });
    return { clientSecret: setup.client_secret, publishableKey: config.stripe.publishableKey };
  });
}
export async function confirmBillingChange(clientId: string, quoteId: string) {
  // Commit the intent to confirm BEFORE calling Stripe. A network/process failure
  // can be retried with the same idempotency key even if Stripe applied the change.
  await db.transaction(async trx => {
    const { row, client, quote } = await lockedQuote(trx, clientId, quoteId);
    if (row.status !== 'quoted') return;
    if (new Date(row.expires_at).getTime() < Date.now()) problem('This preview expired. Request a new preview.');
    const other = await trx('billing_changes').where({ client_id: clientId }).whereNot({ id: quoteId }).whereIn('status', ['confirming', 'payment_required']).first();
    if (other) problem('Another billing change is in progress. Finish it first.');
    const sub = await subscription(client);
    if (sub.pending_update || subscriptionFingerprint(sub) !== quote.fingerprint) problem('Your subscription changed. Request a new preview.');
    if (quote.locationFingerprint !== undefined) {
      const locations = await trx('locations').where({ client_id: clientId }).orderBy('id').select('id');
      if (locations.map(l => l.id).join(',') !== quote.locationFingerprint) problem('Your locations changed. Request a new preview and choose locations again.');
    }
    if (quote.targetPlan && quote.targetCapacity) await assertPlanResources(trx, clientId, quote.targetPlan, quote.targetCapacity, quote.removeLocationIds ?? []);
    await promotion(quote.promoCode, quote.customerId);
    const preview = await invoicePreview(sub, quote);
    if (preview.amount_due !== quote.amountDue || preview.currency !== quote.currency) problem('The amount changed. Request a new preview before confirming.');
    if (row.setup_intent_id) {
      const setup = await stripe.setupIntents.retrieve(row.setup_intent_id);
      if (setup.status !== 'succeeded' || objectId(setup.customer) !== quote.customerId || !setup.payment_method) problem('Save your card before confirming.', 400);
      await stripe.subscriptions.update(sub.id, { default_payment_method: objectId(setup.payment_method)! }, { idempotencyKey: `billing-card-${row.id}` });
    } else if (quote.amountDue > 0 && !hasCard(sub)) problem('Add a payment card before confirming.', 400);
    await trx('billing_changes').where({ id: quoteId }).update({ status: 'confirming', confirmed_at: new Date() });
  });
  try { return await db.transaction(async trx => {
    const { row, quote } = await lockedQuote(trx, clientId, quoteId);
    if (row.status === 'confirming') {
      if (Date.now() - new Date(row.confirmed_at).getTime() > 23 * 3600000) problem('This billing change needs review. Contact support before retrying.');
      const sub = await stripe.subscriptions.update(row.subscription_id, {
        items: quote.items, proration_date: quote.prorationDate, proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete',
        ...(quote.promotionId ? { promotion_code: quote.promotionId } : {}), expand: ['latest_invoice.payment_intent'],
      }, { idempotencyKey: `billing-confirm-${row.id}` });
      const invoiceId = objectId(sub.latest_invoice);
      if (!invoiceId) problem('Stripe has not returned an invoice. Retry this confirmation.');
      await trx('billing_changes').where({ id: quoteId }).update({ status: 'payment_required', invoice_id: invoiceId });
      row.invoice_id = invoiceId;
    }
    return changeResult(trx, clientId, row, quote);
  }); } catch (error) {
    const type = (error as { type?: string }).type;
    // A definitive provider rejection can be corrected with a new preview.
    // Ambiguous network errors retain the committed idempotency key for retry.
    if (type === 'StripeInvalidRequestError' || type === 'StripeCardError') {
      await db('billing_changes').where({ id: quoteId, client_id: clientId, status: 'confirming' }).update({ status: 'failed' });
    }
    throw error;
  }
}

async function changeResult(trx: typeof db, clientId: string, row: any, quote: Quote) {
  if (!row.invoice_id) problem('This change has not been confirmed.');
  const invoice = await stripe.invoices.retrieve(row.invoice_id, { expand: ['payment_intent'] });
  const sub = await stripe.subscriptions.retrieve(row.subscription_id);
  if (invoice.paid && !sub.pending_update) {
    await syncPaidSubscription(sub.id, trx);
    await trx('billing_changes').where({ id: row.id }).update({ status: 'succeeded', updated_at: new Date() });
    return { status: 'succeeded', ...publicQuote(quote), invoiceId: invoice.id, clientSecret: null };
  }
  if (invoice.status === 'void' || sub.status === 'canceled') {
    await trx('billing_changes').where({ id: row.id }).update({ status: 'failed', updated_at: new Date() });
    return { status: 'failed', ...publicQuote(quote), invoiceId: invoice.id, clientSecret: null };
  }
  const pi = typeof invoice.payment_intent === 'object' ? invoice.payment_intent : null;
  return { status: 'payment_required', ...publicQuote(quote), invoiceId: invoice.id, clientSecret: pi?.client_secret ?? null, publishableKey: config.stripe.publishableKey };
}
export async function billingChangeStatus(clientId: string, quoteId: string) {
  return db.transaction(async trx => {
    const { row, quote } = await lockedQuote(trx, clientId, quoteId);
    return changeResult(trx, clientId, row, quote);
  });
}

export async function pendingBillingChange(clientId: string) {
  const row = await db('billing_changes').where({ client_id: clientId }).whereIn('status', ['confirming', 'payment_required']).orderBy('created_at', 'desc').first();
  if (!row) return null;
  if (!row.invoice_id) return { id: row.id, status: row.status, ...publicQuote(row.quote), clientSecret: null };
  const result = await billingChangeStatus(clientId, row.id);
  return result.status === 'succeeded' || result.status === 'failed' ? null : { id: row.id, ...result };
}
export async function cancelBillingChange(clientId: string, quoteId: string) {
  return db.transaction(async trx => {
    const { row, quote } = await lockedQuote(trx, clientId, quoteId);
    if (row.status === 'confirming') problem('Check the confirmation result before canceling this change.');
    if (row.invoice_id) {
      const invoice = await stripe.invoices.retrieve(row.invoice_id);
      if (invoice.paid) return changeResult(trx, clientId, row, quote);
      if (invoice.status === 'open') await stripe.invoices.voidInvoice(invoice.id, {}, { idempotencyKey: `billing-cancel-${row.id}` });
    }
    await trx('billing_changes').where({ id: row.id }).update({ status: 'failed' });
    return { status: 'failed' };
  });
}
