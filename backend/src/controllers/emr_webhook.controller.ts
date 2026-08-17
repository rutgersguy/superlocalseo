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
  // Acknowledge immediately so EMR doesn't retry on slow processing
  res.json({ received: true });

  let body: Record<string, unknown>;
  try {
    body = req.body instanceof Buffer
      ? JSON.parse(req.body.toString())
      : req.body as Record<string, unknown>;
  } catch {
    logger.warn('EMR webhook: failed to parse body');
    return;
  }

  const eventType = ((body.webhook_event ?? body.event ?? '') as string).toLowerCase();
  const data = (body.data ?? body) as Record<string, unknown>;
  const organizationId = (body.organization_id ?? data.organization_id ?? null) as string | null;

  logger.info('EMR webhook received', { eventType, organizationId });

  // Resolve our client from the EMR organization ID.
  // The webhook's organization_id maps to clients.emr_organization_id (an integer column) —
  // NOT emr_customer_id (the EMR sub-account id, a different value). Matching the wrong column
  // silently dropped every inbound review.
  let clientId: string | null = null;
  if (organizationId) {
    const orgIdNum = Number(organizationId);
    const client = Number.isFinite(orgIdNum)
      ? await db('clients').where({ emr_organization_id: orgIdNum }).first<{ id: string }>()
      : null;
    clientId = client?.id ?? null;
    if (!clientId) {
      logger.warn('EMR webhook: no client matched organization', { organizationId, eventType });
    }
  }

  const now = new Date();

  try {
    if (eventType === 'review-created' || eventType === 'review-updated') {
      if (!clientId) return;

      await db('reviews')
        .insert({
          client_id: clientId,
          location_id: null,
          platform: (data.source ?? 'embedmyreviews') as string,
          external_review_id: data.id as string,
          author_name: (data.author ?? null) as string | null,
          rating: (data.rating ?? null) as number | null,
          body: (data.message ?? null) as string | null,
          sentiment: null,
          status: 'new',
          review_date: data.published_at ? new Date(data.published_at as string) : now,
          ingested_at: now,
          platform_url: (data.url ?? null) as string | null,
          replied: !!(data.reply),
          reply_date: (data as any).reply?.date ? new Date((data as any).reply.date) : null,
          emr_reply_text: (data as any).reply?.text ?? null,
          hidden: (data.hidden ?? false) as boolean,
          avatar_url: (data.avatar ?? null) as string | null,
          verified: (data.verified ?? null) as boolean | null,
        })
        .onConflict(['client_id', 'platform', 'external_review_id'])
        .merge({
          author_name: (data.author ?? null) as string | null,
          rating: (data.rating ?? null) as number | null,
          body: (data.message ?? null) as string | null,
          platform_url: (data.url ?? null) as string | null,
          replied: !!(data.reply),
          reply_date: (data as any).reply?.date ? new Date((data as any).reply.date) : null,
          emr_reply_text: (data as any).reply?.text ?? null,
          hidden: (data.hidden ?? false) as boolean,
          avatar_url: (data.avatar ?? null) as string | null,
          verified: (data.verified ?? null) as boolean | null,
          ingested_at: now,
        });

      logger.info('EMR review upserted via webhook', { clientId, reviewId: data.id, eventType });

    } else if (eventType === 'private-feedback-created' || eventType === 'private-feedback-updated') {
      if (!clientId) return;

      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

      await db('private_feedback')
        .insert({
          client_id: clientId,
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

      logger.info('EMR private feedback received via webhook', { clientId, feedbackId: data.id });

    } else {
      logger.info('EMR webhook: unhandled event type', { eventType });
    }
  } catch (e) {
    logger.error('EMR webhook handler error', { eventType, error: (e as Error).message });
  }
}
