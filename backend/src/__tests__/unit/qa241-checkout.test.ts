jest.mock('../../services/stripe.service', () => ({ stripe: { invoices: { createPreview: jest.fn().mockResolvedValue({ amount_due: 0, currency: 'usd' }) }, promotionCodes: { list: jest.fn(), retrieve: jest.fn() } } }));
jest.mock('../../services/stripe-catalog', () => ({ catalogPrice: jest.fn().mockResolvedValue({ id: 'price_qa' }) }));
import { checkoutSelection, previewCheckout, signCheckoutPreview, verifyCheckoutPreview, resolvePromotion } from '../../services/checkout-preview';
import { stripe } from '../../services/stripe.service';
import { completeGrid } from '../../services/grid-observations';
it('binds the reviewed total to the customer and exact plan, interval and promo', () => {
  const selection = checkoutSelection({ plan: 'pro', interval: 'year' });
  const token = signCheckoutPreview('u1', selection, 0);
  expect(verifyCheckoutPreview(token, 'u1', selection)).toBe(0);
  expect(() => verifyCheckoutPreview(token, 'u2', selection)).toThrow('Review');
  expect(() => verifyCheckoutPreview(token, 'u1', { ...selection, plan: 'multi' })).toThrow('Review');
  expect(() => verifyCheckoutPreview(token + 'x', 'u1', selection)).toThrow('Review');
});
it('previews without inheriting a stale customer discount', async () => {
  await previewCheckout('cus_qa', checkoutSelection({ plan: 'pro' }));
  expect(stripe.invoices.createPreview).toHaveBeenCalledWith(expect.objectContaining({ discounts: [] }));
});
it('normalizes promo input and rejects exhausted coupons', async () => {
  (stripe.promotionCodes.list as jest.Mock).mockResolvedValue({ data: [{ id: 'p', coupon: { valid: true }, max_redemptions: 1, times_redeemed: 1 }] });
  await expect(resolvePromotion(' mixedCase ')).rejects.toThrow('ineligible');
  expect(stripe.promotionCodes.list).toHaveBeenCalledWith(expect.objectContaining({ code: 'MIXEDCASE' }));
});
it('keeps all 169 coordinates when providers omit points; unknown is not not-ranked', () => {
  const points = completeGrid([{ gridRow: 0, gridCol: 0, lat: 36, lng: -96, rank: 1, url: null }], 13, 36, -96);
  expect(points).toHaveLength(169);
  expect(points.filter(p => p.observationStatus === 'unverified')).toHaveLength(168);
  expect(points.filter(p => p.rank === 1)).toHaveLength(1);
});
