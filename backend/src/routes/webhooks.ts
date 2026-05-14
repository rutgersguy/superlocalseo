import { Router, Request, Response } from 'express';
import { stripe, handleWebhookEvent } from '../services/stripe.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { db } from '../db/connection';

const router = Router();

// Stripe requires raw body — must be registered before json() middleware
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig || !config.stripe.webhookSecret) { res.status(400).send('Missing signature'); return; }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (e: any) {
    logger.warn('Stripe webhook signature invalid', { error: e.message });
    res.status(400).send(`Webhook error: ${e.message}`);
    return;
  }

  try {
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (e) {
    logger.error('Stripe webhook handler failed', { error: e, eventType: event.type });
    res.status(500).send('Handler error');
  }
});

// EMR sends JSON — parse the raw Buffer
router.post('/emr', async (req: Request, res: Response) => {
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

  // Resolve our client from the EMR organization ID
  let clientId: string | null = null;
  if (organizationId) {
    const client = await db('clients').where({ emr_customer_id: organizationId }).first<{ id: string }>();
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
        .onConflict(['platform', 'external_review_id'])
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

    } else if (eventType.includes('feedback')) {
      // Private feedback webhook — event name TBD (launching today per EMR)
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
});

export default router;
