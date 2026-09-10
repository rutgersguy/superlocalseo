import { providerRoutes, withProviderRoute } from '../services/provider_routing';
import { Job } from 'bullmq';
import { db } from '../db/connection';
import { decrypt } from '../utils/crypto';
import { fetchAllReviews, fetchCampaigns } from '../services/embedmyreviews.service';
import { syncGBPReviews, GBPAuthError } from '../services/gbp.service';
import { syncFacebookReviews } from '../services/facebook.service';
import { logger } from '../utils/logger';

/** Marker: campaign sync deliberately skipped (not an error worth alarming about). */
class SkipCampaigns extends Error {}

export async function processReviews(_job: Job): Promise<void> {
  const integrations = await db('integrations')
    .join('clients', 'clients.id', 'integrations.client_id')
    .where({ 'integrations.provider': 'embedmyreviews', 'integrations.status': 'connected' })
    .whereNotNull('integrations.api_key_encrypted')
    .modify(q => { if (_job.data?.clientId) q.where('integrations.client_id', _job.data.clientId); })
    .select(
      'integrations.id',
      'integrations.client_id',
      'integrations.api_key_encrypted',
      'clients.emr_location_id',
      'clients.emr_organization_id',
    );

  /**
   * Clients with their own live Google connection.
   *
   * ONE SOURCE PER PLATFORM PER CLIENT. EMR and our direct GBP connection can
   * both supply Google reviews, and they identify them differently — EMR uses
   * its own sequential ids ("11", "12"), Google uses long opaque reviewIds. The
   * unique index is (client_id, platform, external_review_id), so the SAME
   * review arriving from both sources does not collide: it is stored twice and
   * shown twice.
   *
   * So where a client has a direct connection, that is the source of truth for
   * Google and EMR's Google reviews are skipped. EMR still supplies every other
   * platform, which is most of its value here anyway.
   */
  const gbpConnectedClientIds = new Set(
    (await db('integrations')
      .where({ provider: 'google', status: 'connected' })
      .whereNotNull('oauth_access_token')
      .select('client_id')).map((r) => r.client_id as string),
  );

  for (const integration of integrations) {
    try {
      const apiKey = decrypt(integration.api_key_encrypted as string);

      const routes = await providerRoutes(integration.client_id, _job.data?.locationId);
      if (!routes.length) continue;
      let reviewCount = 0;
      const syncedOrganizations = new Set<string>();
      for (const route of routes) {
      try {
      if (route.mode === 'explicit' && gbpConnectedClientIds.has(integration.client_id)) throw new Error('Choose one Google review source for this customer before importing mapped reviews. Contact support.');
      const reviews = await fetchAllReviews(apiKey, route.providerLocationId);
      reviewCount += reviews.length;
      const now = new Date();

      await withProviderRoute(route, async trx => {
      for (const review of reviews) {
        // See gbpConnectedClientIds: a client with a direct Google connection
        // takes Google reviews from there, or the same review lands twice under
        // two different external ids.
        if (
          gbpConnectedClientIds.has(integration.client_id as string)
          && (review.platform ?? '').toLowerCase() === 'google'
        ) {
          continue;
        }

        const previous = await trx('reviews').where({ client_id: integration.client_id, platform: review.platform, external_review_id: review.id }).first();
        if (previous?.emr_provider_location_id && previous.emr_provider_location_id !== route.providerLocationId) throw new Error('Review provider location conflict; import requires reconciliation.');
        await trx('reviews')
          .insert({
            client_id: integration.client_id,
            location_id: route.localLocationId,
            emr_provider_location_id: route.providerLocationId,
            source: 'emr',
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
            location_id: route.localLocationId, emr_provider_location_id: route.providerLocationId,
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

      if (route.mode === 'explicit') await trx('provider_location_mappings').where({ location_id: route.localLocationId, revision: route.revision }).update({ last_review_sync_at: now, review_sync_error: null });
      });
      const emrOrgId = Number(route.organizationId);
      try {
        if (syncedOrganizations.has(route.organizationId)) throw new SkipCampaigns();
        const campaigns = await fetchCampaigns(apiKey, emrOrgId);
        await withProviderRoute(route, async trx => {
        for (const c of campaigns) {
          await trx('emr_campaigns')
            .insert({
              client_id: integration.client_id,
              emr_campaign_id: c.id, emr_organization_id: route.organizationId,
              name: c.name,
              statistics_checked: true,
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
              emr_organization_id: route.organizationId, name: c.name,
              statistics_checked: true,
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
        });
        syncedOrganizations.add(route.organizationId);
      } catch (campaignErr) {
        // A deliberate skip already logged its reason; don't double-log it as a failure.
        if (!(campaignErr instanceof SkipCampaigns)) {
          logger.warn('Failed to sync EMR campaigns', {
            clientId: integration.client_id,
            error: (campaignErr as Error).message,
          });
        }
      }

      } catch (error) {
        if (route.mode === 'explicit') await db('provider_location_mappings').where({ location_id: route.localLocationId, revision: route.revision }).update({ review_sync_error: 'This location import failed. Existing reviews are retained; contact support or retry.' }).catch(() => undefined);
        throw error;
      }
      }
      const now = new Date();
      // Private feedback is now received via EMR webhook (POST /webhooks/emr)

      await db('integrations').where({ id: integration.id }).update({ last_pull_at: now, error_message: null });

      logger.info('Reviews pulled successfully', {
        clientId: integration.client_id,
        reviewCount,
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

  if (_job.data?.emrOnly) return;

  // --- GBP sync (our own Google OAuth) — ON by default since 2026-08 ---
  //
  // This was off because our Google Cloud project's GBP API quota was pending
  // (quota_limit_value: 0), which made syncGBPReviews return nothing for every
  // client while flipping integrations to 'disconnected' on auth errors — churn
  // for a path that could not produce data.
  //
  // Google granted the quota, the direct OAuth flow is live in Settings →
  // Integrations, and a client has connected through it with a stored refresh
  // token. So the condition the flag existed for no longer holds, and leaving it
  // off means a working Google connection sits unused.
  //
  // Now opt-OUT rather than opt-in: set GBP_SYNC_ENABLED=false to kill it if the
  // direct path starts misbehaving. Note the disconnect-on-auth-error behaviour
  // below is now CORRECT rather than harmful — a dead token genuinely does need
  // a reconnect, and the UI reports live status rather than a stored flag.
  //
  // EMR remains the other source and is unaffected; the two are additive, and
  // reviews are keyed on external_review_id so a business connected through both
  // does not get duplicates.
  const gbpSyncEnabled = process.env.GBP_SYNC_ENABLED !== 'false';
  if (!gbpSyncEnabled) {
    logger.info('GBP sync skipped — explicitly disabled via GBP_SYNC_ENABLED=false');
  }

  const gbpIntegrations = gbpSyncEnabled
    ? await db('integrations')
        .where({ provider: 'google', status: 'connected' })
        .whereNotNull('oauth_access_token')
        .select('client_id', 'oauth_access_token', 'oauth_refresh_token', 'oauth_expires_at')
    : [];

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
        // Not an auth failure — keep the integration connected and retry next
        // cycle. This covers transient network/5xx AND the 403 you get when the
        // legacy My Business API is not enabled on the Cloud project, which is
        // emphatically not something the customer can fix by reconnecting.
        //
        // Truncated: Google returns multi-kilobyte HTML error pages, and the
        // whole thing was being written into a varchar column.
        logger.error('GBP review sync failed', { clientId: intg.client_id, error: (e as Error).message });
        await db('integrations')
          .where({ client_id: intg.client_id as string, provider: 'google' })
          .update({ error_message: (e as Error).message.replace(/\s+/g, ' ').slice(0, 300) })
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
