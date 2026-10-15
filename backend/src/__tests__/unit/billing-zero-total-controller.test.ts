const mockIntent = jest.fn();
const mockUpdate = jest.fn().mockResolvedValue(1);
const mockClient = { id: 'client_qa', user_id: 'user_qa', stripe_subscription_id: null, pending_checkout: null as any };
const mockDb = jest.fn((table: string) => {
  const query = { where: jest.fn(), forUpdate: jest.fn(), first: jest.fn(), update: mockUpdate, count: jest.fn() };
  query.where.mockReturnValue(query);
  query.forUpdate.mockReturnValue(query);
  query.count.mockReturnValue(query);
  query.first.mockResolvedValue(table === 'locations' ? { n: 0 } : table === 'users' ? { id: 'user_qa', email: 'qa@example.invalid' } : mockClient);
  return query;
});
jest.mock('../../db/connection', () => ({ db: Object.assign(mockDb, { transaction: (fn: Function) => fn(mockDb) }) }));
jest.mock('../../services/stripe.service', () => ({
  stripe: {}, getOrCreateStripeCustomer: jest.fn().mockResolvedValue('cus_qa'),
  createSubscriptionIntent: mockIntent,
}));
import { subscriptionIntent } from '../../controllers/billing.controller';
import { Request, Response } from 'express';
beforeEach(() => { jest.clearAllMocks(); mockClient.pending_checkout = null; mockUpdate.mockImplementation(async (update: any) => { if ('pending_checkout' in update) mockClient.pending_checkout = typeof update.pending_checkout === 'string' ? JSON.parse(update.pending_checkout) : update.pending_checkout; return 1; }); });

it.each(['starter', 'pro', 'multi'])('saves verified %s zero-dollar activation before returning success', async plan => {
  mockIntent.mockResolvedValue({ clientSecret: null, subscriptionId: 'sub_qa', paymentRequired: false, currentPeriodEnd: 1800000000 });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await subscriptionIntent({ body: { plan, extraLocations: plan === 'starter' ? 0 : 2, promotionCodeId: 'promo_qa' }, userId: 'user_qa' } as Request, res as unknown as Response, next);
  expect(next).not.toHaveBeenCalled();
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    stripe_subscription_id: 'sub_qa', subscription_status: 'active', product_line: plan === 'starter' ? 'lite' : 'pro',
    locations_limit: plan === 'starter' ? 1 : plan === 'multi' ? 5 : 3, payment_failed_at: null,
    subscription_current_period_end: new Date(1800000000000),
  }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({success: true, data: expect.objectContaining({ clientSecret: null, paymentRequired: false })}));
});
it('does not grant active access before a nonzero invoice is paid', async () => {
  mockIntent.mockResolvedValue({ clientSecret: 'pi_secret', subscriptionId: 'sub_qa', paymentRequired: true, currentPeriodEnd: 1800000000 });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await subscriptionIntent({ body: { plan: 'pro' }, userId: 'user_qa' } as Request, res as unknown as Response, jest.fn());
  expect(mockUpdate).toHaveBeenCalledWith({ stripe_subscription_id: 'sub_qa', pending_checkout: null, updated_at: expect.any(Date) });
});

it('retains one idempotency key after an ambiguous Stripe response', async () => {
  mockIntent.mockRejectedValueOnce(new Error('Connection lost after create'));
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const req = { body: { plan: 'pro', interval: 'year' }, userId: 'user_qa' } as Request;
  const next = jest.fn();
  await subscriptionIntent(req, res as unknown as Response, next);
  expect(next).toHaveBeenCalled();
  const key = mockIntent.mock.calls[0][6];
  expect(key).toMatch(/^checkout-/);
  mockIntent.mockResolvedValueOnce({ clientSecret: null, subscriptionId: 'sub_qa', paymentRequired: false, currentPeriodEnd: 1800000000 });
  await subscriptionIntent(req, res as unknown as Response, jest.fn());
  expect(mockIntent.mock.calls[1][6]).toBe(key);
  expect(mockClient.pending_checkout).toBeNull();
});
