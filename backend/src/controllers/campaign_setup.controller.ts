import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';

import { setupView, mappedCampaignClient, verificationBinding, CAMPAIGN_TEMPLATE_VERSION } from '../services/campaign_verification';

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
    const [client, locations, campaigns] = await Promise.all([db('clients').where({ id: req.clientId }).first(), db('locations').where({ client_id: req.clientId }), db('emr_campaigns').where({ client_id: req.clientId })]);
    const mappings = await db('provider_location_mappings').where({ client_id: req.clientId });
    ok(res, setupView(row, location, mappedCampaignClient(client, location, mappings), campaigns, locations.length));
  } catch (e) { next(e); }
}

export async function setupStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locations = await db('locations').where({ client_id: req.clientId }).select('id', 'name', 'city');
    const requests = await db('campaign_setup_requests').where({ client_id: req.clientId });
    const fullLocations = await db('locations').where({ client_id: req.clientId });
    const client = await db('clients').where({ id: req.clientId }).first();
    const campaigns = await db('emr_campaigns').where({ client_id: req.clientId });
    const mappings = await db('provider_location_mappings').where({ client_id: req.clientId });
    ok(res, { locations, requests: requests.map(r => setupView(r, fullLocations.find(l => l.id === r.location_id), mappedCampaignClient(client, fullLocations.find(l => l.id === r.location_id), mappings), campaigns, fullLocations.length)) });
  } catch (e) { next(e); }
}

/** Operations queue. A synced campaign alone is not verification of its destination. */
export async function setupQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const page = z.coerce.number().int().min(1).max(1000000).default(1).parse(req.query.page);
    const rows = await db('campaign_setup_requests as r')
      .join('clients as c', 'c.id', 'r.client_id').join('locations as l', 'l.id', 'r.location_id')
      .select('r.id', 'r.location_id as locationId', 'r.created_at as requestedAt', 'c.business_name as businessName', 'l.name as locationName',
        'l.city', 'l.google_place_id as googlePlaceId', 'r.status', 'r.revision', 'r.verification', 'r.updated_at as updatedAt', 'c.emr_organization_id as organizationId', 'c.emr_location_id as providerLocationId', 'r.client_id as clientId')
      .orderBy('r.created_at', 'asc').limit(50).offset((page - 1) * 50);
    const total = Number((await db('campaign_setup_requests').count('* as n').first())?.n ?? 0);
    const campaigns = rows.length ? await db('emr_campaigns').whereIn('client_id', rows.map(r => r.clientId))
      .select('client_id', 'name', 'emr_campaign_id', 'metrics_pulled_at', 'emr_organization_id') : [];
    const clientIds = rows.map(r => r.clientId);
    const locations = clientIds.length ? await db('locations').whereIn('client_id', clientIds) : [];
    const clients = clientIds.length ? await db('clients').whereIn('id', clientIds) : [];
    const events = rows.length ? await db('campaign_setup_events').whereIn('request_id', rows.map(r => r.id)).orderBy('revision', 'desc') : [];
    const mappings = clientIds.length ? await db('provider_location_mappings').whereIn('client_id', clientIds) : [];
    const requests = rows.map(r => {
      const ownLocations = locations.filter(l => l.client_id === r.clientId);
      const location = ownLocations.find(l => l.id === r.locationId);
      const context = mappedCampaignClient(clients.find(c => c.id === r.clientId), location, mappings);
      return { ...r, organizationId: context?.emr_organization_id ?? null, providerLocationId: context?.emr_location_id ?? null, mappingReady: Boolean(context?.mappingRevision), ...setupView({ ...r, location_id: location?.id, created_at: r.requestedAt, updated_at: r.updatedAt }, location,
        context, campaigns.filter(c => c.client_id === r.clientId), ownLocations.length),
        verification: r.verification, locationCount: ownLocations.length,
        events: events.filter(e => e.request_id === r.id).map(e => ({ revision: e.revision, status: e.status, note: e.note, actorId: e.actor_id, createdAt: e.created_at, verification: e.verification })),
        campaigns: campaigns.filter(c => c.client_id === r.clientId).map(c => ({ name: c.name, providerId: c.emr_campaign_id, lastSyncAt: c.metrics_pulled_at })) };
    });
    ok(res, { requests, page, total, hasMore: page * 50 < total });
  } catch (e) { next(e); }
}

