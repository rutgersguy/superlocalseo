import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';

const schema = z.object({ locationId: z.string().uuid() });

export async function requestSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { err(res, 'Select a business location', 400, 'VALIDATION_ERROR'); return; }
    const location = await db('locations').where({ id: parsed.data.locationId, client_id: req.clientId }).first();
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }
    await db('campaign_setup_requests').insert({ client_id: req.clientId, location_id: location.id, requested_by: req.userId })
      .onConflict(['client_id', 'location_id']).ignore();
    const row = await db('campaign_setup_requests').where({ client_id: req.clientId, location_id: location.id }).first();
    ok(res, { id: row.id, locationId: row.location_id, requestedAt: row.created_at, status: 'requested' });
  } catch (e) { next(e); }
}

export async function setupStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locations = await db('locations').where({ client_id: req.clientId }).select('id', 'name', 'city');
    const requests = await db('campaign_setup_requests').where({ client_id: req.clientId }).select('id', 'location_id', 'created_at');
    ok(res, { locations, requests: requests.map(r => ({ id: r.id, locationId: r.location_id, requestedAt: r.created_at, status: 'requested' })) });
  } catch (e) { next(e); }
}

/** Read-only operations queue. A synced campaign alone is not verification of its destination. */
export async function setupQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const rows = await db('campaign_setup_requests as r')
      .join('clients as c', 'c.id', 'r.client_id').join('locations as l', 'l.id', 'r.location_id')
      .select('r.id', 'r.created_at as requestedAt', 'c.business_name as businessName', 'l.name as locationName',
        'l.city', 'c.emr_organization_id as organizationId', 'c.emr_location_id as providerLocationId', 'r.client_id as clientId')
      .orderBy('r.created_at', 'asc').limit(50).offset((page - 1) * 50);
    const total = Number((await db('campaign_setup_requests').count('* as n').first())?.n ?? 0);
    const campaigns = rows.length ? await db('emr_campaigns').whereIn('client_id', rows.map(r => r.clientId))
      .select('client_id', 'name', 'emr_campaign_id', 'metrics_pulled_at') : [];
    ok(res, { requests: rows.map(r => ({ ...r, campaigns: campaigns.filter(c => c.client_id === r.clientId)
      .map(c => ({ name: c.name, providerId: c.emr_campaign_id, lastSyncAt: c.metrics_pulled_at })) })), page, total, hasMore: page * 50 < total });
  } catch (e) { next(e); }
}
