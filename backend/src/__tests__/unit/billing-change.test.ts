jest.mock('../../db/connection', () => ({ db: jest.fn() }));
jest.mock('../../services/stripe.service', () => ({ stripe: {}, syncPaidSubscription: jest.fn() }));
import { subscriptionFingerprint } from '../../services/billing-change.service';
import { config } from '../../config';
import Stripe from 'stripe';
const sub = (items: any[], more = {}) => ({ items: { data: items }, current_period_end: 1800000000, cancel_at_period_end: false, discounts: [], ...more } as unknown as Stripe.Subscription);
beforeAll(() => { Object.assign(config.stripe.prices, { liteBase: 'price_lite', base: 'price_pro', location: 'price_extra' }); });
it('invalidates a quote after a quantity, discount, cancellation or billing-period change', () => {
  const items = [{ id: 'si_base', price: { id: 'price_pro' }, quantity: 1 }];
  const initial = subscriptionFingerprint(sub(items));
  for (const changed of [sub([{ ...items[0], quantity: 2 }]), sub(items, { discounts: ['di_new'] }), sub(items, { cancel_at_period_end: true }), sub(items, { current_period_end: 1800001000 })]) {
    expect(subscriptionFingerprint(changed)).not.toBe(initial);
  }
  expect(subscriptionFingerprint(sub(items, { default_payment_method: 'pm_saved' }))).toBe(initial);
});
