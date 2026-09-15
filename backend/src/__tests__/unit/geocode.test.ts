import { geocodeAddress, geocodeCandidates, streetWithoutUnit, verifiedGeocode } from '../../services/geocode.service';
const input = { address: '9524 E81 St STE B-1502', city: 'Tulsa', state: 'Oklahoma', zip: '74133' };
const candidate = { lat: '36.047', lon: '-95.870', address: { house_number: '9524', road: 'East 81st Street', city: 'Tulsa', state: 'Oklahoma', 'ISO3166-2-lvl4': 'US-OK', postcode: '74133-1000', country_code: 'us' } };
describe('verified address geocoding', () => {
  it('normalizes suite/ordinal notation only for search and keeps complete address first', () => {
    expect(streetWithoutUnit(input.address)).toBe('9524 E 81st St');
    const urls = geocodeCandidates(input).map(value => new URL(value));
    expect(urls).toHaveLength(3); expect(urls[0].searchParams.get('q')).toContain(input.address);
    expect(urls[2].searchParams.get('street')).toBe('9524 E 81st St');
    expect(urls.every(url => url.searchParams.get('addressdetails') === '1')).toBe(true);
  });
  it('accepts matched street-level coordinates and alternate state notation', () => {
    expect(verifiedGeocode(candidate, input)).toEqual({ lat: 36.047, lng: -95.870 });
    expect(verifiedGeocode(candidate, { ...input, state: 'OK' })).not.toBeNull();
  });
  test.each([
    { house_number: '' }, { house_number: '9525' }, { road: 'East 91st Street' }, { road: 'East 81st Avenue' }, { city: 'Broken Arrow' },
    { state: 'Texas', 'ISO3166-2-lvl4': 'US-TX' }, { postcode: '74134' }, { country_code: 'ca' },
  ])('rejects ambiguous/mismatching address evidence %j', mismatch => expect(verifiedGeocode({ ...candidate, address: { ...candidate.address, ...mismatch } }, input)).toBeNull());
  it('rejects city centers and invalid coordinates', () => {
    expect(verifiedGeocode({ lat: '36', lon: '-96', address: { city: 'Tulsa' } }, input)).toBeNull();
    expect(verifiedGeocode({ ...candidate, lat: 'NaN' }, input)).toBeNull();
    expect(verifiedGeocode({ ...candidate, lat: '200' }, input)).toBeNull();
  });
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
  it('tries bounded fallbacks after empty original query, respecting service spacing', async () => {
    jest.useFakeTimers();
    const starts: number[] = [];
    global.fetch = jest.fn().mockImplementation(async () => { starts.push(Date.now()); return { ok: true, json: async () => starts.length === 3 ? [candidate] : [] }; });
    const result = geocodeAddress(input.address, input.city, input.state, input.zip);
    await jest.runAllTimersAsync();
    expect(await result).toEqual({ lat: 36.047, lng: -95.870 });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000); expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
  });
  it('does not issue a city-only query for missing street details', async () => {
    global.fetch = jest.fn();
    expect(await geocodeAddress(null, 'Tulsa', 'OK', '74133')).toBeNull(); expect(global.fetch).not.toHaveBeenCalled();
  });
});

import { config } from '../../config';
import { googleAddressFallback } from '../../services/geocode.service';
describe('Google Places address fallback', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { jest.replaceProperty(config, 'googlePlacesApiKey', 'fixture'); });
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
  const details = (zip = '74133') => ({ status: 'OK', result: { types: ['premise'], geometry: { location: { lat: 36.0459669, lng: -95.8696521 } }, address_components: [
    ['street_number', '9524', '9524'], ['route', 'East 81st Street', 'E 81st St'], ['locality', 'Tulsa', 'Tulsa'], ['administrative_area_level_1', 'Oklahoma', 'OK'], ['postal_code', zip, zip], ['country', 'United States', 'US'],
  ].map(([type, long_name, short_name]) => ({ types: [type], long_name, short_name })) } });
  it('uses two bounded requests and returns coordinates without substituting a business Place ID', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'OK', results: [{ place_id: 'address-only', types: ['premise'] }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => details() });
    expect(await googleAddressFallback(input)).toEqual({ lat: 36.0459669, lng: -95.8696521 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('9524+E+81st+St');
  });
  it('rejects a different address postcode', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'OK', results: [{ place_id: 'address-only', types: ['street_address'] }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => details('74134') });
    expect(await googleAddressFallback(input)).toBeNull();
  });
  it('does not select a business or choose between multiple search results', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'OK', results: [{ place_id: 'business', types: ['establishment'] }] }) });
    expect(await googleAddressFallback(input)).toBeNull(); expect(global.fetch).toHaveBeenCalledTimes(1);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'OK', results: [{ place_id: 'a', types: ['premise'] }, { place_id: 'b', types: ['premise'] }] }) });
    expect(await googleAddressFallback(input)).toBeNull(); expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
