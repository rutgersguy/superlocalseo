/**
 * Regression test for issue #177.
 *
 * `register()` used to `await createCustomer(...)` unguarded, so a Stripe outage
 * or a rejected key returned 500 and NOBODY could sign up. It failed before the
 * user row was written, so there was nothing to recover afterwards either.
 *
 * This is not hypothetical — it is exactly what happened when the isolated test
 * stack (#159) was given a placeholder Stripe key: every spec failed, because
 * every spec registers a user.
 *
 * The customer is now created lazily at checkout, which is the only place it is
 * needed (trials run 7 days with no card). These tests assert that signup no
 * longer depends on Stripe being reachable at all.
 */
import request from 'supertest';

// Every Stripe call rejects — the outage this test exists to survive.
jest.mock('../services/stripe.service', () => ({
  stripe: {},
  createCustomer: jest.fn().mockRejectedValue(new Error('Invalid API Key provided: sk_test_*******lder')),
  getOrCreateStripeCustomer: jest.fn().mockRejectedValue(new Error('Stripe is down')),
  createSubscription: jest.fn(),
  addLocationToSubscription: jest.fn(),
  removeLocationFromSubscription: jest.fn(),
  changeSubscriptionTier: jest.fn(),
  getBillingPortalUrl: jest.fn(),
  createCheckoutSession: jest.fn(),
  createSubscriptionIntent: jest.fn(),
  upgradeToProSubscription: jest.fn(),
  validatePromoCode: jest.fn(),
  handleWebhookEvent: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const app = (require('../app') as { default: any }).default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require('../db/connection') as { db: any };

// Unique per run, and deliberately NOT cleaned up in afterAll: the global
// setup.ts afterAll destroys the knex connection, and the ordering between the
// two is not guaranteed — a cleanup here races it and fails with "Unable to
// acquire a connection". The test database is disposable, so leaving the row is
// correct.
const email = `stripe-outage-${Date.now()}@example.test`;

describe('Signup does not depend on Stripe (#177)', () => {
  it('registers successfully while every Stripe call is failing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'TestPass123!', businessName: 'Stripe Outage Co' });

    // Before the fix this was 500 and no row was written.
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('persists the user and client, with no Stripe customer yet', async () => {
    const user = await db('users').where({ email }).first();
    expect(user).toBeTruthy();
    // Lazily created at checkout — absent at signup is the correct state now.
    expect(user.stripe_customer_id).toBeNull();

    const client = await db('clients').where({ user_id: user.id }).first();
    expect(client).toBeTruthy();
    expect(client.subscription_status).toBe('trialing');
  });

  it('lets that user log in — the account is fully usable', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'TestPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});
