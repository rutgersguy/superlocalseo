// Run inside the isolated test API image; refuses live Stripe keys.
const assert = require('assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('/app/dist/db/connection');
const { config } = require('/app/dist/config');
const { stripe } = require('/app/dist/services/stripe.service');
const { catalog } = require('/app/dist/config/plans');
const { subscriptionDetails } = require('/app/dist/services/stripe-catalog');
const tag = 'sls240-qa';
let fixtures = [];
async function api(path, token, body, method = 'POST') {
  if (path === '/billing/subscription-intent') { const preview = await api('/billing/subscription-preview', token, body); assert(preview.success, JSON.stringify(preview)); body = { ...body, previewToken: preview.data.previewToken }; }
  const r = await fetch(`http://localhost:3000/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, ...await r.json() };
}
async function request(path, account, body, method) {
  const r = await api(path, account?.token, body, method);
  assert(r.success, `${path}: ${JSON.stringify(r)}`); return r.data;
}
async function confirm(a, q) {
  const result = await request(`/billing/changes/${q.id}/confirm`, a, {});
  assert.equal(result.status, 'succeeded');
  const invoice = await stripe.invoices.retrieve(result.invoiceId);
  assert.equal(invoice.amount_due, q.amountDue);
  return result;
}
async function main() {
  assert(config.stripe.secretKey.startsWith('sk_test_'));
  if (process.argv.includes('--cleanup')) {
    for (const u of await db('users').whereLike('email', `${tag}-%@example.invalid`)) {
      if (u.stripe_customer_id) await stripe.customers.del(u.stripe_customer_id);
      await db('users').where({ id: u.id }).delete();
    }
    console.log('QA fixtures cleaned'); return;
  }
  const coupon = await stripe.coupons.create({ percent_off: 100, duration: 'once', metadata: { qa: tag } });
  const promo = await stripe.promotionCodes.create({ coupon: coupon.id, code: `QA240${Date.now()}` });
  for (const plan of ['starter', 'pro', 'multi']) for (const interval of ['month', 'year']) {
    const email = `${tag}-${plan}-${interval}-${Date.now()}@example.invalid`;
    const password = crypto.randomBytes(16).toString('hex');
    const [user] = await db('users').insert({ email, password_hash: await bcrypt.hash(password, 12), role: 'client', email_verified: true }).returning('*');
    const [client] = await db('clients').insert({ user_id: user.id, business_name: 'Disposable plan QA', subscription_status: 'trialing', product_line: 'pro', plan_key: 'pro', pricing_version: catalog.version, trial_ends_at: new Date(Date.now() + 14 * 86400000), onboarding_step: 5 }).returning('*');
    const [location] = await db('locations').insert({ client_id: client.id, name: 'Keep this location', is_primary: true }).returning('*');
    const auth = await request('/auth/login', null, { email, password });
    const a = { email, password, token: auth.accessToken, clientId: client.id, locationId: location.id, plan, interval, promo: promo.code };
    const intent = await request('/billing/subscription-intent', a, { plan, interval, promotionCodeId: promo.id });
    assert.equal(intent.paymentRequired, false);
    a.subscriptionId = intent.subscriptionId;
    const sub = await stripe.subscriptions.retrieve(intent.subscriptionId);
    a.customerId = sub.customer;
    const details = subscriptionDetails(sub);
    assert.equal(details.plan, plan); assert.equal(details.interval, interval); assert.equal(details.capacity, catalog.plans[plan].includedLocations);
    const row = await db('clients').where({ id: client.id }).first(); assert.equal(row.plan_key, plan); assert.equal(row.billing_interval, interval);
    const retry = await api('/billing/subscription-intent', a.token, { plan, interval, promotionCodeId: promo.id }); assert.equal(retry.status, 409);
    assert.equal((await stripe.subscriptions.list({ customer: sub.customer, status: 'all' })).data.length, 1);
    fixtures.push(a);
    console.log(JSON.stringify({ signup: `${plan}/${interval}`, due: 0, capacity: details.capacity, repeatBlocked: true }));
  }
  const a = fixtures[0];
  await stripe.paymentMethods.attach('pm_card_visa', { customer: a.customerId });
  // The attach call creates an instance; use the returned ID, not the test alias.
  const card = (await stripe.paymentMethods.list({ customer: a.customerId, type: 'card' })).data[0];
  await stripe.subscriptions.update(a.subscriptionId, { default_payment_method: card.id });
  let q = await request('/billing/changes/preview', a, { action: 'change_plan', plan: 'pro', interval: 'year', capacity: 2 });
  assert.equal(q.recurringAmount, 278000); assert.equal(q.interval, 'year');
  const results = await Promise.all([confirm(a, q), confirm(a, q)]); assert.equal(results[0].invoiceId, results[1].invoiceId);
  q = await request('/billing/changes/preview', a, { action: 'add_location' });
  assert.equal(q.recurringAmount, 357000); await confirm(a, q);
  const extras = await db('locations').insert([{ client_id: a.clientId, name: 'Remove A' }, { client_id: a.clientId, name: 'Remove B' }]).returning('id');
  const downgrade = { action: 'change_plan', plan: 'starter', interval: 'month', capacity: 1 };
  assert.equal((await api('/billing/changes/preview', a.token, downgrade)).status, 400);
  assert.equal((await api('/billing/changes/preview', a.token, { ...downgrade, removeLocationIds: [extras[0].id, fixtures[1].locationId] })).status, 400);
  q = await request('/billing/changes/preview', a, { ...downgrade, removeLocationIds: extras.map(l => l.id) });
  await confirm(a, q);
  assert.deepEqual((await db('active_locations').where({ client_id: a.clientId }).select('id')).map(l => l.id), [a.locationId]);
  assert.equal((await db('clients').where({ id: a.clientId }).first()).plan_key, 'starter');
  assert.equal((await stripe.subscriptions.list({ customer: a.customerId, status: 'all' })).data.length, 1);
  console.log(JSON.stringify({ intervalSwitch: 'passed', annualAddon: 'passed', retry: 'same invoice', downgrade: 'only selected locations removed', foreignLocation: 'blocked', invoiceAmounts: 'match previews' }));
  // Browser QA account: Starter annual, no card, with a free promo available.
  const out = fixtures.map(({ token, ...rest }) => rest);
  require('fs').writeFileSync('/tmp/sls240-browser-credentials.json', JSON.stringify(out), { mode: 0o600 });
  console.log('Browser fixture credentials saved privately in container /tmp/sls240-browser-credentials.json');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.destroy());
