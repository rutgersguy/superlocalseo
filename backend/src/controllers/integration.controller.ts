import { z } from 'zod';
import { resolveProviderRoute, withProviderRoute } from '../services/provider_routing';
import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok, noContent, notFound, err } from '../utils/response';
import { config } from '../config';
import { logger } from '../utils/logger';
import { createConnectLink, listConnectLinks } from '../services/embedmyreviews.service';
import { ensureEmrLocation, provisionClient } from '../services/emr_provisioning';
import { createHmac, timingSafeEqual } from 'crypto';
import { checkGBPConnection } from '../services/gbp.service';
import { connectionState, safeConnectUrl } from '../services/emr_connection_state';
import { redis } from '../db/redis';

function selectedLocation(req: Request): string | undefined {
  return z.string().uuid().optional().parse(req.body?.locationId ?? req.query.locationId);
}

export async function getEmrGoogleConnectLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!config.embedmyreviews.apiKey) { err(res, 'Review connection is temporarily unavailable', 503, 'NOT_CONFIGURED'); return; }
    const clientId = req.clientId;
    const route = await resolveProviderRoute(clientId, selectedLocation(req));
    const locationId = route ? Number(route.providerLocationId) : null;
    if (!locationId) {
      const pending = await db('clients').where({ id: clientId }).first();
      if (pending?.emr_provisioning_status === 'creating' || pending?.emr_organization_id || pending?.emr_location_id) {
        ok(res, { phase: 'needs_attention', profileSelected: false, reviewCount: null, lastSyncAt: null, connectUrl: null }); return;
      }
      ok(res, { phase: 'needs_setup', profileSelected: false, reviewCount: null, lastSyncAt: null, connectUrl: null }); return; }
    // Short server cache avoids downloading all reviews every time the UI polls.
    const cacheKey = `emr:connect-state:${clientId}:${locationId}${route?.revision ? ':' + route.revision : ''}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    let links = cached ? JSON.parse(cached) : null;
    if (!links) {
      links = await listConnectLinks(config.embedmyreviews.apiKey, locationId, 'google');
      await redis.setex(cacheKey, 30, JSON.stringify(links)).catch(() => undefined);
    }
    const state = connectionState(links);
    const integration = await db('integrations').where({ client_id: clientId, provider: 'embedmyreviews' }).first();
    const row = await db('reviews').where({ client_id: clientId, source: 'emr' }).modify(q => { if (route?.mode === 'explicit') q.where({ location_id: route.localLocationId, emr_provider_location_id: route.providerLocationId }); }).whereRaw('lower(platform) = ?', ['google']).count('* as n').first();
    const mapping = route?.mode === 'explicit' ? await db('provider_location_mappings').where({ location_id: route.localLocationId }).first() : null;
    const lastSyncAt = route?.mode === 'explicit' ? mapping?.last_review_sync_at ?? null : integration?.last_pull_at ?? null;
    ok(res, { ...state, mappingMode: route?.mode, localLocationId: route?.localLocationId, connected: state.profileSelected, connectedAt: state.selectedAt,
      connectUrl: state.connectUrl ? safeConnectUrl(state.connectUrl, config.embedmyreviews.baseUrl) : null,
      reviewCount: lastSyncAt || Number(row?.n) > 0 ? Number(row?.n ?? 0) : null,
      lastSyncAt, syncError: (route?.mode === 'explicit' ? mapping?.review_sync_error : integration?.error_message) ? 'The last review sync failed. Existing reviews are retained.' : null,
      checkedAt: new Date().toISOString() });
  } catch (e) { next(e); }
}

export async function createEmrGoogleConnectLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const key = config.embedmyreviews.apiKey;
    if (!key) { err(res, 'Review connection is temporarily unavailable', 503, 'NOT_CONFIGURED'); return; }
    // Check an existing mapping before provisioning; never silently relocate a shared account.
    let route = await resolveProviderRoute(req.clientId, selectedLocation(req));
    if (!route) { await ensureEmrLocation(req.clientId); route = await resolveProviderRoute(req.clientId, selectedLocation(req)); }
    const locationId = route ? Number(route.providerLocationId) : null;
    if (!locationId) { err(res, 'Unable to prepare your review connection', 503); return; }
    // Serializing link creation avoids invalidating the link returned to a concurrent caller.
    const link = await withProviderRoute(route!, async trx => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`emr-connect:${req.clientId}`]);
      const links = await listConnectLinks(key, locationId, 'google');
      const active = connectionState(links).connectUrl;
      if (active) return links.find(l => l.connectUrl === active)!;
      return createConnectLink(key, 'google', locationId);
    });
    await redis.del(`emr:connect-state:${req.clientId}:${locationId}${route?.revision ? ':' + route.revision : ''}`).catch(() => undefined);
    ok(res, { connectUrl: safeConnectUrl(link.connectUrl, config.embedmyreviews.baseUrl), expiresAt: link.expiresAt });
  } catch (e) { next(e); }
}

/** Explicit, client-scoped retry. Never schedules other customers' provider work. */
export async function syncEmrGoogleReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const route = await resolveProviderRoute(req.clientId, selectedLocation(req));
    const locationId = route ? Number(route.providerLocationId) : null;
    if (!locationId) { err(res, 'Select your business through the Google connection first', 409, 'PROFILE_REQUIRED'); return; }
    const key = config.embedmyreviews.apiKey;
    if (!key) { err(res, 'Review connection is temporarily unavailable', 503); return; }
    const state = connectionState(await listConnectLinks(key, locationId, 'google'));
    if (!state.profileSelected) { err(res, 'Finish selecting your business before importing reviews', 409, 'PROFILE_REQUIRED'); return; }
    const cooldown = `emr:sync:${req.clientId}${route?.mode === 'explicit' ? ':' + route.localLocationId : ''}`;
    if (!(await redis.set(cooldown, '1', 'EX', 60, 'NX'))) {
      err(res, 'An import was requested recently. Please wait a minute before retrying.', 429, 'SYNC_PENDING'); return;
    }
    try {
      const source = await db('integrations').where({ client_id: req.clientId, provider: 'embedmyreviews', status: 'connected' }).whereNotNull('api_key_encrypted').first();
      if (!source) await provisionClient(req.clientId);
      const ready = await db('integrations').where({ client_id: req.clientId, provider: 'embedmyreviews', status: 'connected' }).whereNotNull('api_key_encrypted').first();
      if (!ready) throw Object.assign(new Error('Review import setup needs attention. Please contact support.'), { status: 409, code: 'CONNECTION_MAPPING_REQUIRED' });
      const { reviewsQueue } = await import('../jobs/queue');
      await reviewsQueue.add('google-connection-import', { clientId: req.clientId, locationId: route?.localLocationId ?? undefined, emrOnly: true }, { jobId: `google-import-${req.clientId}-${route?.localLocationId ?? 'legacy'}-${Math.floor(Date.now() / 60000)}`, removeOnComplete: 100, removeOnFail: 100 });
    } catch (e) { await redis.del(cooldown); throw e; }
    ok(res, { queued: true }, 202);
  } catch (e) { next(e); }
}

function formatIntegration(integration: Record<string, unknown>) {
  return {
    id: integration.id,
    provider: integration.provider,
    status: integration.status,
    lastPullAt: integration.last_pull_at,
    errorMessage: integration.error_message,
    externalAccountId: integration.external_account_id ?? null,
    externalAccountName: integration.external_account_name ?? null,
    createdAt: integration.created_at,
  };
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const integrations = await db('integrations').where({ client_id: req.clientId });
    ok(res, integrations.map((i) => formatIntegration(i as Record<string, unknown>)));
  } catch (e) {
    next(e);
  }
}

export async function getGoogleAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientId = config.google?.clientId;
    if (!clientId) {
      err(res, 'Google OAuth not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    const redirectUri = `${config.appUrl}/api/integrations/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GBP_SCOPE,
      access_type: 'offline',
      // Forces the consent screen every time, which is what makes Google return
      // a refresh_token. Without one the connection works until the first
      // access token expires (~1h) and then dies silently — which is precisely
      // the state the existing integration row is in: connected once, no
      // refresh token, "authorization expired" ever since.
      prompt: 'consent',
      state: signState(String(req.clientId)),
    });

    ok(res, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (e) {
    next(e);
  }
}

