import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, created, noContent, notFound, err } from '../utils/response';
import { addLocationToSubscription, removeLocationFromSubscription } from '../services/stripe.service';
import { logger } from '../utils/logger';

export const locationSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
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
    const existingCount = await db('locations').where({ client_id: req.clientId }).count('id as cnt').first();
    const isPrimary = parseInt(String((existingCount as Record<string, unknown>)?.cnt ?? 0), 10) === 0;

    const [location] = await db('locations').insert({
      client_id: req.clientId,
      name: body.name,
      address: body.address ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zip: body.zip ?? null,
      phone: body.phone ?? null,
      website: body.website ?? null,
      is_primary: isPrimary,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('*');

    // If not the first location and client has a subscription, bill for it
    if (!isPrimary && client.stripe_subscription_id) {
      const tier = (client.subscription_tier as number) as 1 | 2 | 3;
      addLocationToSubscription(client.stripe_subscription_id as string, tier).catch((e) =>
        logger.error('Failed to add location to Stripe subscription', { error: (e as Error).message }),
      );
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

    const [updated] = await db('locations').where({ id }).update(updates).returning('*');
    ok(res, formatLocation(updated as Record<string, unknown>));
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

    // Prevent deleting the primary location if it's the only one
    if (location.is_primary) {
      const totalCount = await db('locations').where({ client_id: req.clientId }).count('id as cnt').first();
      const total = parseInt(String((totalCount as Record<string, unknown>)?.cnt ?? 0), 10);
      if (total <= 1) {
        err(res, 'Cannot delete the only location', 400, 'CANNOT_DELETE_ONLY_LOCATION');
        return;
      }
    }

    await db('locations').where({ id }).delete();

    // Update Stripe subscription if applicable
    if (client.stripe_subscription_id) {
      const tier = (client.subscription_tier as number) as 1 | 2 | 3;
      removeLocationFromSubscription(client.stripe_subscription_id as string, tier).catch((e) =>
        logger.error('Failed to remove location from Stripe subscription', { error: (e as Error).message }),
      );
    }

    noContent(res);
  } catch (e) {
    next(e);
  }
}
