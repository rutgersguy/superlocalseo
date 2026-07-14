import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok, noContent, notFound, err } from '../utils/response';
import { config } from '../config';
import { logger } from '../utils/logger';
import { createConnectLink, listConnectLinks } from '../services/embedmyreviews.service';
import { ensureEmrLocation } from '../services/emr_provisioning';

/**
 * GET  /integrations/emr/google/connect-link — status of the client's Google connection
 * POST /integrations/emr/google/connect-link — mint a fresh branded OAuth link
 *
 * This is how a client connects Google now. It replaces two dead ends:
 *   - our own Google OAuth, inert while our GBP API quota request is pending at Google;
 *   - "log into the review portal", which attaches the profile to the client's EMR
 *     sub-account org — data our agency key cannot read.
 *
 * EMR holds its own approved Google Business Profile API access, so the client consents to
 * EMR's Google project rather than ours, and the reviews land on OUR location (which we can
 * read). The link lives on app.superlocalseo.com, so no EMR branding is visible.
 */
async function loadEmrConnectState(clientId: string) {
  const operatorKey = config.embedmyreviews.apiKey;
  if (!operatorKey) return null;

  const locationId = await ensureEmrLocation(clientId);
  if (!locationId) return null;

  const links = await listConnectLinks(operatorKey, locationId, 'google');
  // A completed OAuth is the signal that Google is actually linked to this location.
  const completed = links.find((l) => l.completedOauthAt !== null);
  const active = links.find((l) => l.status === 'active');

  return { operatorKey, locationId, links, completed, active };
}

export async function getEmrGoogleConnectLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const state = await loadEmrConnectState(req.clientId as string);
    if (!state) {
      err(res, 'Review platform is not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    ok(res, {
      connected: !!state.completed,
      connectedAt: state.completed?.completedOauthAt ?? null,
      connectUrl: state.active?.connectUrl ?? null,
      expiresAt: state.active?.expiresAt ?? null,
    });
  } catch (e) {
    next(e);
  }
}

export async function createEmrGoogleConnectLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const state = await loadEmrConnectState(req.clientId as string);
    if (!state) {
      err(res, 'Review platform is not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    if (state.completed) {
      ok(res, { connected: true, connectedAt: state.completed.completedOauthAt, connectUrl: null });
      return;
    }

    // EMR allows one active link per (location, provider) and auto-revokes the previous on
    // re-issue, so minting again is safe and always hands back a usable URL.
    const link = await createConnectLink(state.operatorKey, 'google', state.locationId);

    logger.info('EMR Google connect link minted', {
      clientId: req.clientId,
      locationId: state.locationId,
      expiresAt: link.expiresAt,
    });

    ok(res, { connected: false, connectUrl: link.connectUrl, expiresAt: link.expiresAt });
  } catch (e) {
    next(e);
  }
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
    const scopes = [
      'https://www.googleapis.com/auth/business.manage',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state: String(req.clientId),
    });

    ok(res, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (e) {
    next(e);
  }
}

export async function googleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      err(res, 'Missing OAuth parameters', 400, 'INVALID_CALLBACK');
      return;
    }

    const clientId = state;
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

    const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokens.expires_in * 1000);

    const existing = await db('integrations').where({ client_id: clientId, provider: 'google' }).first();

    if (existing) {
      await db('integrations').where({ id: existing.id }).update({
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: tokens.refresh_token ?? existing.oauth_refresh_token,
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
        oauth_refresh_token: tokens.refresh_token,
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