const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

/**
 * Signs the OAuth `state` so the callback cannot be driven with an arbitrary
 * client id.
 *
 * `state` previously carried the raw client id and was trusted on the way back,
 * which made it an instruction from the URL rather than from us. Signing it
 * keeps the round-trip meaningful without needing server-side storage.
 */
function signState(clientId: string): string {
  const mac = createHmac('sha256', config.jwt.secret).update(clientId).digest('hex').slice(0, 32);
  return `${clientId}.${mac}`;
}

function verifyState(state: string): string | null {
  const idx = state.lastIndexOf('.');
  if (idx < 0) return null;
  const clientId = state.slice(0, idx);
  const mac = state.slice(idx + 1);
  const expected = createHmac('sha256', config.jwt.secret).update(clientId).digest('hex').slice(0, 32);
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  if (mac.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? clientId : null;
}

export async function googleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      err(res, 'Missing OAuth parameters', 400, 'INVALID_CALLBACK');
      return;
    }

    const clientId = verifyState(state);
    if (!clientId) {
      err(res, 'Invalid OAuth state', 400, 'INVALID_CALLBACK');
      return;
    }
    const clientSecret = config.google?.clientSecret;
    const googleClientId = config.google?.clientId;
    if (!googleClientId || !clientSecret) {
      err(res, 'Google OAuth not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    const redirectUri = `${config.appUrl}/api/integrations/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      logger.error('Google OAuth token exchange failed', { status: tokenRes.status });
      err(res, 'OAuth token exchange failed', 502, 'OAUTH_ERROR');
      return;
    }

    const tokens = await tokenRes.json() as {
      access_token: string; refresh_token?: string; expires_in: number; scope?: string;
    };
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokens.expires_in * 1000);

    const existing = await db('integrations').where({ client_id: clientId, provider: 'google' }).first();

    // OAuth SUCCESS IS NOT SCOPE GRANTED.
    //
    // Google's consent screen lets the user untick "See, edit, create and delete
    // your Business Profile" and still complete sign-in. The token exchange then
    // succeeds and every Business Profile call afterwards fails. We watched
    // exactly this happen through EMR (confirmed by their support, 2026-07-16):
    // a client finished consent, the flag was stamped, no profile was ever
    // attached and no review ever synced.
    //
    // The token response says which scopes were actually granted, so refuse the
    // connection here rather than storing a green status on something that
    // cannot work.
    const granted = (tokens.scope ?? '').split(' ');
    if (!granted.includes(GBP_SCOPE)) {
      const message = 'Google sign-in completed but Business Profile permission was not granted. '
        + 'Reconnect and leave the "See, edit, create and delete your Business Profile" box ticked.';
      if (existing) {
        await db('integrations').where({ id: existing.id })
          .update({ status: 'disconnected', error_message: message, updated_at: now });
      }
      res.redirect(`${config.appUrl}/dashboard/settings?tab=integrations&google_error=scope`);
      return;
    }

    // No refresh token means the connection expires within the hour and cannot
    // renew. Better to fail now, loudly, than in an hour, silently.
    const refreshToken = tokens.refresh_token ?? (existing?.oauth_refresh_token as string | undefined);
    if (!refreshToken) {
      if (existing) {
        await db('integrations').where({ id: existing.id }).update({
          status: 'disconnected',
          error_message: 'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions, then reconnect.',
          updated_at: now,
        });
      }
      res.redirect(`${config.appUrl}/dashboard/settings?tab=integrations&google_error=no_refresh`);
      return;
    }

    if (existing) {
      await db('integrations').where({ id: existing.id }).update({
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: refreshToken,
        oauth_expires_at: expiresAt,
        status: 'connected',
        error_message: null,
        updated_at: now,
      });
    } else {
      await db('integrations').insert({
        client_id: clientId,
        provider: 'google',
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: refreshToken,
        oauth_expires_at: expiresAt,
        status: 'connected',
        created_at: now,
        updated_at: now,
      });
    }

    res.redirect(`${config.appUrl}/dashboard/settings?tab=integrations&connected=google`);
  } catch (e) {
    next(e);
  }
}

