import { Job } from 'bullmq';
import { db } from '../db/connection';
import { decrypt } from '../utils/crypto';
import { fetchAllReviews, fetchCampaigns, fetchFeedback } from '../services/embedmyreviews.service';
import { logger } from '../utils/logger';

export async function processReviews(_job: Job): Promise<void> {
  const integrations = await db('integrations')
    .where({ provider: 'embedmyreviews', status: 'connected' })
    .whereNotNull('api_key_encrypted')
    .select('id', 'client_id', 'api_key_encrypted');

  for (const integration of integrations) {
    try {
      const apiKey = decrypt(integration.api_key_encrypted as string);
      const reviews = await fetchAllReviews(apiKey);

      const now = new Date();

      for (const review of reviews) {
        await db('reviews')
          .insert({
            client_id: integration.client_id,
            location_id: null,
            platform: review.platform,
            external_review_id: review.id,
            author_name: review.author,
            rating: review.rating,
            body: review.body,
            sentiment: null,
            status: 'new',
            review_date: new Date(review.date),
            ingested_at: now,
            platform_url: review.url,
            replied: review.replied,
            reply_date: review.replyDate ? new Date(review.replyDate) : null,
            emr_reply_text: review.replyText,
            hidden: review.hidden,
            avatar_url: review.avatarUrl,
            verified: review.verified,
          })
          .onConflict(['platform', 'external_review_id'])
          .merge({
            author_name: review.author,
            rating: review.rating,
            body: review.body,
            platform_url: review.url,
            replied: review.replied,
            reply_date: review.replyDate ? new Date(review.replyDate) : null,
            emr_reply_text: review.replyText,
            hidden: review.hidden,
            avatar_url: review.avatarUrl,
            verified: review.verified,
            ingested_at: now,
          });
      }

      // Sync campaigns and their funnel metrics
      try {
        const campaigns = await fetchCampaigns(apiKey);
        for (const c of campaigns) {
          await db('emr_campaigns')
            .insert({
              client_id: integration.client_id,
              emr_campaign_id: c.id,
              name: c.name,
              invited: c.invited,
              opened: c.opened,
              clicked: c.clicked,
              reviewed: c.reviewed,
              private_feedback: c.privateFeedback,
              unsubscribed: c.unsubscribed,
              metrics_pulled_at: now,
            })
            .onConflict(['client_id', 'emr_campaign_id'])
            .merge({
              name: c.name,
              invited: c.invited,
              opened: c.opened,
              clicked: c.clicked,
              reviewed: c.reviewed,
              private_feedback: c.privateFeedback,
              unsubscribed: c.unsubscribed,
              metrics_pulled_at: now,
              updated_at: now,
            });
        }
      } catch (campaignErr) {
        // Non-fatal — campaign fetch may fail if not set up
        logger.warn('Failed to sync EMR campaigns', {
          clientId: integration.client_id,
          error: (campaignErr as Error).message,
        });
      }

      try {
        const { feedback } = await fetchFeedback(apiKey);
        for (const f of feedback) {
          await db('private_feedback')
            .insert({
              client_id: integration.client_id,
              emr_feedback_id: f.id,
              campaign_id: f.campaignId ?? null,
              contact_name: f.contactName ?? null,
              contact_email: f.contactEmail ?? null,
              contact_phone: f.contactPhone ?? null,
              rating: f.rating ?? null,
              message: f.message ?? null,
              received_at: new Date(f.receivedAt),
            })
            .onConflict(['emr_feedback_id'])
            .merge({
              campaign_id: f.campaignId ?? null,
              contact_name: f.contactName ?? null,
              contact_email: f.contactEmail ?? null,
              contact_phone: f.contactPhone ?? null,
              rating: f.rating ?? null,
              message: f.message ?? null,
              received_at: new Date(f.receivedAt),
            });
        }
      } catch (feedbackErr) {
        logger.warn('Failed to sync EMR private feedback', {
          clientId: integration.client_id,
          error: (feedbackErr as Error).message,
        });
      }

      await db('integrations').where({ id: integration.id }).update({ last_pull_at: now });

      logger.info('Reviews pulled successfully', {
        clientId: integration.client_id,
        reviewCount: reviews.length,
      });
    } catch (e) {
      logger.error('Failed to pull reviews for client', {
        clientId: integration.client_id,
        error: (e as Error).message,
      });

      await db('integrations')
        .where({ id: integration.id })
        .update({ error_message: (e as Error).message })
        .catch(() => undefined);
    }
  }
}
