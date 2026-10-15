jest.mock('../../services/stripe.service', () => ({ stripe: {
  customers: { retrieve: jest.fn() }, invoices: { list: jest.fn(), createPreview: jest.fn() },
  subscriptions: { list: jest.fn() }, paymentIntents: { list: jest.fn() }, promotionCodes: { list: jest.fn(), retrieve: jest.fn() },
} }));
jest.mock('../../services/stripe-catalog', () => ({ catalogPrice: jest.fn().mockResolvedValue({ id: 'price_pro' }) }));
import { stripe } from '../../services/stripe.service';
import { assertPromotionEligible, previewCheckout, previewRenewal } from '../../services/checkout-preview';
import { gridRequests, gridCoverage, GRID_CONCURRENCY } from '../../services/grid-runner';
import { matchingBusiness } from '../../services/location-place';
const p = { id: 'promo_once', active: true, coupon: { id: 'coupon_once', valid: true, duration: 'once', percent_off: 100 }, restrictions: { first_time_transaction: false } } as any;
beforeEach(() => {
  jest.clearAllMocks();
  (stripe.customers.retrieve as jest.Mock).mockResolvedValue({ id: 'cus_1', discount: null });
  (stripe.invoices.list as jest.Mock).mockResolvedValue({ data: [], has_more: false });
  (stripe.invoices.createPreview as jest.Mock).mockResolvedValue({ amount_due: 0, total: 19900, currency: 'usd' });
  (stripe.subscriptions.list as jest.Mock).mockResolvedValue({ data: [] });
  (stripe.paymentIntents.list as jest.Mock).mockResolvedValue({ data: [] });
});
it('rejects reuse after the once discount has disappeared from the subscription', async () => {
  (stripe.invoices.list as jest.Mock).mockResolvedValue({ data: [{ id: 'in_1', status: 'paid', discounts: [{ promotion_code: p.id }] }], has_more: false });
  await expect(assertPromotionEligible(p, 'cus_1')).rejects.toThrow('already redeemed');
});
it('checks older pages and rejects a directly supplied promotion ID at checkout', async () => {
  (stripe.promotionCodes.retrieve as jest.Mock).mockResolvedValue(p);
  (stripe.invoices.list as jest.Mock).mockResolvedValueOnce({ data: [{ id: 'in_new', status: 'paid', discounts: [] }], has_more: true }).mockResolvedValueOnce({ data: [{ status: 'paid', discount: { promotion_code: p.id } }], has_more: false });
  await expect(previewCheckout('cus_1', { plan: 'pro', interval: 'month', extraLocations: 0, promotionCodeId: p.id })).rejects.toThrow('already redeemed');
  expect(stripe.invoices.list).toHaveBeenLastCalledWith(expect.objectContaining({ starting_after: 'in_new' }));
  expect(stripe.invoices.createPreview).not.toHaveBeenCalled();
});
it('enforces first transaction restriction even for a different unused code', async () => {
  (stripe.subscriptions.list as jest.Mock).mockResolvedValue({ data: [{ id: 'sub_previous' }] });
  await expect(assertPromotionEligible({ ...p, restrictions: { first_time_transaction: true } }, 'cus_1')).rejects.toThrow('first transaction');
});
it('permits an unused eligible code and ignores unfinalized drafts', async () => {
  (stripe.invoices.list as jest.Mock).mockResolvedValue({ data: [{ status: 'draft', discounts: [{ promotion_code: p.id }] }], has_more: false });
  await expect(assertPromotionEligible(p, 'cus_1')).resolves.toBeUndefined();
});
it('prices ongoing renewals with Stripe but excludes once and expired repeating coupons', async () => {
  const items = [{ price: 'price_pro', quantity: 1 }];
  const forever = { ...p.coupon, id: 'forever', duration: 'forever' };
  const r = await previewRenewal('cus_1', items, [{ coupon: forever }, { coupon: p.coupon }, { coupon: { ...p.coupon, duration: 'repeating', duration_in_months: 3 } }], 'year');
  expect(stripe.invoices.createPreview).toHaveBeenLastCalledWith(expect.objectContaining({ discounts: [{ coupon: 'forever' }] }));
  expect(r.renewalAmount).toBe(19900);
});
it('bounds requests across simultaneous maps and preserves per-point failures', async () => {
  let active=0, peak=0;
  const fn=async (i:number)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;if(i===3)throw new Error('provider');return i;};
  const all=await Promise.all([gridRequests(Array.from({length:30},(_,i)=>i),fn), gridRequests(Array.from({length:30},(_,i)=>i),fn)]);
  expect(peak).toBeLessThanOrEqual(GRID_CONCURRENCY);expect(all.flat().filter(r=>r.status==='rejected')).toHaveLength(2);
});
it('rejects the reported 69-of-169 map as insufficient coverage', () => {
  const points=Array.from({length:169},(_,i)=>({observationStatus:i<69?'observed':'unverified'}));
  expect(gridCoverage(points)).toEqual({verified:69,total:169,sufficient:false});
});
const location={name:'Aire Serv',address:'123 Main St',city:'Tulsa',state:'OK',zip:'74103'};
const candidate={id:'ChIJverified',displayName:{text:'Aire Serv'},types:['establishment'],location:{latitude:36,longitude:-96},addressComponents:[
  ['street_number','123','123'],['route','Main Street','Main St'],['locality','Tulsa','Tulsa'],['administrative_area_level_1','Oklahoma','OK'],['postal_code','74103','74103'],['country','United States','US'],
].map(([type,longText,shortText])=>({types:[type],longText,shortText}))};
it('selects a verified business at the exact address',()=>expect(matchingBusiness(location,[candidate])).toBe('ChIJverified'));
it('refuses ambiguous businesses, wrong addresses, and address-only places',()=>{
 expect(matchingBusiness(location,[candidate,{...candidate,id:'ChIJother'}])).toBeNull();
 expect(matchingBusiness({...location,address:'456 Main St'},[candidate])).toBeNull();
 expect(matchingBusiness(location,[{...candidate,types:['street_address']}])).toBeNull();
 expect(matchingBusiness({...location,name:'Another Company'},[candidate])).toBeNull();
});
