/**
 * Manual end-to-end verification of the Lite/Pro billing flows against (sandbox) Stripe.
 *
 * This is NOT a unit test (it hits the real Stripe test API and the dev DB), so it lives
 * outside the jest suite. Run it against the running stack:
 *
 *   docker exec superlocalseo-api npx ts-node -r dotenv/config src/scripts/verify-lite-billing.ts
 *
 * It drives the real code paths: subscription-intent (plan=lite) -> pay with a test card
 * -> invoice.payment_succeeded webhook -> product_line flips to 'lite'; then the Lite->Pro
 * upgrade (price swap, setup fee waived, payment-gated flip). Creates a throwaway user and
 * sandbox subscription and cleans both up. Exits non-zero if any check fails.
 *
 * Requires test-mode Stripe with STRIPE_LITE_BASE_PRICE_ID configured. Do not run against
 * a live Stripe account.
 */
import Stripe from 'stripe';
import { stripe, handleWebhookEvent } from '../services/stripe.service';
import { db } from '../db/connection';
import { config } from '../config';

const API = 'http://localhost:3000/api';
const PW = 'TestPass123!';
const log = (...a: unknown[]) => console.log(...a);
let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  log(`${cond ? '  PASS' : '  FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

async function post(path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<any>;
}

async function payIntent(clientSecret: string) {
  const piId = clientSecret.split('_secret')[0];
  const pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.status === 'succeeded') return; // upgrade invoice auto-charged the saved card
  await stripe.paymentIntents.confirm(piId, { payment_method: 'pm_card_visa' });
}

// Build a real invoice.payment_succeeded event for the subscription's latest invoice and
// run it through the actual webhook handler (Stripe's HTTP delivery isn't our code).
async function fireInvoicePaid(subscriptionId: string) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
  const invoice = sub.latest_invoice as Stripe.Invoice;
  await handleWebhookEvent({ id: 'evt_verify', type: 'invoice.payment_succeeded', data: { object: invoice } } as unknown as Stripe.Event);
}

async function productLine(email: string): Promise<string> {
  const row = await db('clients').where({ user_id: db('users').where({ email }).select('id') }).first();
  return (row?.product_line as string) ?? '(none)';
}

async function main() {
  if ((config.stripe.secretKey || '').startsWith('sk_live')) {
    log('Refusing to run against a LIVE Stripe key.');
    process.exit(2);
  }
  const email = `verify-lite-${Math.floor(Math.random() * 1e9)}@test.com`;
  log(`\n=== Lite/Pro billing verification (${email}) ===`);
  log('liteBase:', config.stripe.prices.liteBase, '| proBase:', config.stripe.prices.base, '| setup:', config.stripe.prices.setup);

  await post('/auth/register', null, { email, password: PW, businessName: 'Verify Lite Co' });
  await db('users').where({ email }).update({ email_verified: true });
  const login = await post('/auth/login', null, { email, password: PW });
  const token = login?.data?.accessToken as string;
  check('registered + logged in', !!token);

  log('\n-- Lite checkout --');
  const intent = await post('/billing/subscription-intent', token, { plan: 'lite', extraLocations: 0 });
  const subId = intent?.data?.subscriptionId as string;
  check('subscription-intent returned a subscription', !!subId);
  const liteSub = await stripe.subscriptions.retrieve(subId);
  check('subscription uses the Lite price', liteSub.items.data[0]?.price.id === config.stripe.prices.liteBase);
  check("metadata.plan === 'lite'", liteSub.metadata?.plan === 'lite', liteSub.metadata?.plan);
  check('no setup-fee item on Lite sub', !liteSub.items.data.some((i) => i.price.id === config.stripe.prices.setup));

  await payIntent(intent.data.clientSecret);
  await fireInvoicePaid(subId);
  check("product_line flipped to 'lite' after payment", (await productLine(email)) === 'lite', await productLine(email));

  log('\n-- Lite -> Pro upgrade --');
  const up = await post('/billing/upgrade', token, {});
  check('upgrade returned an invoiceId', !!up?.data?.invoiceId, JSON.stringify(up?.error ?? up?.data));
  const proSub = await stripe.subscriptions.retrieve(subId);
  check('subscription swapped to Pro base price', proSub.items.data.some((i) => i.price.id === config.stripe.prices.base));
  check('Lite price removed', !proSub.items.data.some((i) => i.price.id === config.stripe.prices.liteBase));
  check("metadata.plan === 'pro'", proSub.metadata?.plan === 'pro', proSub.metadata?.plan);
  const upInvoice = await stripe.invoices.retrieve(up.data.invoiceId, { expand: ['lines'] });
  check('upgrade invoice has NO setup fee (waived)', !upInvoice.lines.data.some((l) => l.price?.id === config.stripe.prices.setup));
  check('product_line still lite until upgrade invoice paid', (await productLine(email)) === 'lite', await productLine(email));

  if (up.data.clientSecret) await payIntent(up.data.clientSecret);
  else if (upInvoice.status === 'open') await stripe.invoices.pay(up.data.invoiceId, { payment_method: 'pm_card_visa' }).catch(() => {});
  await fireInvoicePaid(subId);
  check("product_line flipped to 'pro' after upgrade paid", (await productLine(email)) === 'pro', await productLine(email));

  log('\n-- Cleanup --');
  await stripe.subscriptions.cancel(subId).catch(() => {});
  await db('clients').where({ user_id: db('users').where({ email }).select('id') }).del();
  await db('users').where({ email }).del();
  log('  cleaned up test user + sandbox subscription');

  log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  await db.destroy();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
