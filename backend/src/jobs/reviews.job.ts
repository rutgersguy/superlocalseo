import { Job } from 'bullmq';
import { db } from '../db/connection';
import { decrypt } from '../utils/crypto';
import { fetchAllReviews, fetchCampaigns } from '../services/embedmyreviews.service';
import { syncGBPReviews, GBPAuthError } from '../services/gbp.service';
import { syncFacebookReviews } from '../services/facebook.service';
import { logger } from '../utils/logger';

export async function processReviews(_job: Job): Promise<void> {
  const integrations = await db('integrations')
    .join('clients', 'clients.id', 'integrations.client_id')
    .where({ 'integrations.provider': 'embedmyreviews', 'integrations.status': 'connected' })
    .whereNotNull('integrations.api_key_encrypted')
    .select(
      'integrations.id',
      'integrations.client_id',
      'integrations.api_key_encrypted',
      'clients.emr_location_id',
    );

  for (const integration of integrations) {
    try {
      const apiKey = decrypt(integration.api_key_encrypted as string);

      // Every client's integration row holds the SAME agency operator key, so an unscoped
      // fetch returns the whole organization's reviews — i.e. every client would be handed
      // every other client's reviews. The EMR location is the tenancy boundary; without one
      // we must not sync at all. (See migration 20260714000000.)
      const emrLocationId = integration.emr_location_id as number | null;
      if (!emrLocationId) {
        logger.warn('Skipping EMR review sync — client has no EMR location', {
          clientId: integration.client_id,
        });
        continue;
      }

      const reviews = await fetchAllReviews(apiKey, String(emrLocationId));

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
          .onConflict(['client_id', 'platform', 'external_review_id'])
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

      // Private feedback is now received via EMR webhook (POST /webhooks/emr)

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

  // GBP sync
  const gbpIntegrations = await db('integrations')
    .where({ provider: 'google', status: 'connected' })
    .whereNotNull('oauth_access_token')
    .select('client_id', 'oauth_access_token', 'oauth_refresh_token', 'oauth_expires_at');

  for (const intg of gbpIntegrations) {
    try {
      await syncGBPReviews(
        intg.client_id as string,
        intg.oauth_access_token as string,
        (intg.oauth_refresh_token as string | null) ?? null,
        intg.oauth_expires_at ? new Date(intg.oauth_expires_at as string) : null,
      );
    } catch (e) {
      if (e instanceof GBPAuthError) {
        // Dead/mismatched token — retrying every 6h will never recover it. Flag the
        // integration for reconnect (dashboard shows "Connect Google" when status is
        // not 'connected') and clear the dead tokens so it stops being re-synced.
        logger.error('GBP auth failed — flagging integration for reconnect', {
          clientId: intg.client_id,
          httpStatus: e.httpStatus,
          error: e.message,
        });
        await db('integrations')
          .where({ client_id: intg.client_id as string, provider: 'google' })
          .update({
            status: 'disconnected',
            oauth_access_token: null,
            oauth_refresh_token: null,
            error_message: 'Google authorization expired. Please reconnect your Google Business Profile.',
            updated_at: new Date(),
          })
          .catch(() => undefined);
      } else {
        // Transient (network/5xx) — keep the integration connected and retry next cycle.
        logger.error('GBP review sync failed', { clientId: intg.client_id, error: (e as Error).message });
        await db('integrations')
          .where({ client_id: intg.client_id as string, provider: 'google' })
          .update({ error_message: (e as Error).message })
          .catch(() => undefined);
      }
    }
  }

  // Facebook sync
  const fbIntegrations = await db('integrations')
    .where({ provider: 'facebook', status: 'connected' })
    .whereNotNull('oauth_access_token')
    .whereNotNull('external_account_id')
    .select('client_id', 'oauth_access_token', 'external_account_id');

  for (const intg of fbIntegrations) {
    try {
      await syncFacebookReviews(
        intg.client_id as string,
        intg.external_account_id as string,
        intg.oauth_access_token as string,
      );
    } catch (e) {
      logger.error('Facebook review sync failed', { clientId: intg.client_id, error: (e as Error).message });
    }
  }
}
