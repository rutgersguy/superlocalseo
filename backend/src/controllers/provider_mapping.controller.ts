import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok } from '../utils/response';
import { saveProviderMapping } from '../services/provider_mapping.service';

const providerId = z.string().regex(/^[1-9][0-9]{0,14}$/);
const updateSchema = z.object({ revision: z.number().int().min(0), organizationId: providerId, providerLocationId: providerId,
  googlePlaceId: z.string().regex(/^[A-Za-z0-9_-]{5,255}$/), note: z.string().trim().min(5).max(2000) }).strict();

export async function updateProviderMapping(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = z.string().uuid().parse(req.params.locationId);
    const input = updateSchema.parse(req.body);
    ok(res, await saveProviderMapping(locationId, input, req.userId!));
  } catch (e) { next(e); }
}

export async function listProviderMappings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const page = z.coerce.number().int().min(1).max(1000000).default(1).parse(req.query.page);
    const rows = await db('locations as l').join('clients as c', 'c.id', 'l.client_id')
      .select('l.id as locationId', 'l.client_id as clientId', 'c.business_name as businessName', 'l.name as locationName', 'l.city',
        'l.google_place_id as googlePlaceId', 'c.emr_organization_id as legacyOrganizationId', 'c.emr_location_id as legacyProviderLocationId')
      .orderBy('c.business_name').orderBy('l.id').limit(50).offset((page - 1) * 50);
    const total = Number((await db('locations').count('* as n').first())?.n ?? 0);
    const ids = rows.map(r => r.locationId);
    const mappings = ids.length ? await db('provider_location_mappings').whereIn('location_id', ids) : [];
    const events = ids.length ? await db('provider_mapping_events').whereIn('location_id', ids).orderBy('revision', 'desc') : [];
    ok(res, { locations: rows.map(r => {
      const m = mappings.find(m => m.location_id === r.locationId);
      return { ...r, mapping: m ? { organizationId: m.organization_id, providerLocationId: m.provider_location_id,
        googlePlaceId: m.google_place_id, revision: m.revision, verifiedAt: m.verified_at, note: m.note, evidence: m.evidence,
        identityCurrent: r.googlePlaceId === m.google_place_id,
        events: events.filter(e => e.location_id === r.locationId).map(e => ({ revision: e.revision, note: e.note, actorId: e.actor_id, createdAt: e.created_at, evidence: e.evidence })) } : null };
    }), page, total, hasMore: page * 50 < total, verificationAvailable: false,
      verificationUnavailableReason: 'Binding is disabled until the provider identity source has been verified. Existing mappings and history remain visible.' });
  } catch (e) { next(e); }
}
