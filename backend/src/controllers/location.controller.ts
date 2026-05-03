import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, created, noContent, notFound, err } from '../utils/response';
import { addLocationToSubscription, removeLocationFromSubscription } from '../services/stripe.service';
import { provisionBrightLocalCampaign } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

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
    isPrimary: l.is_primary,
    brightlocalCampaignId: l.brightlocal_campaign_id,
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
        addLocationToSubscription(client.stripe_subscription_id as string, tier).catch((e) =>
          logger.error('Failed to add location to Stripe subscription', { error: (e as Error).message }),
        );
      }
    }

    // Auto-provision BrightLocal campaign if no campaign ID already provided
    const loc = location as Record<string, unknown>;
    if (!loc.brightlocal_campaign_id) {
      provisionBrightLocalCampaign({
        name: body.name,
        website: body.website ?? null,
        address: body.address ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        zip: body.zip ?? null,
        phone: body.phone ?? null,
      }).then(async (campaignId) => {
        await db('locations').where({ id: loc.id }).update({
          brightlocal_campaign_id: campaignId,
          updated_at: new Date(),
        });
        logger.info('BrightLocal campaign auto-provisioned', { locationId: loc.id, campaignId });
      }).catch((e) => {
        logger.error('Failed to auto-provision BrightLocal campaign', {
          locationId: loc.id,
          error: (e as Error).message,
        });
      });
    }

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

    const [updated] = await db('locations').where({ id }).update(updates).returning('*');
    ok(res, formatLocation(updated as Record<string, unknown>));
  } catch (e) {
    next(e);
  }
}

export async function provision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const location = await db('locations').where({ id, client_id: req.clientId }).first();
    if (!location) { notFound(res, 'Location not found'); return; }

    if (location.brightlocal_campaign_id) {
      ok(res, { campaignId: location.brightlocal_campaign_id, alreadyProvisioned: true });
      return;
    }

    const campaignId = await provisionBrightLocalCampaign({
      name: location.name as string,
      website: location.website as string | null,
      address: location.address as string | null,
      city: location.city as string | null,
      state: location.state as string | null,
      zip: location.zip as string | null,
      phone: location.phone as string | null,
    });

    await db('locations').where({ id }).update({ brightlocal_campaign_id: campaignId, updated_at: new Date() });
    logger.info('BrightLocal campaign provisioned via manual trigger', { locationId: id, campaignId });
    ok(res, { campaignId, alreadyProvisioned: false });
  } catch (e) {
    next(e);
  }
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
        removeLocationFromSubscription(client.stripe_subscription_id as string, tier).catch((e) =>
          logger.error('Failed to remove location from Stripe subscription', { error: (e as Error).message }),
        );
      }
    }

    noContent(res);
  } catch (e) {
    next(e);
  }
}