export async function getFacebookAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const appId = config.facebook?.appId;
    if (!appId) {
      err(res, 'Facebook OAuth not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    const redirectUri = `${config.appUrl}/api/integrations/facebook/callback`;
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: 'pages_read_engagement,pages_read_user_content,pages_show_list',
      response_type: 'code',
      state: String(req.clientId),
    });

    ok(res, { url: `https://www.facebook.com/dialog/oauth?${params.toString()}` });
  } catch (e) {
    next(e);
  }
}

export async function facebookCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      err(res, 'Missing OAuth parameters', 400, 'INVALID_CALLBACK');
      return;
    }

    const clientId = state;
    const appId = config.facebook?.appId;
    const appSecret = config.facebook?.appSecret;
    if (!appId || !appSecret) {
      err(res, 'Facebook OAuth not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    const redirectUri = `${config.appUrl}/api/integrations/facebook/callback`;
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }).toString(),
    );

    if (!tokenRes.ok) {
      logger.error('Facebook OAuth token exchange failed', { status: tokenRes.status });
      err(res, 'OAuth token exchange failed', 502, 'OAUTH_ERROR');
      return;
    }

    const tokens = await tokenRes.json() as { access_token: string; expires_in?: number };

    // Exchange short-lived token for long-lived token
    const llRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: tokens.access_token,
      }).toString(),
    );
    const llTokens = llRes.ok ? await llRes.json() as { access_token: string; expires_in?: number } : tokens;
    const accessToken = llTokens.access_token;

    // Fetch user's pages to find the primary page
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${encodeURIComponent(accessToken)}`,
    );
    const pagesData = pagesRes.ok
      ? await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string }> }
      : { data: [] };

    const page = pagesData.data?.[0];
    const pageAccessToken = page?.access_token ?? accessToken;
    const pageId = page?.id ?? null;
    const pageName = page?.name ?? null;

    const now = new Date();
    const expiresAt = llTokens.expires_in ? new Date(now.getTime() + llTokens.expires_in * 1000) : null;

    const existing = await db('integrations').where({ client_id: clientId, provider: 'facebook' }).first();
    if (existing) {
      await db('integrations').where({ id: existing.id }).update({
        oauth_access_token: pageAccessToken,
        oauth_expires_at: expiresAt,
        external_account_id: pageId,
        external_account_name: pageName,
        status: 'connected',
        error_message: null,
        updated_at: now,
      });
    } else {
      await db('integrations').insert({
        client_id: clientId,
        provider: 'facebook',
        oauth_access_token: pageAccessToken,
        oauth_expires_at: expiresAt,
        external_account_id: pageId,
        external_account_name: pageName,
        status: 'connected',
        created_at: now,
        updated_at: now,
      });
    }

    res.redirect(`${config.appUrl}/dashboard/settings?tab=integrations&connected=facebook`);
  } catch (e) {
    next(e);
  }
}

export async function disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { provider } = req.params;

    const integration = await db('integrations').where({ client_id: req.clientId, provider }).first();
    if (!integration) {
      notFound(res, 'Integration not found');
      return;
    }

    await db('integrations')
      .where({ id: integration.id })
      .update({ status: 'disconnected', oauth_access_token: null, oauth_refresh_token: null, updated_at: new Date() });

    noContent(res);
  } catch (e) {
    next(e);
  }
}

/**
 * Live GBP connection status (#78/#82).
 *
 * Reports what Google actually returns, not what our database remembers. The
 * stored flag records only that a token exchange once succeeded; it cannot know
 * whether the scope was granted or the token still refreshes.
 */
export async function googleStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const row = await db('integrations')
      .where({ client_id: req.clientId, provider: 'google' })
      .first('status', 'error_message', 'oauth_refresh_token', 'oauth_expires_at', 'updated_at');

    if (!row) {
      ok(res, { connected: false, checked: false, accounts: 0, locations: [], error: null, storedStatus: null });
      return;
    }

    const check = await checkGBPConnection(req.clientId as string);
    ok(res, {
      connected: check.reachable,
      checked: true,
      accounts: check.accounts,
      locations: check.locations,
      error: check.error,
      storedStatus: row.status,
      hasRefreshToken: !!row.oauth_refresh_token,
      lastUpdatedAt: row.updated_at,
    });
  } catch (e) {
    next(e);
  }
}
