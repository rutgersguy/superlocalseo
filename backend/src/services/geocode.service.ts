import { config } from '../config';
import { logger } from '../utils/logger';

export interface GeocodeResult { lat: number; lng: number }
type AddressInput = { address: string; city: string; state: string; zip: string };
type Candidate = { lat?: string; lon?: string; address?: Record<string, string> };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Search normalization only: the customer's canonical NAP is never rewritten. */
export function streetWithoutUnit(value: string): string {
  return value.replace(/\s*(?:\b(?:suite|ste|unit|apt|apartment|floor|fl)\b|#).*$/i, '').trim()
    .replace(/\b([NSEW])(?=\d)/gi, '$1 ').replace(/\b(\d+)\s+(st|nd|rd|th)$/gi, (_match, number: string, suffix: string) => `${number}${suffix.toLowerCase()} St`);
}
function streetKey(value: string): string {
  return value.toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/^\s*\d+[a-z]?\s+/, '')
    .replace(/\b(\d+)\s*(?:st|nd|rd|th)\b/g, '$1')
    .replace(/\b(st|ave|rd|dr|blvd|ln|ct|pl|ter)\b/g, type => ({ st: 'street', ave: 'avenue', rd: 'road', dr: 'drive', blvd: 'boulevard', ln: 'lane', ct: 'court', pl: 'place', ter: 'terrace' }[type] ?? type))
    .replace(/\beast\b/g, 'e').replace(/\bwest\b/g, 'w').replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's').replace(/[^a-z0-9]/g, '');
}
export function geocodeCandidates(input: AddressInput): string[] {
  const common = { format: 'jsonv2', addressdetails: '1', limit: '3', countrycodes: 'us' };
  const full = new URLSearchParams({ ...common, q: [input.address, input.city, input.state, input.zip, 'USA'].filter(Boolean).join(', ') });
  const structured = (street: string) => new URLSearchParams({ ...common, street, city: input.city, state: input.state, postalcode: input.zip, country: 'USA' });
  return [...new Set([full.toString(), structured(input.address).toString(), structured(streetWithoutUnit(input.address)).toString()])]
    .map(params => `https://nominatim.openstreetmap.org/search?${params}`);
}

