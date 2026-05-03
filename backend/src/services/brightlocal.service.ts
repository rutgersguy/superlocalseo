import { config } from '../config';
import { logger } from '../utils/logger';

const BASE_URL = 'https://tools.brightlocal.com/seo-tools/api';

export interface BLRankingResult {
  keyword: string;
  rank: number | null;
  url: string | null;
  searchEngine: 'google' | 'bing';
  rankType: 'organic' | 'local_pack' | 'paid';
}

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

async function blFetch(path: string, apiKey: string, options: RequestInit = {}): Promise<Response> {
  const url = `${BASE_URL}${path}`;
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

// v2 API uses api-key as query param (not Bearer header) and multipart form data
async function blV2Post(path: string, apiKey: string, fields: Record<string, string | string[]>): Promise<Response> {
  const url = `${BASE_URL}${path}?api-key=${encodeURIComponent(apiKey)}`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      v.forEach((item) => form.append(`${k}[]`, item));
    } else {
      form.append(k, v);
    }
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

async function blV2Get(path: string, apiKey: string, params?: Record<string, string>): Promise<Response> {
  const qs = new URLSearchParams({ 'api-key': apiKey, ...params });
  return fetch(`${BASE_URL}${path}?${qs.toString()}`);
}

function assertApiKey(key: string): void {
  if (!key) {
    const err = new Error('BrightLocal API key is not configured') as Error & { code: string };
    err.code = 'BRIGHTLOCAL_NOT_CONFIGURED';
    throw err;
  }
}

export async function fetchRankings(campaignId: string): Promise<BLRankingResult[]> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);

  const res = await blFetch(`/v4/rankings/get-latest?campaign_id=${encodeURIComponent(campaignId)}`, apiKey);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal fetchRankings failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { response?: { results?: Array<{ keyword: string; rank: number | null; url: string | null; search_engine: string; rank_type?: string }> } };
  const results = data?.response?.results ?? [];

  return results.map((r) => ({
    keyword: r.keyword,
    rank: r.rank,
    url: r.url,
    searchEngine: r.search_engine === 'bing' ? 'bing' : 'google',
    rankType: (r.rank_type === 'local_pack' || r.rank_type === 'paid') ? r.rank_type : 'organic',
  }));
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

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await blFetch('/v4/clients/search', apiKey);
    return res.status === 200;
  } catch (e) {
    logger.warn('BrightLocal validateApiKey error', { error: (e as Error).message });
    return false;
  }
}

// ─── BL-2: Local Search Audit ─────────────────────────────────────────────────

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

// ─── BL-3: Reputation Manager ─────────────────────────────────────────────────

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

// ─── BL-1: Geo-Grid ───────────────────────────────────────────────────────────

export interface GridPoint {
  lat: number;
  lng: number;
  rank: number | null;
  url: string | null;
}

export async function createGeoGridReport(
  campaignId: string,
  keyword: string,
  lat: number,
  lng: number,
  gridSize: 7 | 13 = 7,
): Promise<{ reportId: string }> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);
  const res = await blFetch('/v4/gpw/create', apiKey, {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId, keyword, lat, lng, grid_size: gridSize }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal createGeoGridReport failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { response?: { report_id?: string } };
  const reportId = data?.response?.report_id;
  if (!reportId) throw new Error('BrightLocal createGeoGridReport: no report_id in response');
  return { reportId };
}

export async function pollGeoGridReport(reportId: string): Promise<{
  status: 'processing' | 'complete' | 'failed';
  grid?: GridPoint[];
}> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);
  const res = await blFetch(`/v4/gpw/get?report_id=${encodeURIComponent(reportId)}`, apiKey);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal pollGeoGridReport failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    response?: {
      status?: string;
      grid?: Array<{ lat: number; lng: number; rank: number | null; url: string | null }>;
    };
  };
  const r = data?.response;
  if (!r) return { status: 'failed' };
  const statusMap: Record<string, 'processing' | 'complete' | 'failed'> = { complete: 'complete', failed: 'failed' };
  const status = statusMap[r.status ?? ''] ?? 'processing';
  if (status !== 'complete') return { status };
  return { status: 'complete', grid: r.grid ?? [] };
}

// ─── BL-4: Citation Builder ───────────────────────────────────────────────────

export interface SubmissionStatus {
  directory: string;
  status: 'pending' | 'submitted' | 'live' | 'rejected' | 'duplicate';
  listingUrl?: string;
  rejectionReason?: string;
}

