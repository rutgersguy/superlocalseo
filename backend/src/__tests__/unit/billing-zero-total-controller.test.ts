const mockIntent = jest.fn();
const mockUpdate = jest.fn().mockResolvedValue(1);
const mockClient = { id: 'client_qa', user_id: 'user_qa', stripe_subscription_id: null };
const mockDb = jest.fn((table: string) => {
  const query = { where: jest.fn(), forUpdate: jest.fn(), first: jest.fn(), update: mockUpdate };
  query.where.mockReturnValue(query);
  query.forUpdate.mockReturnValue(query);
  query.first.mockResolvedValue(table === 'users' ? { id: 'user_qa', email: 'qa@example.invalid' } : mockClient);
  return query;
});
jest.mock('../../db/connection', () => ({ db: Object.assign(mockDb, { transaction: (fn: Function) => fn(mockDb) }) }));
jest.mock('../../services/stripe.service', () => ({
  stripe: {}, getOrCreateStripeCustomer: jest.fn().mockResolvedValue('cus_qa'),
  createSubscriptionIntent: mockIntent,
}));
import { subscriptionIntent } from '../../controllers/billing.controller';
import { Request, Response } from 'express';
beforeEach(() => jest.clearAllMocks());

it.each(['lite', 'pro'])('saves verified %s zero-dollar activation before returning success', async plan => {
  mockIntent.mockResolvedValue({ clientSecret: null, subscriptionId: 'sub_qa', paymentRequired: false, currentPeriodEnd: 1800000000 });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await subscriptionIntent({ body: { plan, extraLocations: 2, promotionCodeId: 'promo_qa' }, userId: 'user_qa' } as Request, res as unknown as Response, next);
  expect(next).not.toHaveBeenCalled();
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    stripe_subscription_id: 'sub_qa', subscription_status: 'active', product_line: plan,
    locations_limit: plan === 'lite' ? 1 : 3, payment_failed_at: null,
    subscription_current_period_end: new Date(1800000000000),
  }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({success: true, data: expect.objectContaining({ clientSecret: null, paymentRequired: false })}));
});
it('does not grant active access before a nonzero invoice is paid', async () => {
  mockIntent.mockResolvedValue({ clientSecret: 'pi_secret', subscriptionId: 'sub_qa', paymentRequired: true, currentPeriodEnd: 1800000000 });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await subscriptionIntent({ body: { plan: 'pro' }, userId: 'user_qa' } as Request, res as unknown as Response, jest.fn());
  expect(mockUpdate).toHaveBeenCalledWith({ stripe_subscription_id: 'sub_qa', updated_at: expect.any(Date) });
});
