import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, created, noContent, notFound, err } from '../utils/response';
import { addLocationToSubscription, removeLocationFromSubscription } from '../services/stripe.service';
import { getIndustryKeywords } from '../config/industry.config';
import { geocodeAddress } from '../services/geocode.service';
import { getAggregatedSearchVolumes } from '../services/dataforseo.service';
import { logger } from '../utils/logger';

async function seedDefaultKeywords(
  locationId: string,
  businessName: string,
  industry?: string | null,
  city?: string | null,
): Promise<void> {
  const industryKeywords = getIndustryKeywords(industry, city);
  // Industry keywords first; fall back to brand-name seeds if none available.
  const defaults = industryKeywords.length > 0
    ? industryKeywords.slice(0, 5)
    : [businessName.toLowerCase(), `${businessName.toLowerCase()} near me`];

  for (const keyword of defaults) {
    const exists = await db('keywords').where({ location_id: locationId, keyword }).first();
    if (!exists) {
      await db('keywords').insert({
        location_id: locationId,
        keyword,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }
}

// How many locations are included in each tier before extra charges apply
const INCLUDED_PER_TIER: Record<number, number> = { 1: 1, 2: 3, 3: Infinity };

export const locationSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
  brightlocalCampaignId: z.string().max(100).optional().or(z.literal('')),
  serviceArea: z.array(z.string().min(1).max(100)).max(20).optional(),
});

export const locationPatchSchema = locationSchema.partial();

type LocationBody = z.infer<typeof locationSchema>;

function formatLocation(l: Record<string, unknown>) {
  return {
    id: l.id,
    clientId: l.client_id,
    name: l.name,
    address: l.address,
    city: l.city,
    state: l.state,
    zip: l.zip,
    phone: l.phone,
    website: l.website,
    lat: l.lat != null ? Number(l.lat) : null,
    lng: l.lng != null ? Number(l.lng) : null,
    isPrimary: l.is_primary,
    brightlocalCampaignId: l.brightlocal_campaign_id,
    serviceArea: (l.service_area as string[]) ?? [],
    createdAt: l.created_at,
  };
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locations = await db('locations').where({ client_id: req.clientId }).orderBy('is_primary', 'desc').orderBy('created_at', 'asc');
    ok(res, locations.map(formatLocation));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as LocationBody;
    const client = req.client;

    // Check if this is the first location (make it primary)
    const existingCountRow = await db('locations').where({ client_id: req.clientId }).count('id as cnt').first();
    const existingCount = parseInt(String((existingCountRow as Record<string, unknown>)?.cnt ?? 0), 10);
    const isPrimary = existingCount === 0;

    const [location] = await db('locations').insert({
      client_id: req.clientId,
      name: body.name,
      address: body.address ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zip: body.zip ?? null,
      phone: body.phone ?? null,
      website: body.website ?? null,
      brightlocal_campaign_id: body.brightlocalCampaignId || null,
      service_area: JSON.stringify(body.serviceArea ?? []),
      is_primary: isPrimary,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('*');

    // Bill only when the new total exceeds the plan's included location count
    if (client.stripe_subscription_id) {
      const tier = (client.subscription_tier as number) as 1 | 2 | 3;
      const included = INCLUDED_PER_TIER[tier] ?? 1;
      const newTotal = existingCount + 1;
      if (newTotal > included) {
        addLocationToSubscription(client.stripe_subscription_id as string, tier).catch((e: unknown) =>
          logger.error('Failed to add location to Stripe subscription', { error: (e as Error).message }),
        );
      }
    }

    // Seed starter keywords so the rankings job has something to query on first run.
    const industry = (req.client as Record<string, unknown>)?.industry as string | null;
    await seedDefaultKeywords(
      (location as Record<string, unknown>).id as string,
      body.name,
      industry,
      body.city ?? null,
    );

    // Auto-geocode in background — non-fatal if it fails.
    void geocodeAndSave((location as Record<string, unknown>).id as string, body.address, body.city, body.state, body.zip);

    created(res, formatLocation(location as Record<string, unknown>));
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const body = req.body as Partial<LocationBody>;

    const location = await db('locations').where({ id, client_id: req.clientId }).first();
    if (!location) { notFound(res, 'Location not found'); return; }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.address !== undefined) updates.address = body.address;
    if (body.city !== undefined) updates.city = body.city;
    if (body.state !== undefined) updates.state = body.state;
    if (body.zip !== undefined) updates.zip = body.zip;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.website !== undefined) updates.website = body.website;
    if (body.brightlocalCampaignId !== undefined) updates.brightlocal_campaign_id = body.brightlocalCampaignId || null;
    const serviceAreaChanged = body.serviceArea !== undefined;
    if (serviceAreaChanged) updates.service_area = JSON.stringify(body.serviceArea);

    const [updated] = await db('locations').where({ id }).update(updates).returning('*') as Array<Record<string, unknown>>;

    // Re-geocode whenever lat/lng are missing or an address field changed.
    const addressChanged = ['address', 'city', 'state', 'zip'].some((f) => body[f as keyof typeof body] !== undefined);
    if (addressChanged || updated.lat == null) {
      const row = updated;
      void geocodeAndSave(id, row.address as string | null, row.city as string | null, row.state as string | null, row.zip as string | null);
    }

    // Re-fetch search volumes for all keywords when service area changes
    if (serviceAreaChanged) {
      void (async () => {
        try {
          const keywords = await db('keywords').where({ location_id: id }).select('id', 'keyword');
          if (keywords.length === 0) return;
          const serviceArea = (updated.service_area as string[]) ?? [];
          const volumes = await getAggregatedSearchVolumes(
            keywords.map((k) => k.keyword as string),
            serviceArea,
            updated.city as string | null,
            updated.state as string | null,
          );
          for (const v of volumes) {
            if (v.monthlySearchVolume != null) {
              const kw = keywords.find((k) => (k.keyword as string).toLowerCase() === v.keyword.toLowerCase());
              if (kw) {
                await db('keywords').where({ id: kw.id }).update({ monthly_search_volume: v.monthlySearchVolume, updated_at: new Date() });
              }
            }
          }
          logger.info('Refreshed search volumes after service area change', { locationId: id, keywords: keywords.length });
        } catch (e) {
          logger.error('Failed to refresh volumes after service area change', { locationId: id, error: (e as Error).message });
        }
      })();
    }

    ok(res, formatLocation(updated));
  } catch (e) {
    next(e);
  }
}

