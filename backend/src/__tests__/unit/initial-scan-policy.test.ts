import { INITIAL_STEPS, initialWaitingReason } from '../../services/initial_scan_policy';
const loc = { name: 'Trainer', address: '123 Main St', city: 'Tulsa', state: 'Oklahoma', website: 'https://example.com', lat: 0, lng: 0, product_line: 'pro', subscription_status: 'trialing' };
describe('automatic first scan eligibility', () => {
  test.each(INITIAL_STEPS)('%s is eligible for a complete active trial', step => expect(initialWaitingReason(step, loc, true, true)).toBeNull());
  test.each(INITIAL_STEPS)('%s waits for eligible billing', step => expect(initialWaitingReason(step, { ...loc, subscription_status: 'canceled' }, true, true)).toContain('active'));
  test.each(['rankings', 'citations', 'ai', 'map'] as const)('%s never buys placeless observations', step => expect(initialWaitingReason(step, { ...loc, city: '' }, true, true)).toContain('city'));
  test.each(['citations', 'map', 'audit'] as const)('%s observes the Lite gate', step => expect(initialWaitingReason(step, { ...loc, product_line: 'lite' }, true, true)).toContain('Pro'));
  it('does not scan an expired trial', () => expect(initialWaitingReason('ai', { ...loc, trial_ends_at: '2000-01-01' }, true, true)).toContain('ended'));
  it('waits for missing prerequisites without claiming a scan', () => {
    expect(initialWaitingReason('reviews', loc, true, false)).toContain('Connect');
    expect(initialWaitingReason('audit', { ...loc, website: '' }, true, true)).toContain('website');
    expect(initialWaitingReason('rankings', loc, false, true)).toContain('keyword');
    expect(initialWaitingReason('map', { ...loc, lat: null }, true, true)).toContain('coordinates');
    expect(initialWaitingReason('map', { ...loc, lat: 'NaN' }, true, true)).toContain('coordinates');
  });
});