/** An address-level match is required. A city/street centroid is not a business coordinate. */
export function verifiedGeocode(candidate: Candidate, input: AddressInput): GeocodeResult | null {
  const a = candidate.address;
  const expectedNumber = input.address.match(/^\s*(\d+[a-z]?)\b/i)?.[1];
  const lat = Number(candidate.lat), lng = Number(candidate.lon);
  if (!a || !expectedNumber || candidate.lat == null || candidate.lon == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (a.country_code?.toLowerCase() !== 'us' || normalize(a.house_number ?? '') !== normalize(expectedNumber)) return null;
  const road = a.road ?? a.pedestrian ?? a.residential ?? '';
  if (!road || streetKey(road) !== streetKey(streetWithoutUnit(input.address))) return null;
  const cities = [a.city, a.town, a.village, a.municipality].filter(Boolean);
  if (input.city && !cities.some(city => normalize(city) === normalize(input.city))) return null;
  const stateCode = a['ISO3166-2-lvl4']?.replace(/^US-/i, '');
  if (input.state && ![a.state, stateCode].filter(Boolean).some(state => normalize(state) === normalize(input.state))) return null;
  if (input.zip && (a.postcode ?? '').slice(0, 5) !== input.zip.slice(0, 5)) return null;
  return { lat, lng };
}

// One request at a time, with at least one second between starts per API process.
let previousRequest = Promise.resolve();
let lastStartedAt = 0;
async function nominatimRequest(url: string): Promise<Response> {
  const request = previousRequest.then(async () => {
    const delay = Math.max(0, 1000 - (Date.now() - lastStartedAt));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastStartedAt = Date.now();
    return fetch(url, { headers: { 'User-Agent': 'SuperLocalSEO/1.0 (superlocalseo.com)' }, signal: AbortSignal.timeout(8000) });
  });
  previousRequest = request.then(() => undefined, () => undefined);
  return request;
}

export async function geocodeAddress(address?: string | null, city?: string | null, state?: string | null, zip?: string | null): Promise<GeocodeResult | null> {
  const input = { address: address?.trim() ?? '', city: city?.trim() ?? '', state: state?.trim() ?? '', zip: zip?.trim() ?? '' };
  if (!input.address || !input.city || !input.state || !/^\d+[a-z]?\b/i.test(input.address)) return null;
  for (const url of geocodeCandidates(input)) {
    try {
      const response = await nominatimRequest(url);
      // Stop on an outage/rate limit rather than multiplying calls to the same unavailable service.
      if (!response.ok) { logger.warn('Geocode provider unavailable', { status: response.status }); break; }
      const candidates = await response.json() as Candidate[];
      if (!Array.isArray(candidates)) break;
      for (const candidate of candidates) {
        const match = verifiedGeocode(candidate, input);
        if (match) return match;
      }
    } catch (e) { logger.warn('Geocode unavailable', { error: (e as Error).message }); break; }
  }
  const fallback = await googleAddressFallback(input);
  if (fallback) return fallback;
  logger.info('No verified address coordinates found', { city: input.city, state: input.state });
  return null;
}

/** Existing Places API only; Geocoding API access is a separate permission. */
export async function googleAddressFallback(input: AddressInput): Promise<GeocodeResult | null> {
  const key = config.googlePlacesApiKey;
  if (!key) return null;
  try {
    const search = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    search.searchParams.set('query', [streetWithoutUnit(input.address), input.city, input.state, input.zip, 'USA'].filter(Boolean).join(' '));
    search.searchParams.set('key', key); search.searchParams.set('region', 'us');
    const searchResponse = await fetch(search, { signal: AbortSignal.timeout(8000) });
    if (!searchResponse.ok) return null;
    const found = await searchResponse.json() as { status?: string; results?: Array<{ place_id?: string; types?: string[] }> };
    // More than one result is ambiguous. Do not choose the highest-ranked business.
    if (found.status !== 'OK' || found.results?.length !== 1) return null;
    const result = found.results[0];
    if (!result.place_id || !result.types?.some(type => ['street_address', 'premise', 'subpremise'].includes(type))) return null;
    const details = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    details.searchParams.set('place_id', result.place_id); details.searchParams.set('fields', 'address_components,geometry,types'); details.searchParams.set('key', key);
    const detailsResponse = await fetch(details, { signal: AbortSignal.timeout(8000) });
    if (!detailsResponse.ok) return null;
    const body = await detailsResponse.json() as { status?: string; result?: { address_components?: Array<{ long_name: string; short_name: string; types: string[] }>; geometry?: { location?: { lat: number; lng: number } }; types?: string[] } };
    if (body.status !== 'OK' || !body.result?.types?.some(type => ['street_address', 'premise', 'subpremise'].includes(type))) return null;
    const components = body.result.address_components;
    if (!Array.isArray(components)) return null;
    const component = (type: string, short = false) => { const found = components.find(c => c.types?.includes(type)); return (short ? found?.short_name : found?.long_name) ?? ''; };
    const point = body.result.geometry?.location;
    // Address coordinates are not evidence of a business identity. Never save this place_id.
    return verifiedGeocode({ lat: point?.lat == null ? undefined : String(point.lat), lon: point?.lng == null ? undefined : String(point.lng), address: {
      house_number: component('street_number'), road: component('route'), city: component('locality') || component('postal_town'),
      state: component('administrative_area_level_1'), 'ISO3166-2-lvl4': `US-${component('administrative_area_level_1', true)}`,
      postcode: component('postal_code'), country_code: component('country', true).toLowerCase(),
    } }, input);
  } catch { logger.warn('Google address lookup unavailable'); return null; }
}
