import { catalog, recurringAmount, priceLookup } from '../../config/plans';
import { subscriptionDetails } from '../../services/stripe-catalog';
import Stripe from 'stripe';
it('annual base plans and add-ons charge ten months for twelve months of service', () => {
  for (const p of Object.values(catalog.plans)) {
    expect(p.annual).toBe(p.monthly * 10);
    expect(p.extraAnnual).toBe(p.extraMonthly * 10);
  }
  expect(recurringAmount('multi', 'year', 2)).toBe(517000);
  expect(priceLookup('pro', 'year', true)).not.toBe(priceLookup('pro', 'month', true));
});
it('reconciles Multi included locations and annual interval from actual price items', () => {
  const sub = { metadata: { plan: 'starter' }, items: { data: [
    { id: 'base', quantity: 1, price: { id: 'price_base', recurring: { interval: 'year' }, metadata: { catalogVersion: catalog.version, kind: 'base', plan: 'multi' } } },
    { id: 'addon', quantity: 2, price: { metadata: { catalogVersion: catalog.version, kind: 'location', plan: 'multi' } } },
  ] } } as unknown as Stripe.Subscription;
  expect(subscriptionDetails(sub)).toMatchObject({ plan: 'multi', interval: 'year', extra: 2, capacity: 5 });
});
it('does not reinterpret legacy price items from subscription metadata', () => {
  expect(subscriptionDetails({ metadata: { plan: 'multi' }, items: { data: [{ price: { id: 'old_price', metadata: {} } }] } } as unknown as Stripe.Subscription)).toBeNull();
});
