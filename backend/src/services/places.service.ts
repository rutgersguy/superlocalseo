import { config } from '../config';
import { logger } from '../utils/logger';

export interface PlaceResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  rating: number | null;
  userRatingsTotal: number | null;
  hasWebsite: boolean;
  photoCount: number;
  hasHours: boolean;
  businessStatus: string | null;
}

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

export async function findBusiness(businessName: string, city: string): Promise<PlaceResult | null> {
  const key = config.googlePlacesApiKey;
  if (!key) {
    logger.warn('GOOGLE_PLACES_API_KEY not set — returning null for audit scan');
    return null;
  }

  const query = encodeURIComponent(`${businessName} ${city}`);
  const fields = 'place_id,name,formatted_address,rating,user_ratings_total,website,photos,opening_hours,business_status';
  const url = `${PLACES_BASE}/textsearch/json?query=${query}&fields=${fields}&key=${key}`;

  const res = await fetch(url);
  if (!res.ok) {
    logger.error('Google Places API error', { status: res.status });
    return null;
  }

  const json = await res.json() as {
    status: string;
    results: Array<{
      place_id: string;
      name: string;
      formatted_address: string;
      rating?: number;
      user_ratings_total?: number;
      website?: string;
      photos?: unknown[];
      opening_hours?: { weekday_text?: string[] };
      business_status?: string;
    }>;
  };

  if (json.status !== 'OK' || !json.results.length) return null;

  const r = json.results[0];
  return {
    placeId: r.place_id,
    name: r.name,
    formattedAddress: r.formatted_address,
    rating: r.rating ?? null,
    userRatingsTotal: r.user_ratings_total ?? null,
    hasWebsite: !!r.website,
    photoCount: r.photos?.length ?? 0,
    hasHours: !!(r.opening_hours?.weekday_text?.length),
    businessStatus: r.business_status ?? null,
  };
}
