import { db } from '../db/connection';
import { config } from '../config';
import { logger } from '../utils/logger';

const GBP_ACCOUNTS_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const GBP_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const GBP_REVIEWS_BASE = 'https://mybusiness.googleapis.com/v4';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GBPReviewer {
  profilePhotoUrl?: string;
  displayName: string;
  isAnonymous?: boolean;
}

interface GBPReviewReply {
  comment: string;
  updateTime: string;
}

interface GBPReview {
  reviewId: string;
  reviewer: GBPReviewer;
  starRating: string;
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: GBPReviewReply;
}

interface GBPReviewsResponse {
  reviews?: GBPReview[];
  nextPageToken?: string;
}

interface GBPLocation {
  name: string;
  title?: string;
}

interface GBPLocationsResponse {
  locations?: GBPLocation[];
  nextPageToken?: string;
}

interface GBPAccount {
  name: string;
  accountName?: string;
}

interface GBPAccountsResponse {
  accounts?: GBPAccount[];
  nextPageToken?: string;
}

/**
 * Thrown when Google rejects our OAuth credentials themselves — a revoked/expired
 * refresh token, or a client-credential mismatch after an OAuth credential rotation
 * (Google returns `unauthorized_client`/`invalid_grant`). These will keep failing on
 * every retry until the user reconnects Google, so callers should stop retrying and
 * flag the integration for reconnect — unlike transient 5xx/network errors.
 */
export class GBPAuthError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = 'GBPAuthError';
    this.httpStatus = httpStatus;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const body = new URLSearchParams({
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    // 400 (invalid_grant) / 401 (unauthorized_client) mean the refresh token can't be
    // used with our current credentials — permanent until the user reconnects.
    if (res.status === 400 || res.status === 401) {
      throw new GBPAuthError(`Token refresh failed (${res.status}): ${text}`, res.status);
    }
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as TokenRefreshResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  return { accessToken: data.access_token, expiresAt };
}

async function getAccounts(accessToken: string): Promise<GBPAccount[]> {
  const accounts: GBPAccount[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GBP_ACCOUNTS_BASE}/accounts`);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw new GBPAuthError(`GBP accounts fetch failed (${res.status}): ${text}`, res.status);
      }
      throw new Error(`GBP accounts fetch failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as GBPAccountsResponse;
    if (data.accounts) accounts.push(...data.accounts);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return accounts;
}

async function getLocations(accountName: string, accessToken: string): Promise<GBPLocation[]> {
  const locations: GBPLocation[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GBP_INFO_BASE}/${accountName}/locations`);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('readMask', 'name,title');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw new GBPAuthError(`GBP locations fetch failed (${res.status}): ${text}`, res.status);
      }
      throw new Error(`GBP locations fetch failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as GBPLocationsResponse;
    if (data.locations) locations.push(...data.locations);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return locations;
}

async function getReviews(locationName: string, accessToken: string): Promise<GBPReview[]> {
  const reviews: GBPReview[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GBP_REVIEWS_BASE}/${locationName}/reviews`);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw new GBPAuthError(`GBP reviews fetch failed (${res.status}): ${text}`, res.status);
      }
      throw new Error(`GBP reviews fetch failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as GBPReviewsResponse;
    if (data.reviews) reviews.push(...data.reviews);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return reviews;
}

export async function syncGBPReviews(
  clientId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
): Promise<void> {
  let token = accessToken;

  // Refresh if expired or within 60 seconds of expiry
  const needsRefresh = expiresAt !== null && expiresAt.getTime() - Date.now() < 60_000;
  if (needsRefresh && refreshToken) {
    logger.info('GBP token near expiry, refreshing', { clientId });
    const refreshed = await refreshAccessToken(refreshToken);
    token = refreshed.accessToken;

    await db('integrations')
      .where({ client_id: clientId, provider: 'google' })
      .update({
        oauth_access_token: token,
        oauth_expires_at: refreshed.expiresAt,
      });

    logger.info('GBP token refreshed', { clientId });
  }

  const accounts = await getAccounts(token);
  if (accounts.length === 0) {
    logger.warn('No GBP accounts found', { clientId });
    return;
  }

  const now = new Date();
  let totalReviews = 0;

  for (const account of accounts) {
    const locations = await getLocations(account.name, token);

    for (const location of locations) {
      const reviews = await getReviews(location.name, token);

      for (const review of reviews) {
        const rating = STAR_RATING_MAP[review.starRating] ?? 0;

        await db('reviews')
          .insert({
            client_id: clientId,
            location_id: null,
            source: 'gbp',
            platform: 'google',
            external_review_id: review.reviewId,
            author_name: review.reviewer.displayName,
            rating,
            body: review.comment ?? null,
            sentiment: null,
            status: 'new',
            review_date: new Date(review.createTime),
            ingested_at: now,
            platform_url: null,
            replied: !!review.reviewReply,
            reply_date: review.reviewReply ? new Date(review.reviewReply.updateTime) : null,
            emr_reply_text: null,
            hidden: false,
            avatar_url: review.reviewer.profilePhotoUrl ?? null,
            verified: null,
          })
          .onConflict(['client_id', 'platform', 'external_review_id'])
          .merge({
            author_name: review.reviewer.displayName,
            rating,
            body: review.comment ?? null,
            platform_url: null,
            replied: !!review.reviewReply,
            reply_date: review.reviewReply ? new Date(review.reviewReply.updateTime) : null,
            avatar_url: review.reviewer.profilePhotoUrl ?? null,
            ingested_at: now,
          });

        totalReviews++;
      }
    }
  }

  logger.info('GBP reviews synced', { clientId, totalReviews });
}
