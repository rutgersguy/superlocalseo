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
