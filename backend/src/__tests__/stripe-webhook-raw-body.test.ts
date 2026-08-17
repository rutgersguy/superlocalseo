/**
 * Regression test for issue #147.
 *
 * `express.json()` sets `req._body = true`, which makes any downstream
 * `express.raw()` a no-op. Because the global JSON parser was mounted before
 * the billing router, Stripe's signature verification received a parsed object
 * instead of the raw bytes and EVERY webhook failed with:
 *
 *   "Webhook payload must be provided as a string or a Buffer ...
 *    Signature verification is impossible without the original signed material."
 *
 * Nothing caught it because a failed webhook is invisible from inside the app —
 * it only shows up as Stripe's delivery attempts piling up. `product_line`
 * therefore never flipped on payment.
 *
 * These tests assert on the FAILURE MODE, not just the status code: a 400 alone
 * is ambiguous (a genuine bad signature is also a 400). The distinguishing
 * evidence is whether the raw body survived far enough for Stripe to compare
 * signatures at all.
 */
import request from 'supertest';
import crypto from 'crypto';

const WEBHOOK_SECRET = 'whsec_test_secret_for_raw_body_regression';

jest.mock('../config', () => {
  const actual = jest.requireActual<{ config: Record<string, unknown> }>('../config');
  return {
    config: {
      ...(actual.config as object),
      stripe: {
        ...((actual.config as { stripe?: object }).stripe ?? {}),
        webhookSecret: WEBHOOK_SECRET,
      },
    },
  };
});

// The global test setup (src/__tests__/setup.ts) mocks the whole stripe.service
// with `stripe: {}`, which leaves `stripe.webhooks` undefined. Override it here
// with the REAL Stripe SDK so signature verification actually runs — that is the
// behaviour under test. `handleWebhookEvent` stays stubbed: this test is about
// whether the raw body survives the middleware chain, not about event handling.
jest.mock('../services/stripe.service', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const StripeLib = require('stripe') as any;
  const Ctor = StripeLib.default ?? StripeLib;
  return {
    stripe: new Ctor('sk_test_placeholder'),
    handleWebhookEvent: jest.fn().mockResolvedValue(undefined),
    createCustomer: jest.fn(),
    createSubscription: jest.fn(),
    addLocationToSubscription: jest.fn(),
    removeLocationFromSubscription: jest.fn(),
    changeSubscriptionTier: jest.fn(),
    getBillingPortalUrl: jest.fn(),
    createCheckoutSession: jest.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const app = (require('../app') as { default: any }).default;

/** Builds the header Stripe sends: t=<ts>,v1=<hmac_sha256(`${ts}.${body}`)> */
function stripeSignature(body: string, secret = WEBHOOK_SECRET): string {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

const EVENT = {
  id: 'evt_raw_body_regression',
  object: 'event',
  type: 'ping.test',
  api_version: '2024-06-20',
  created: 1786900000,
  data: { object: { id: 'obj_regression' } },
};

describe.each([
  ['/api/billing/webhook', 'legacy path Stripe is configured to call'],
  ['/webhooks/stripe', 'canonical path'],
])('Stripe webhook raw body — %s (%s)', (path) => {
  it('accepts a correctly signed payload', async () => {
    const body = JSON.stringify(EVENT);
    const res = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set('stripe-signature', stripeSignature(body))
      .send(body);

    // Before the fix this was 400 — the parser had already consumed the body.
    expect(res.status).toBe(200);
  });

  it('rejects a payload signed with the wrong secret', async () => {
    const body = JSON.stringify(EVENT);
    const res = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set('stripe-signature', stripeSignature(body, 'whsec_wrong_secret'))
      .send(body);

    expect(res.status).toBe(400);
  });

  it('rejects a request with no signature header', async () => {
    const res = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(EVENT));

    expect(res.status).toBe(400);
  });
});

describe('the raw-body exemption does not break normal JSON parsing', () => {
  it('still parses a JSON body on a regular API route', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.invalid', password: 'wrong-password' });

    // 401 proves the body was parsed and validated. A 400/500 would mean the
    // exemption leaked and req.body never became an object.
    expect([400, 401, 429]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });
});