const updateSchema = z.object({
  revision: z.number().int().min(0), status: z.enum(['requested', 'in_progress', 'blocked', 'verified']),
  note: z.string().trim().min(5).max(2000),
  proof: z.object({ campaignId: z.string().min(1).max(255), googlePlaceId: z.string().regex(/^[A-Za-z0-9_-]{5,255}$/),
    templateVersion: z.literal(CAMPAIGN_TEMPLATE_VERSION),
    identity: z.literal(true), equalAccess: z.literal(true), optionalFeedback: z.literal(true),
    sender: z.literal(true), optOut: z.literal(true), schedule: z.literal(true), noEnrollment: z.literal(true),
  }).strict().optional(),
}).strict();
export async function updateSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z.string().uuid().parse(req.params.id); const p = updateSchema.parse(req.body);
    const result = await db.transaction(async trx => {
      await trx.raw("SELECT pg_advisory_xact_lock(hashtext('provider-location-mapping-v1'))");
      const r = await trx('campaign_setup_requests').where({ id }).forUpdate().first();
      if (!r) return { code: 404, message: 'Setup request not found' };
      if (r.revision !== p.revision) return { code: 409, message: 'This request changed. Refresh before saving again.' };
      let verification = null;
      if (p.status === 'verified') {
        if (!p.proof) return { code: 400, message: 'Complete every verification check.' };
        const storedClient = await trx('clients').where({ id: r.client_id }).forUpdate().first();
        const locations = await trx('locations').where({ client_id: r.client_id }).forShare();
        const location = locations.find(l => l.id === r.location_id);
        const mappings = await trx('provider_location_mappings').where({ client_id: r.client_id });
        const client = mappedCampaignClient(storedClient, location, mappings);
        if (locations.length !== 1 && !client?.mappingRevision) return { code: 409, message: 'Multi-location provider mapping requires manual reconciliation before verification is supported.' };
        if (!location?.google_place_id || location.google_place_id !== p.proof.googlePlaceId || !client?.emr_organization_id || !client?.emr_location_id)
          return { code: 409, message: 'Save and verify the business Google place ID and provider mapping first.' };
        const shared = await trx('clients').whereNot({ id: r.client_id }).andWhere(b => b.where({ emr_organization_id: client.emr_organization_id }).orWhere({ emr_location_id: client.emr_location_id })).first();
        if (shared) return { code: 409, message: 'Provider mapping is shared with another customer. Reconcile it before verification.' };
        const campaign = await trx('emr_campaigns').where({ client_id: r.client_id, emr_campaign_id: p.proof.campaignId }).forShare().first();
        if (!campaign || !campaign.metrics_pulled_at || (client.mappingRevision && campaign.emr_organization_id !== String(client.emr_organization_id))) return { code: 409, message: 'Select a campaign synced to this customer first.' };
        const otherSetup = await trx('campaign_setup_requests').where({ client_id: r.client_id, status: 'verified' }).whereNot({ location_id: location.id }).whereRaw("verification->>'campaignId' = ?", [p.proof.campaignId]).first();
        if (otherSetup) return { code: 409, message: 'This campaign is already assigned to another location. Use a separate campaign for each branch.' };
        verification = { ...p.proof, channel: 'email', campaignName: campaign.name, locationName: location.name, organizationId: String(client.emr_organization_id), providerLocationId: String(client.emr_location_id),
          publicReviewUrl: 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(location.google_place_id),
          binding: verificationBinding(location, client, campaign), verifiedAt: new Date().toISOString(), verifiedBy: req.userId };
      }
      const revision = r.revision + 1;
      await trx('campaign_setup_requests').where({ id }).update({ status: p.status, revision, verification: verification ? JSON.stringify(verification) : null, updated_at: new Date() });
      await trx('campaign_setup_events').insert({ request_id: id, actor_id: req.userId, revision, status: p.status, note: p.note, verification: verification ? JSON.stringify(verification) : null });
      return { code: 200, revision };
    });
    if (result.code !== 200) { err(res, result.message!, result.code); return; }
    ok(res, { id, revision: result.revision });
  } catch (e) { next(e); }
}
