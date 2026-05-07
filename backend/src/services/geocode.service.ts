import { logger } from '../utils/logger';

interface GeocodeResult {
  lat: number;
  lng: number;
}

// Nominatim (OpenStreetMap) — free, no API key, 1 req/sec limit.
export async function geocodeAddress(
  address: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): Promise<GeocodeResult | null> {
  const parts = [address, city, state, zip, 'USA'].filter(Boolean);
  if (parts.length < 2) return null;

  const q = encodeURIComponent(parts.join(', '));
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SuperLocalSEO/1.0 (superlocalseo.com)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      logger.warn('Geocode request failed', { status: res.status, query: parts.join(', ') });
      return null;
    }

    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length || !data[0]) return null;

    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
    };
  } catch (e) {
    logger.warn('Geocode error', { error: (e as Error).message, query: parts.join(', ') });
    return null;
  }
}
