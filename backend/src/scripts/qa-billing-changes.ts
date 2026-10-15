// Run only against the isolated Stripe test stack after scripts/qa-billing-changes.cjs.
import assert from 'node:assert/strict';
import { db } from '../db/connection';
import { config } from '../config';
import { stripe, handleWebhookEvent } from '../services/stripe.service';
import { previewBillingChange, confirmBillingChange, setupBillingCard } from '../services/billing-change.service';
import Stripe from 'stripe';

async function main() {
  assert(config.env === 'test' && config.stripe.secretKey.startsWith('sk_test_'), 'Isolated test environment required');
  const clients = await db('clients').join('users', 'users.id', 'clients.user_id').where('users.email', 'like', 'sls239-20261015-%@example.invalid').select('clients.*', 'users.email', 'users.stripe_customer_id');
  assert.equal(clients.length, 5);
  for (const client of clients) {
    const subs = await stripe.subscriptions.list({ customer: client.stripe_customer_id, status: 'all' });
    assert.equal(subs.data.length, 1, 'No duplicate subscriptions');
    const quotes = await db('billing_changes').where({ client_id: client.id }).whereNotNull('invoice_id');
    assert(quotes.length);
    for (const q of quotes) {
      const inv = await stripe.invoices.retrieve(q.invoice_id);
      assert.equal(inv.amount_due, q.quote.amountDue, 'Charged amount must match confirmed preview exactly');
      assert.equal(inv.status, client.email.includes('-decline@') ? 'void' : 'paid');
    }
  }
  const client = clients.find(c => c.email.includes('-card@'))!;
  const other = clients.find(c => c.email.includes('-promo@'))!;
  const expired = await previewBillingChange(client.id, 'add_location', '');
  await db('billing_changes').where({ id: expired.id }).update({ expires_at: new Date(0) });
  await assert.rejects(confirmBillingChange(client.id, expired.id), /expired/);
  await assert.rejects(setupBillingCard(other.id, expired.id), /not found/);
  const first = await previewBillingChange(client.id, 'add_location', '');
  const second = await previewBillingChange(client.id, 'add_location', '');
  const competing = await Promise.allSettled([confirmBillingChange(client.id, first.id), confirmBillingChange(client.id, second.id)]);
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(r => r.status === 'rejected').length, 1);
  const winner = competing[0].status === 'fulfilled' ? first : second;
  const retries = await Promise.all([confirmBillingChange(client.id, winner.id), confirmBillingChange(client.id, winner.id)]);
  assert(retries.every(r => r.status === 'succeeded'));
  assert.equal(retries[0].invoiceId, retries[1].invoiceId);
  const after = await stripe.subscriptions.retrieve(client.stripe_subscription_id);
  assert.equal(after.items.data.find(i => i.price.id === config.stripe.prices.location)?.quantity, 1);
  // Portal changes do not rewrite our old metadata.plan. Price IDs are authoritative.
  const downgrade = clients.find(c => c.email.includes('-nocard@'))!;
  const sub = await stripe.subscriptions.retrieve(downgrade.stripe_subscription_id);
  const item = sub.items.data.find(i => i.price.id === config.stripe.prices.base)!;
  const changed = await stripe.subscriptions.update(sub.id, { items: [{ id: item.id, price: config.stripe.prices.liteBase }], proration_behavior: 'always_invoice' });
  await handleWebhookEvent({ type: 'customer.subscription.updated', data: { object: changed } } as unknown as Stripe.Event);
  assert.equal((await db('clients').where({ id: downgrade.id }).first()).product_line, 'lite');
  const scheduled = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
  await handleWebhookEvent({ type: 'customer.subscription.updated', data: { object: scheduled } } as unknown as Stripe.Event);
  assert.equal((await db('clients').where({ id: downgrade.id }).first()).subscription_status, 'active');
  const canceled = await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
  await handleWebhookEvent({ type: 'customer.subscription.deleted', data: { object: canceled } } as unknown as Stripe.Event);
  assert.equal((await db('clients').where({ id: downgrade.id }).first()).subscription_status, 'canceled');
  console.log(JSON.stringify({ invoiceAmounts: 'exactly match previews', duplicateSubscriptions: 0, crossAccount: 'blocked', expiredQuote: 'blocked', competingChanges: 'one applied', sameQuoteRetry: 'same invoice', downgrade: 'Lite gating restored', scheduledCancel: 'access retained', cancellation: 'access revoked' }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.destroy());
