import { db } from '../db/connection';
import { config } from '../config';
import { verifiedGeocode } from './geocode.service';
import { logger } from '../utils/logger';

type Location = { id?: string; name: string; business_name?: string; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; phone?: string | null; website?: string | null };
type Place = { id?: string; displayName?: { text: string }; nationalPhoneNumber?: string; websiteUri?: string; types?: string[]; location?: { latitude: number; longitude: number }; addressComponents?: Array<{ longText: string; shortText: string; types: string[] }> };
const normalize = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const phone = (s?: string | null) => (s ?? '').replace(/\D/g, '').slice(-10);
const domain = (s?: string | null) => { try { return new URL(s ?? '').hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
export function matchingBusiness(location: Location, places: Place[]): string | null {
  const matches = places.filter(p => {
    if (!p.id || !p.location || !p.types?.some(t => t === 'establishment' || t === 'point_of_interest')) return false;
    const components = p.addressComponents ?? [];
    const part = (type: string, short = false) => { const c = components.find(c => c.types.includes(type)); return (short ? c?.shortText : c?.longText) ?? ''; };
    const address = verifiedGeocode({ lat: String(p.location?.latitude ?? ''), lon: String(p.location?.longitude ?? ''), address: {
      house_number: part('street_number'), road: part('route'), city: part('locality') || part('postal_town'), state: part('administrative_area_level_1'),
      'ISO3166-2-lvl4': `US-${part('administrative_area_level_1', true)}`, postcode: part('postal_code'), country_code: part('country', true).toLowerCase(),
    } }, { address: location.address ?? '', city: location.city ?? '', state: location.state ?? '', zip: location.zip ?? '' });
    if (!address) return false;
    const name = normalize(p.displayName?.text);
    const sameName = name.length >= 5 && [location.name, location.business_name].some(n => normalize(n) === name);
    const samePhone = phone(location.phone).length === 10 && phone(location.phone) === phone(p.nationalPhoneNumber);
    const sameWebsite = !!domain(location.website) && domain(location.website) === domain(p.websiteUri);
    return sameName || samePhone || sameWebsite;
  });
  const ids = [...new Set(matches.map(p => p.id!))];
  return ids.length === 1 ? ids[0] : null;
}

export async function resolveLocationPlace(locationId: string): Promise<string | null> {
  const location = await db('active_locations as locations').join('clients', 'clients.id', 'locations.client_id')
    .where('locations.id', locationId).select('locations.*', 'clients.business_name').first();
  if (!location || location.google_place_id || !config.googlePlacesApiKey || !location.address || !location.city || !location.state) return location?.google_place_id ?? null;
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googlePlacesApiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.addressComponents,places.location,places.types,places.nationalPhoneNumber,places.websiteUri' },
      body: JSON.stringify({ textQuery: [location.business_name || location.name, location.address, location.city, location.state, location.zip].filter(Boolean).join(' '), regionCode: 'US' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) { logger.warn('Business identity lookup unavailable', { locationId, status: response.status }); return null; }
    const body = await response.json() as { places?: Place[] };
    const placeId = matchingBusiness(location, body.places ?? []);
    if (!placeId) { logger.info('Business identity needs manual confirmation', { locationId }); return null; }
    // Do not overwrite a manual ID or a newer address/name edit during lookup.
    const saved = await db('active_locations as locations').where({ id: locationId }).whereNull('google_place_id')
      .where({ name: location.name, address: location.address, city: location.city, state: location.state, zip: location.zip, phone: location.phone, website: location.website })
      .update({ google_place_id: placeId, updated_at: new Date() });
    return saved ? placeId : null;
  } catch (e) { logger.warn('Business identity lookup failed', { locationId, error: (e as Error).message }); return null; }
}
