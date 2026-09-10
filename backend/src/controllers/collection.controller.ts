import { Request, Response, NextFunction } from 'express';
import { randomBytes, createHash } from 'crypto';
import type { Knex } from 'knex';
import QRCode from 'qrcode';
import { z } from 'zod';
import { db } from '../db/connection';
import { config } from '../config';
import { ok } from '../utils/response';
import { mappingError, mappingIdentity } from '../services/provider_mapping.service';
import { resolveProviderRoute } from '../services/provider_routing';

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const locationSchema = z.string().uuid();
const feedbackSchema = z.object({
  submissionId: z.string().uuid(),
  rating: z.number().int().min(1).max(5).nullable().default(null),
  message: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(100).default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(254)]).default(''),
  contactConsent: z.boolean().default(false),
  website: z.string().max(200).default(''),
}).strict().refine(v => !v.email || v.contactConsent, 'Consent is required when providing an email for follow-up.');
const linkUrl = (token: string) => `${config.publicUrl.replace(/\/$/, '')}/review/${token}`;
const googleUrl = (placeId: string) => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
async function locked<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async trx => {
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext('provider-location-mapping-v1'))");
    return fn(trx);
  });
}
async function verified(trx: Knex.Transaction, clientId: string, locationId: string) {
  const location = await trx('locations').where({ id: locationId, client_id: clientId }).forShare().first();
  if (!location) throw mappingError('Location not found', 404);
  const route = await resolveProviderRoute(clientId, locationId, trx);
  if (route?.mode !== 'explicit' || !location.google_place_id) throw mappingError('Ask support to verify this location in Provider mappings before issuing a review link.');
  return { location, revision: route.revision!, identity: mappingIdentity(location) };
}
async function publicLink(trx: Knex.Transaction, token: string) {
  if (!tokenSchema.safeParse(token).success) throw mappingError('This review link is unavailable.', 404);
  const link = await trx('review_collection_links').where({ token }).forShare().first();
  if (!link || link.revoked_at) throw mappingError('This review link is unavailable.', 404);
  try {
    const proof = await verified(trx, link.client_id, link.location_id);
    if (proof.revision !== link.mapping_revision || proof.identity !== link.identity) throw new Error('Changed');
    return { link, ...proof };
  } catch { throw mappingError('This review link is unavailable. Please contact the business.', 404); }
}
export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locations = await db('locations').where({ client_id: req.clientId }).orderBy('name');
    const result = [];
    for (const l of locations) {
      const link = await db('review_collection_links').where({ location_id: l.id, client_id: req.clientId }).first();
      let ready = false;
      try { await locked(trx => verified(trx, req.clientId, l.id)); ready = true; } catch { /* Fail closed */ }
      const mapping = await db('provider_location_mappings').where({ location_id: l.id, client_id: req.clientId }).first();
      const active = ready && link && !link.revoked_at && link.identity === mappingIdentity(l) && link.mapping_revision === mapping?.revision;
      result.push({ locationId: l.id, name: l.name, ready, state: active ? 'active' : link?.revoked_at ? 'revoked' : link ? 'needs_verification' : 'not_created', url: active ? linkUrl(link.token) : null, googleUrl: ready ? googleUrl(l.google_place_id) : null });
    }
    res.setHeader('Cache-Control', 'no-store');
    ok(res, { locations: result, canManage: req.teamRole === 'owner' || req.teamRole === 'admin' });
  } catch (e) { next(e); }
}
export async function issue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = locationSchema.parse(req.params.locationId);
    const { action } = z.object({ action: z.enum(['create', 'rotate', 'revoke']) }).strict().parse(req.body);
    const result = await locked(async trx => {
      const location = await trx('locations').where({ id: locationId, client_id: req.clientId }).forShare().first();
      if (!location) throw mappingError('Location not found', 404);
      const existing = await trx('review_collection_links').where({ location_id: locationId, client_id: req.clientId }).forUpdate().first();
      if (action === 'revoke') {
        if (existing) await trx('review_collection_links').where({ location_id: locationId }).update({ revoked_at: new Date(), updated_at: new Date() });
        return { url: null };
      }
      const proof = await verified(trx, req.clientId, locationId);
      if (action === 'create' && existing) {
        if (existing.revoked_at || existing.identity !== proof.identity || existing.mapping_revision !== proof.revision) throw mappingError('Create a replacement link after checking the destination. The old QR code will stop working.');
        return { url: linkUrl(existing.token) };
      }
      const token = randomBytes(32).toString('hex');
      await trx('review_collection_links').insert({ location_id: locationId, client_id: req.clientId, token, mapping_revision: proof.revision, identity: proof.identity, revoked_at: null }).onConflict('location_id').merge({ token, mapping_revision: proof.revision, identity: proof.identity, revoked_at: null, updated_at: new Date() });
      return { url: linkUrl(token) };
    });
    res.setHeader('Cache-Control', 'no-store'); ok(res, result);
  } catch (e) { next(e); }
}
export async function image(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = locationSchema.parse(req.params.locationId);
    const url = await locked(async trx => {
      const link = await trx('review_collection_links').where({ location_id: locationId, client_id: req.clientId }).first();
      if (!link) throw mappingError('Review link not found', 404);
      await publicLink(trx, link.token);
      return linkUrl(link.token);
    });
    const png = await QRCode.toBuffer(url, { type: 'png', width: 800, margin: 4, errorCorrectionLevel: 'M' });
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="honest-review-qr.png"'); res.send(png);
  } catch (e) { next(e); }
}
export async function view(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await locked(async trx => {
      const { location } = await publicLink(trx, req.params.token);
      return { businessName: location.name, googleUrl: googleUrl(location.google_place_id) };
    });
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); ok(res, result);
  } catch (e) { next(e); }
}
export async function submit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = feedbackSchema.parse(req.body);
    if (parsed.website) throw mappingError('Unable to submit this feedback.', 422);
    await locked(async trx => {
      const { link } = await publicLink(trx, req.params.token);
      const hash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
      const previous = await trx('private_feedback').where({ location_id: link.location_id, submission_id: parsed.submissionId }).first();
      if (previous) {
        if (previous.submission_hash !== hash) throw mappingError('This submission was already received. Reload to write new feedback.');
        return;
      }
      await trx('private_feedback').insert({ client_id: link.client_id, location_id: link.location_id, emr_feedback_id: `native:${link.location_id}:${parsed.submissionId}`, source: 'native', submission_id: parsed.submissionId, submission_hash: hash, rating: parsed.rating, message: parsed.message, contact_name: parsed.name || null, contact_email: parsed.contactConsent ? parsed.email || null : null, contact_consent: parsed.contactConsent, received_at: new Date() });
    });
    res.setHeader('Cache-Control', 'no-store'); ok(res, { received: true });
  } catch (e) { next(e); }
}
