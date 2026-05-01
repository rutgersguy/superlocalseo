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

// Uses Places API (New): https://places.googleapis.com/v1/places:searchText
export async function findBusiness(businessName: string, city: string): Promise<PlaceResult | null> {
  const key = config.googlePlacesApiKey;
  if (!key) {
    logger.warn('GOOGLE_PLACES_API_KEY not set — returning null for audit scan');
    return null;
  }

  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.rating',
    'places.userRatingCount',
    'places.websiteUri',
    'places.photos',
    'places.regularOpeningHours',
    'places.businessStatus',
  ].join(',');

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify({ textQuery: `${businessName} ${city}` }),
  });

  if (!res.ok) {
    logger.error('Google Places API (New) error', { status: res.status, body: await res.text() });
    return null;
  }

  const json = await res.json() as {
    places?: Array<{
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      rating?: number;
      userRatingCount?: number;
      websiteUri?: string;
      photos?: unknown[];
      regularOpeningHours?: { weekdayDescriptions?: string[] };
      businessStatus?: string;
    }>;
  };

  if (!json.places?.length) return null;

  const p = json.places[0];
  return {
    placeId: p.id,
    name: p.displayName?.text ?? businessName,
    formattedAddress: p.formattedAddress ?? '',
    rating: p.rating ?? null,
    userRatingsTotal: p.userRatingCount ?? null,
    hasWebsite: !!p.websiteUri,
    photoCount: p.photos?.length ?? 0,
    hasHours: !!(p.regularOpeningHours?.weekdayDescriptions?.length),
    businessStatus: p.businessStatus ?? null,
  };
}
