import { resolveProviderRoute, withProviderRoute, ProviderRoute } from '../services/provider_routing';
import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { db } from '../db/connection';

/**
 * Inbound EmbedMyReviews webhook handler.
 *
 * Extracted from routes/webhooks.ts so that BOTH registered URLs share one
 * implementation. Previously there were two divergent copies:
 *
 *   POST /webhooks/emr          correct client lookup, but NO authentication
 *   POST /api/reviews/webhook   authenticated, but matched on locations.id —
 *                               a value EMR never sends, so it silently
 *                               dropped every payload
 *
 * So the guard sat on the endpoint that did nothing, while the endpoint that
 * actually worked was open to anyone who could guess a small integer
 * organization id (issue #148). One handler, one auth middleware, both paths.
 *
 * Accepts either a raw Buffer (mounted under /webhooks/*, which uses
 * express.raw() so Stripe can verify signatures) or an already-parsed object
 * (mounted under /api, which goes through express.json()).
 */
export async function handleEmrWebhook(req: Request, res: Response): Promise<void> {
  try {
    await processWebhook(req);
    res.json({received:true});
  } catch {
    logger.error('EMR webhook could not be durably processed');
    res.status(503).json({received:false});
  }
}
async function processWebhook(req: Request): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = req.body instanceof Buffer
      ? JSON.parse(req.body.toString())
      : req.body as Record<string, unknown>;
  } catch {
    throw new Error('Invalid webhook body');
  }

  if (!body || typeof body !== 'object') throw new Error('Invalid webhook body');
  const eventType = String(body.webhook_event ?? body.event ?? '').toLowerCase();
  const data = (body.data ?? body) as Record<string, unknown>;
  const organizationId = (body.organization_id ?? data.organization_id ?? null) as string | null;

  logger.info('EMR webhook received', { eventType, organizationId });

  let clientId: string | null = null;
  let localLocationId: string | null = null;
  let providerLocationId: string | null = null;
  let resolvedRoute: ProviderRoute | null = null;
  try {
    if (!/^[1-9][0-9]{0,14}$/.test(String(organizationId))) return;
    const owner = await db('provider_organization_owners').where({ organization_id: String(organizationId) }).first();
    const legacy = await db('clients').where({ emr_organization_id: Number(organizationId) });
    if (legacy.length > 1 || (owner && legacy.some(c => c.id !== owner.client_id))) return;
    clientId = owner?.client_id ?? legacy[0]?.id ?? null;
    if (!clientId) return;
    const mappings = await db('provider_location_mappings').where({ client_id: clientId });
    const providerId = body.location_id ?? data.location_id;
    let selected: string | undefined;
    if (mappings.length) {
      const matches = mappings.filter(m => m.organization_id === String(organizationId) && (providerId == null || m.provider_location_id === String(providerId)));
      if (matches.length !== 1) return;
      selected = matches[0].location_id;
    }
    const route = await resolveProviderRoute(clientId, selected);
    if (!route || route.organizationId !== String(organizationId) || (providerId != null && route.providerLocationId !== String(providerId))) return;
    resolvedRoute = route;
    localLocationId = route.localLocationId; providerLocationId = route.providerLocationId;
  } catch { logger.warn('EMR webhook routing needs reconciliation', { organizationId, eventType }); return; }

  const now = new Date();

  try {
    if (eventType === 'review-created' || eventType === 'review-updated') {
      if (!clientId) return;
      // Notifications are hints, never authoritative snapshots. Re-read the scoped API
      // for legacy and explicit routes so delayed events cannot restore stale content.
      const { reviewsQueue } = await import('../jobs/queue');
      await reviewsQueue.add('provider-webhook-import', {clientId,locationId:localLocationId,emrOnly:true}, {removeOnComplete:100,removeOnFail:100,attempts:3,backoff:{type:'exponential',delay:5000}});
    } else if (eventType === 'private-feedback-created' || eventType === 'private-feedback-updated') {
      if (!clientId) return;

      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

      await withProviderRoute(resolvedRoute!, async trx => {
      await trx('private_feedback')
        .insert({
          client_id: clientId,
          location_id: localLocationId,
          emr_feedback_id: data.id as string,
          campaign_id: (data.campaign_id ?? null) as string | null,
          contact_name: name,
          contact_email: (data.email ?? null) as string | null,
          contact_phone: (data.phone ?? null) as string | null,
          rating: (data.rating ?? null) as number | null,
          message: (data.message ?? null) as string | null,
          received_at: data.created_at ? new Date(data.created_at as string) : now,
        })
        .onConflict(['emr_feedback_id'])
        .ignore();

      });
      logger.info('EMR private feedback received via webhook', { clientId, feedbackId: data.id });

    } else {
      logger.info('EMR webhook: unhandled event type', { eventType });
    }
  } catch (e) {
    throw e;
  }
}
