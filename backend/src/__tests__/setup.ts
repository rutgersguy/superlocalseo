import { db } from '../db/connection';
import { redis } from '../db/redis';

// Mock Stripe so tests don't hit the live API
jest.mock('../services/stripe.service', () => ({
  stripe: {},
  createCustomer: jest.fn().mockResolvedValue('cus_test_mock'),
  createSubscription: jest.fn().mockResolvedValue({ id: 'sub_test_mock', status: 'trialing' }),
  addLocationToSubscription: jest.fn().mockResolvedValue(undefined),
  removeLocationFromSubscription: jest.fn().mockResolvedValue(undefined),
  changeSubscriptionTier: jest.fn().mockResolvedValue(undefined),
  getBillingPortalUrl: jest.fn().mockResolvedValue('https://billing.stripe.com/test'),
  createCheckoutSession: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
  handleWebhookEvent: jest.fn().mockResolvedValue(undefined),
}));

beforeAll(async () => {
  await db.migrate.latest();
});

afterAll(async () => {
  await db.destroy();
  redis.disconnect();
});
