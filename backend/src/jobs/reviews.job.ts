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
  // An EMR organization shared by more than one client cannot host isolated campaigns —
  // campaigns filter by organization_id only. Detect those orgs up front and refuse to sync
  // campaigns for any client sitting in one.
  const orgCounts = await db('clients')
    .whereNotNull('emr_organization_id')
    .select('emr_organization_id')
    .count('* as n')
    .groupBy('emr_organization_id') as Array<{ emr_organization_id: number; n: string }>;
  const sharedOrgIds = new Set(
    orgCounts.filter((r) => Number(r.n) > 1).map((r) => Number(r.emr_organization_id)),
  );
  const integrations = await db('integrations')
    .join('clients', 'clients.id', 'integrations.client_id')
    .where({ 'integrations.provider': 'embedmyreviews', 'integrations.status': 'connected' })
    .whereNotNull('integrations.api_key_encrypted')
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
        // See gbpConnectedClientIds: a client with a direct Google connection
        // takes Google reviews from there, or the same review lands twice under
        // two different external ids.
        if (
          gbpConnectedClientIds.has(integration.client_id as string)
          && (review.platform ?? '').toLowerCase() === 'google'
        ) {
          continue;
        }

        await db('reviews')
          .insert({
            client_id: integration.client_id,
            location_id: null,
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

      // Sync campaigns and their funnel metrics.
      //
      // Campaigns scope to an EMR ORGANIZATION, not a location (reviews are the other way
      // round). Every client currently shares organization 1, so syncing campaigns would
      // write the SAME org-wide campaign set under every client_id — the exact leak that was
      // fixed for reviews in migration 20260714000000. Until each client has its own EMR
      // organization, refuse to sync rather than fabricate cross-tenant data.
      const emrOrgId = integration.emr_organization_id as number | null;
      const orgIsShared = sharedOrgIds.has(emrOrgId ?? -1);

      try {
        if (!emrOrgId) {
          logger.warn('Skipping campaign sync — client has no EMR organization', { clientId: integration.client_id });
          throw new SkipCampaigns();
        }
        if (orgIsShared) {
          logger.warn('Skipping campaign sync — client shares an EMR organization with other clients (would leak campaigns)', {
            clientId: integration.client_id,
            organizationId: emrOrgId,
          });
          throw new SkipCampaigns();
        }

        const campaigns = await fetchCampaigns(apiKey, emrOrgId);
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
        // A deliberate skip already logged its reason; don't double-log it as a failure.
        if (!(campaignErr instanceof SkipCampaigns)) {
          logger.warn('Failed to sync EMR campaigns', {
            clientId: integration.client_id,
            error: (campaignErr as Error).message,
          });
        }
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
