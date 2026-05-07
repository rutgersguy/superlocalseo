import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok, noContent, notFound, err } from '../utils/response';
import { config } from '../config';
import { logger } from '../utils/logger';

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
