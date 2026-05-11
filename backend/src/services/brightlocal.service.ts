import { config } from '../config';
import { logger } from '../utils/logger';

// ─── Legacy Management API (tools.brightlocal.com) ───────────────────────────
// Used by citations, audit, reputation, geo-grid until Harry confirms Data API
// equivalents. Rankings has been migrated to the Data API below.

const MGMT_BASE_URL = 'https://tools.brightlocal.com/seo-tools/api';

async function blFetch(path: string, apiKey: string, options: RequestInit = {}): Promise<Response> {
  const url = `${MGMT_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const res = await fetch(url, { ...options, headers });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '10', 10);
      logger.warn('BrightLocal rate limited, backing off', { retryAfter });
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempts++;
      continue;
    }

    return res;
  }

  throw new Error('BrightLocal: max retry attempts exceeded after rate limiting');
}

function assertApiKey(key: string): void {
  if (!key) {
    const err = new Error('BrightLocal API key is not configured') as Error & { code: string };
    err.code = 'BRIGHTLOCAL_NOT_CONFIGURED';
    throw err;
  }
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await blFetch('/v4/clients/search', apiKey);
    return res.status === 200;
  } catch (e) {
    logger.warn('BrightLocal validateApiKey error', { error: (e as Error).message });
    return false;
  }
}

// ─── Data API (api.brightlocal.com) ──────────────────────────────────────────
// Rankings endpoint: POST /data/v1/rankings/search
// Auth: x-api-key header (platform key, no per-client key needed)

const DATA_API_BASE = 'https://api.brightlocal.com';

async function blDataFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const res = await fetch(`${DATA_API_BASE}${path}`, {
      ...options,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '10', 10);
      logger.warn('BrightLocal Data API rate limited, backing off', { retryAfter });
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempts++;
      continue;
    }

    return res;
  }

  throw new Error('BrightLocal Data API: max retry attempts exceeded after rate limiting');
}

export type RankingSearchEngine = 'google' | 'google-mobile' | 'google-local-finder' | 'bing' | 'bing-local';

export async function createRankingRequest(params: {
  keyword: string;
  searchEngine: RankingSearchEngine;
  geoLocation?: string;                        // city string — either this OR coordinates
  coordinates?: { lat: number; lng: number };  // for geo-grid points
  country?: string;
  websiteUrl?: string | null;
  businessName?: string;
  phone?: string | null;
  postcode?: string | null;
}): Promise<string> {
  const body: Record<string, unknown> = {
    search_engine: params.searchEngine,
    search_term: params.keyword,
    country: params.country ?? 'USA',
    geo_location: params.coordinates ? { coordinates: params.coordinates } : { name: params.geoLocation ?? '' },
    num_results: 50,
  };

  const matchCriteria: Record<string, unknown> = {};
  if (params.websiteUrl) matchCriteria.website_urls = [params.websiteUrl];

  const nap: Record<string, unknown> = {};
  if (params.businessName) nap.names = [params.businessName];
  if (params.phone) nap.telephone = params.phone;
  if (params.postcode) nap.postcode = params.postcode;
  if (Object.keys(nap).length) matchCriteria.nap = nap;

  if (Object.keys(matchCriteria).length) body.match_criteria = matchCriteria;

  const res = await blDataFetch('/data/v1/rankings/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal createRankingRequest failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { request_id?: string };
  if (!data.request_id) throw new Error('BrightLocal createRankingRequest: no request_id in response');
  return data.request_id;
}

export interface RankingRequestResult {
  ready: boolean;
  success: boolean;
  keyword: string;
  searchEngine: string;
  rank: number | null;
  url: string | null;
  rankType: 'organic' | 'local_pack' | null;
}

export async function fetchRankingResult(requestId: string): Promise<RankingRequestResult> {
  const res = await blDataFetch(`/data/v1/rankings/results/${encodeURIComponent(requestId)}`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal fetchRankingResult failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    ready?: boolean;
    success?: boolean;
    request_payload?: { search_term?: string; search_engine?: string };
    rankings?: {
      local?: Array<{ rank: number; serp?: { website_url?: string } }>;
      organic?: Array<{ rank: number; serp?: { website_url?: string } }>;
    };
  };

  const keyword = data.request_payload?.search_term ?? '';
  const searchEngine = data.request_payload?.search_engine ?? '';

  if (!data.ready) {
    return { ready: false, success: false, keyword, searchEngine, rank: null, url: null, rankType: null };
  }

  const localMatch = data.rankings?.local?.[0];
  const organicMatch = data.rankings?.organic?.[0];

  if (localMatch) {
    return { ready: true, success: data.success ?? false, keyword, searchEngine, rank: localMatch.rank, url: localMatch.serp?.website_url ?? null, rankType: 'local_pack' };
  }
  if (organicMatch) {
    return { ready: true, success: data.success ?? false, keyword, searchEngine, rank: organicMatch.rank, url: organicMatch.serp?.website_url ?? null, rankType: 'organic' };
  }

  return { ready: true, success: data.success ?? false, keyword, searchEngine, rank: null, url: null, rankType: null };
}

// ─── Listings Data API (api.brightlocal.com) ──────────────────────────────────

export interface ListingProfile {
  title?: string;
  urls?: { profile?: string };
  nap?: { address?: string; telephone?: string };
  is_claimed?: boolean;
  reviews?: { count?: number; rating?: number };
  photos?: { count?: number };
  categories?: string[];
}

export interface ListingFindResult {
  ready: boolean;
  success: boolean;
  profile: ListingProfile;
}

export async function createListingFindRequest(params: {
  businessNames: string[];
  country: string;
  region?: string | null;
  city?: string | null;
  postcode?: string | null;
  directory: string;
  telephone?: string | null;
  streetAddress?: string | null;
}): Promise<string> {
  const body: Record<string, unknown> = {
    business_names: params.businessNames,
    country: params.country,
    directory: params.directory,
  };
  if (params.region) body.region = params.region;
  if (params.city) body.city = params.city;
  if (params.postcode) body.postcode = params.postcode;
  if (params.telephone) body.telephone = params.telephone;
  if (params.streetAddress) body.street_address = params.streetAddress;

  const res = await blDataFetch('/data/v1/listings/find', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal createListingFindRequest failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { request_id?: string };
  if (!data.request_id) throw new Error('BrightLocal createListingFindRequest: no request_id');
  return data.request_id;
}

export async function fetchListingFindResult(requestId: string): Promise<ListingFindResult> {
  const res = await blDataFetch(`/data/v1/listings/results/${encodeURIComponent(requestId)}`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal fetchListingFindResult failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    ready?: boolean;
    success?: boolean;
    profile?: {
      title?: string;
      urls?: { profile?: string };
      nap?: { address?: string; telephone?: string };
      is_claimed?: boolean;
      reviews?: { count?: number; rating?: number };
      photos?: { count?: number };
      categories?: string[];
    };
  };

  return {
    ready: data.ready ?? false,
    success: data.success ?? false,
    profile: data.profile ?? {},
  };
}

// ─── Citations (Management API — pending Harry's response on Data API equiv.) ─

export interface BLCitationResult {
  directory: string;
  listed: boolean;
  napMatch: boolean;
  listingUrl: string | null;
  napDetail?: {
    nameMatch: boolean;
    addressMatch: boolean;
    phoneMatch: boolean;
    listedName?: string;
    listedAddress?: string;
    listedPhone?: string;
  };
}

export async function fetchCitations(campaignId: string): Promise<BLCitationResult[]> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);

  const res = await blFetch(`/v4/citations/get-latest?campaign_id=${encodeURIComponent(campaignId)}`, apiKey);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal fetchCitations failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { response?: { citations?: Array<{ directory: string; listed: boolean; nap_match: boolean; listing_url: string | null; nap_detail?: { name_match?: boolean; address_match?: boolean; phone_match?: boolean; listed_name?: string; listed_address?: string; listed_phone?: string } }> } };
  const citations = data?.response?.citations ?? [];

  return citations.map((c) => ({
    directory: c.directory,
    listed: c.listed,
    napMatch: c.nap_match,
    listingUrl: c.listing_url,
    napDetail: c.nap_detail ? {
      nameMatch: c.nap_detail.name_match ?? true,
      addressMatch: c.nap_detail.address_match ?? true,
      phoneMatch: c.nap_detail.phone_match ?? true,
      listedName: c.nap_detail.listed_name,
      listedAddress: c.nap_detail.listed_address,
      listedPhone: c.nap_detail.listed_phone,
    } : undefined,
  }));
}

// ─── Local Search Audit (Management API — pending Harry's response) ───────────

export async function createAuditReport(campaignId: string): Promise<{ reportId: string }> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);
  const res = await blFetch('/v4/lscu/create', apiKey, {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal createAuditReport failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { response?: { report_id?: string } };
  const reportId = data?.response?.report_id;
  if (!reportId) throw new Error('BrightLocal createAuditReport: no report_id in response');
  return { reportId };
}

export interface BLAuditResult {
  status: 'processing' | 'complete' | 'failed';
  scores?: { nap: number; citations: number; reviews: number; google: number; composite: number };
  recommendations?: string[];
  raw?: unknown;
}

export async function pollAuditReport(reportId: string): Promise<BLAuditResult> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);
  const res = await blFetch(`/v4/lscu/get?report_id=${encodeURIComponent(reportId)}`, apiKey);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal pollAuditReport failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    response?: {
      status?: string;
      nap_score?: number;
      citation_score?: number;
      review_score?: number;
      google_score?: number;
      composite_score?: number;
      recommendations?: string[];
      report_data?: unknown;
    };
  };
  const r = data?.response;
  if (!r) return { status: 'failed' };
  const statusMap: Record<string, BLAuditResult['status']> = { complete: 'complete', failed: 'failed' };
  const status = statusMap[r.status ?? ''] ?? 'processing';
  if (status !== 'complete') return { status };
  return {
    status: 'complete',
    scores: {
      nap: r.nap_score ?? 0,
      citations: r.citation_score ?? 0,
      reviews: r.review_score ?? 0,
      google: r.google_score ?? 0,
      composite: r.composite_score ?? 0,
    },
    recommendations: r.recommendations ?? [],
    raw: r.report_data,
  };
}

// ─── Reputation Manager (Management API — pending Harry's response) ────────────

export interface BLReview {
  blReviewId: string;
  platform: string;
  authorName: string;
  rating: number;
  body: string;
  reviewDate: string;
  replied: boolean;
  replyText?: string;
}

export async function fetchReputationReviews(
  campaignId: string,
  opts: { page?: number; status?: string } = {},
): Promise<{ reviews: BLReview[]; total: number }> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);
  const params = new URLSearchParams({ campaign_id: campaignId });
  if (opts.page) params.set('page', String(opts.page));
  if (opts.status) params.set('status', opts.status);
  const res = await blFetch(`/v4/rf/get-reviews?${params.toString()}`, apiKey);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal fetchReputationReviews failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    response?: {
      total?: number;
      reviews?: Array<{
        review_id: string;
        platform: string;
        reviewer_name?: string;
        rating: number;
        review_text?: string;
        review_date?: string;
        replied?: boolean;
        reply_text?: string;
      }>;
    };
  };
  const reviews = (data?.response?.reviews ?? []).map((r) => ({
    blReviewId: r.review_id,
    platform: r.platform,
    authorName: r.reviewer_name ?? 'Anonymous',
    rating: r.rating,
    body: r.review_text ?? '',
    reviewDate: r.review_date ?? '',
    replied: r.replied ?? false,
    replyText: r.reply_text,
  }));
  return { reviews, total: data?.response?.total ?? reviews.length };
}

export async function replyToReview(
  campaignId: string,
  blReviewId: string,
  replyText: string,
): Promise<{ success: boolean; replyId?: string }> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);
  const res = await blFetch('/v4/rf/reply', apiKey, {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId, review_id: blReviewId, reply_text: replyText }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal replyToReview failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { response?: { reply_id?: string; success?: boolean } };
  return { success: data?.response?.success ?? true, replyId: data?.response?.reply_id };
}

// ─── Citation Builder (Management API v1) ────────────────────────────────────
// Base: https://api.brightlocal.com/manage/v1/citation-builder
// Auth: x-api-key (same key as blDataFetch)
// Cost: credits deducted at Confirm step — cb10=$2/site, cb15=$2/site, ..., cb100=$2/site
//       Aggregator publishers: $30 each (dataaxle, neustar, foursquare, gpsnetwork, ypnetwork)
// Docs: https://developer.brightlocal.com/docs/management-apis/agjq3z0pfs6nk-citation-builder
//
// Flow:
//   1. createCbCampaign(blLocationId) → campaign_id
//   2. poll getCbCampaignLookup(campaign_id) until lookup_status === 'complete'
//   3. Present lookup citations to user; user picks package + domains + publishers
//   4. confirmCbCampaign(campaign_id, { packageId, citations, publishers, ... })
//   5. Track via getCbCampaign(campaign_id)

export type CbPackageId = 'cb0' | 'cb10' | 'cb15' | 'cb25' | 'cb30' | 'cb50' | 'cb75' | 'cb100';
export type CbPublisher = 'dataaxle' | 'neustar' | 'foursquare' | 'gpsnetwork' | 'ypnetwork' | 'locafynetwork';

export interface CbLookupCitation {
  domain: string;
  profileUrl: string;
  nap: { name?: string; address?: string; phone?: string; postcode?: string };
}

export interface CbLookupResult {
  lookupStatus: 'complete' | 'processing';
  lookupCompletedAt: string | null;
  citations: CbLookupCitation[];
}

export interface CbCampaignStatus {
  campaignId: string | number;
  status: string;
  locationId: number;
  citations: Array<{
    domain: string;
    status: string;
    listingUrl?: string;
    submittedAt?: string;
    liveAt?: string;
  }>;
}

export async function getCbCredits(): Promise<number> {
  const res = await blDataFetch('/manage/v1/citation-builder/credits');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal getCbCredits failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { credits?: number };
  return data.credits ?? 0;
}

export async function createCbCampaign(
  blLocationId: number,
  emailAlerts?: { enabled: boolean; addresses?: string[] },
): Promise<string> {
  const body: Record<string, unknown> = { location_id: blLocationId };
  if (emailAlerts) body.email_alerts = emailAlerts;

  const res = await blDataFetch('/manage/v1/citation-builder', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal createCbCampaign failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { campaign_id?: number };
  if (!data.campaign_id) throw new Error('BrightLocal createCbCampaign: no campaign_id in response');
  return String(data.campaign_id);
}

export async function getCbCampaignLookup(campaignId: string): Promise<CbLookupResult> {
  const res = await blDataFetch(`/manage/v1/citation-builder/${encodeURIComponent(campaignId)}/lookup`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal getCbCampaignLookup failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    lookup_status?: string;
    lookup_completed_at?: string;
    citations?: Array<{
      domain?: string;
      profile_url?: string;
      nap?: { name?: string; address?: string; phone?: string; postcode?: string };
    }>;
  };
  return {
    lookupStatus: (data.lookup_status as 'complete' | 'processing') ?? 'processing',
    lookupCompletedAt: data.lookup_completed_at ?? null,
    citations: (data.citations ?? []).map((c) => ({
      domain: c.domain ?? '',
      profileUrl: c.profile_url ?? '',
      nap: c.nap ?? {},
    })),
  };
}

export async function confirmCbCampaign(
  campaignId: string,
  opts: {
    packageId: CbPackageId;
    citations: string[];
    publishers: CbPublisher[];
    autoSelect?: boolean;
    removeDuplicates?: boolean;
    notes?: string;
    express?: boolean;
  },
): Promise<void> {
  const res = await blDataFetch(`/manage/v1/citation-builder/${encodeURIComponent(campaignId)}/confirm`, {
    method: 'PUT',
    body: JSON.stringify({
      package_id: opts.packageId,
      citations: opts.citations,
      publishers: opts.publishers,
      auto_select: opts.autoSelect ?? false,
      remove_duplicates: opts.removeDuplicates ?? false,
      notes: opts.notes,
      express: opts.express ?? false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal confirmCbCampaign failed: ${res.status} ${text}`);
  }
}

export async function getCbCampaign(campaignId: string, page = 1): Promise<CbCampaignStatus> {
  const res = await blDataFetch(
    `/manage/v1/citation-builder/${encodeURIComponent(campaignId)}?page=${page}`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BrightLocal getCbCampaign failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    campaign_id?: number;
    status?: string;
    location_id?: number;
    citations?: Array<{
      domain?: string;
      status?: string;
      listing_url?: string;
      submitted_at?: string;
      live_at?: string;
    }>;
  };
  return {
    campaignId: data.campaign_id ?? campaignId,
    status: data.status ?? 'unknown',
    locationId: data.location_id ?? 0,
    citations: (data.citations ?? []).map((c) => ({
      domain: c.domain ?? '',
      status: c.status ?? '',
      listingUrl: c.listing_url,
      submittedAt: c.submitted_at,
      liveAt: c.live_at,
    })),
  };
}