// Repurposed: seeds default keywords for locations that have none (e.g. locations
// created before this migration, or locations where keywords were deleted).
export async function provision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const location = await db('locations').where({ id, client_id: req.clientId }).first();
    if (!location) { notFound(res, 'Location not found'); return; }

    const countRow = await db('keywords').where({ location_id: id }).count('id as cnt').first();
    const count = parseInt(String((countRow as Record<string, unknown>)?.cnt ?? 0), 10);

    if (count > 0) {
      ok(res, { seeded: false, keywordCount: count });
      return;
    }

    const clientRow = await db('clients').where({ id: req.clientId }).first();
    const industry = (clientRow as Record<string, unknown> | undefined)?.industry as string | null;
    await seedDefaultKeywords(id, location.name as string, industry, location.city as string | null);
    const newCountRow = await db('keywords').where({ location_id: id }).count('id as cnt').first();
    const newCount = parseInt(String((newCountRow as Record<string, unknown>)?.cnt ?? 0), 10);
    logger.info('Default keywords seeded for location', { locationId: id, count: newCount });
    ok(res, { seeded: true, keywordCount: newCount });
  } catch (e) {
    next(e);
  }
}

async function geocodeAndSave(
  locationId: string,
  address: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): Promise<void> {
  const coords = await geocodeAddress(address, city, state, zip);
  if (!coords) return;
  await db('locations').where({ id: locationId }).update({ lat: coords.lat, lng: coords.lng }).catch((e) =>
    logger.warn('Failed to save geocoded coordinates', { locationId, error: (e as Error).message }),
  );
  logger.info('Location geocoded', { locationId, lat: coords.lat, lng: coords.lng });
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const client = req.client;

    const location = await db('locations').where({ id, client_id: req.clientId }).first();
    if (!location) { notFound(res, 'Location not found'); return; }

    const totalCountRow = await db('locations').where({ client_id: req.clientId }).count('id as cnt').first();
    const totalCount = parseInt(String((totalCountRow as Record<string, unknown>)?.cnt ?? 0), 10);

    // Prevent deleting the primary location if it's the only one
    if (location.is_primary && totalCount <= 1) {
      err(res, 'Cannot delete the only location', 400, 'CANNOT_DELETE_ONLY_LOCATION');
      return;
    }

    await db('locations').where({ id }).delete();

    // Remove billing only when the deleted location was beyond the plan's included count
    if (client.stripe_subscription_id) {
      const tier = (client.subscription_tier as number) as 1 | 2 | 3;
      const included = INCLUDED_PER_TIER[tier] ?? 1;
      if (totalCount > included) {
        removeLocationFromSubscription(client.stripe_subscription_id as string, tier).catch((e: unknown) =>
          logger.error('Failed to remove location from Stripe subscription', { error: (e as Error).message }),
        );
      }
    }

    noContent(res);
  } catch (e) {
    next(e);
  }
}