export async function submitCitations(
  campaignId: string,
  directories: string[],
): Promise<{ jobId: string }> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);
  const res = await blFetch('/v4/cb/create', apiKey, {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId, directories }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal submitCitations failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { response?: { job_id?: string } };
  const jobId = data?.response?.job_id;
  if (!jobId) throw new Error('BrightLocal submitCitations: no job_id in response');
  return { jobId };
}

export async function getCitationSubmissions(jobId: string): Promise<SubmissionStatus[]> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);
  const res = await blFetch(`/v4/cb/get?job_id=${encodeURIComponent(jobId)}`, apiKey);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal getCitationSubmissions failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    response?: {
      submissions?: Array<{
        directory: string;
        status: string;
        listing_url?: string;
        rejection_reason?: string;
      }>;
    };
  };
  return (data?.response?.submissions ?? []).map((s) => ({
    directory: s.directory,
    status: (s.status as SubmissionStatus['status']) ?? 'pending',
    listingUrl: s.listing_url,
    rejectionReason: s.rejection_reason,
  }));
}

// ─── BL-5: Campaign Management ────────────────────────────────────────────────

export interface BLLocationInput {
  name: string;
  url: string;
  address1: string;
  city: string;
  region: string;
  postcode: string;
  telephone: string;
  country?: string;
  businessCategoryId?: number;
}

export async function createBrightLocalLocation(input: BLLocationInput): Promise<number> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);

  const locationRef = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
    + '-' + Date.now().toString(36);

  const res = await blV2Post('/v2/clients-and-locations/locations/', apiKey, {
    name: input.name,
    url: input.url || 'http://example.com',
    'business-category-id': String(input.businessCategoryId ?? 605),
    country: input.country ?? 'USA',
    address1: input.address1,
    city: input.city,
    region: input.region,
    postcode: input.postcode,
    telephone: input.telephone,
    'location-reference': locationRef,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BrightLocal createLocation failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { 'location-id'?: number; success?: boolean; errors?: unknown };
  const locationId = data['location-id'];
  if (!locationId) {
    throw new Error(`BrightLocal createLocation: no location-id in response: ${JSON.stringify(data)}`);
  }
  return locationId;
}

export async function createLsrcCampaign(params: {
  name: string;
  locationId: number;
  googleLocation: string;
  keywords: string[];
  country?: string;
}): Promise<string> {
  const apiKey = config.brightlocal.apiKey;
  assertApiKey(apiKey);

  const res = await blV2Post('/v2/lsrc/add', apiKey, {
    name: params.name,
    country: params.country ?? 'USA',
    language: 'en',
    'google-location': params.googleLocation,
    'location-id': String(params.locationId),
    'time-zone': '3',
    'search-engines': ['google', 'google-local'],
    keywords: params.keywords,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BrightLocal createLsrcCampaign failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { 'campaign-id'?: string | number; success?: boolean; errors?: Record<string, string> };

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`BrightLocal createLsrcCampaign validation error: ${JSON.stringify(data.errors)}`);
  }

  const campaignId = data['campaign-id'];
  if (!campaignId) {
    throw new Error(`BrightLocal createLsrcCampaign: no campaign-id in response: ${JSON.stringify(data)}`);
  }
  return String(campaignId);
}

export async function provisionBrightLocalCampaign(locationData: {
  name: string;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
}): Promise<string> {
  const { name, website, address, city, state, zip, phone } = locationData;

  // BrightLocal requires address data — skip provisioning if we have nothing useful to send.
  if (!address && !city && !state && !zip) {
    throw new Error(`BrightLocal provisioning skipped for "${name}": no address data available`);
  }

  const blLocationId = await createBrightLocalLocation({
    name,
    url: website ?? 'http://example.com',
    address1: address ?? '',
    city: city ?? '',
    region: state ?? '',
    postcode: zip ?? '',
    telephone: phone ?? '',
  });

  const googleLocation = [city, state].filter(Boolean).join(', ') || name;
  // Generic keywords based on business name — callers can override via createLsrcCampaign directly.
  const keywords = [name.toLowerCase(), `${name.toLowerCase()} near me`];

  const campaignId = await createLsrcCampaign({
    name,
    locationId: blLocationId,
    googleLocation,
    keywords,
  });

  return campaignId;
}
