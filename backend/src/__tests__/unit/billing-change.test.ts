jest.mock('../../db/connection', () => ({ db: jest.fn() }));
jest.mock('../../services/stripe.service', () => ({ stripe: {}, syncPaidSubscription: jest.fn() }));
import { changeItems, subscriptionFingerprint } from '../../services/billing-change.service';
import { config } from '../../config';
import Stripe from 'stripe';
const sub = (items: any[], more = {}) => ({ items: { data: items }, current_period_end: 1800000000, cancel_at_period_end: false, discounts: [], ...more } as unknown as Stripe.Subscription);
beforeAll(() => { Object.assign(config.stripe.prices, { liteBase: 'price_lite', base: 'price_pro', location: 'price_extra' }); });
it('upgrades the existing Lite item rather than creating another base item', () => {
  expect(changeItems(sub([{ id: 'si_base', price: { id: 'price_lite' }, quantity: 1 }]), 'upgrade')).toEqual([{ id: 'si_base', price: 'price_pro', quantity: 1 }]);
});
it('adds exactly one to the existing extra-location item', () => {
  expect(changeItems(sub([{ id: 'si_base', price: { id: 'price_pro' }, quantity: 1 }, { id: 'si_extra', price: { id: 'price_extra' }, quantity: 2 }]), 'add_location')).toEqual([{ id: 'si_extra', price: 'price_extra', quantity: 3 }]);
});
it('requires Pro before adding a location', () => {
  expect(() => changeItems(sub([{ id: 'si_base', price: { id: 'price_lite' } }]), 'add_location')).toThrow('Upgrade to Pro');
});
it('rejects a repeated upgrade', () => {
  expect(() => changeItems(sub([{ id: 'si_base', price: { id: 'price_pro' } }]), 'upgrade')).toThrow('already on Pro');
});
it('invalidates a quote after a quantity, discount, cancellation or billing-period change', () => {
  const items = [{ id: 'si_base', price: { id: 'price_pro' }, quantity: 1 }];
  const initial = subscriptionFingerprint(sub(items));
  for (const changed of [sub([{ ...items[0], quantity: 2 }]), sub(items, { discounts: ['di_new'] }), sub(items, { cancel_at_period_end: true }), sub(items, { current_period_end: 1800001000 })]) {
    expect(subscriptionFingerprint(changed)).not.toBe(initial);
  }
  expect(subscriptionFingerprint(sub(items, { default_payment_method: 'pm_saved' }))).toBe(initial);
});
