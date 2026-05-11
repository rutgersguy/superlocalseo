import { config } from '../config';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.dataforseo.com/v3';

// DataForSEO Google Ads location codes for US states
// Full list: https://api.dataforseo.com/v3/keywords_data/google_ads/locations
const US_STATE_LOCATION_CODES: Record<string, number> = {
  AL: 21132, AK: 21133, AZ: 21136, AR: 21138, CA: 21137,
  CO: 21139, CT: 21140, DE: 21141, FL: 21142, GA: 21143,
  HI: 21144, ID: 21145, IL: 21146, IN: 21147, IA: 21148,
  KS: 21149, KY: 21150, LA: 21151, ME: 21152, MD: 21153,
  MA: 21154, MI: 21155, MN: 21156, MS: 21157, MO: 21158,
  MT: 21159, NE: 21160, NV: 21161, NH: 21163, NJ: 21164,
  NM: 21165, NY: 21162, NC: 21166, ND: 21169, OH: 21168,
  OK: 21167, OR: 21170, PA: 21171, RI: 21172, SC: 21173,
  SD: 21174, TN: 21175, TX: 21176, UT: 21177, VT: 21178,
  VA: 21179, WA: 21180, WV: 21181, WI: 21182, WY: 21183,
  DC: 21184,
};

export function locationCodeForState(stateAbbr: string | null | undefined): number {
  if (!stateAbbr) return 2840; // fallback: national US
  const code = US_STATE_LOCATION_CODES[stateAbbr.trim().toUpperCase()];
  return code ?? 2840;
}

// DMA (metro area) codes for major US markets — more accurate than state-level for local businesses
// Full list: https://api.dataforseo.com/v3/keywords_data/google_ads/locations (location_type = "DMA Region")
const US_DMA_CODES: Record<string, number> = {
  'new york':       501, 'los angeles':    803, 'chicago':        602,
  'philadelphia':   504, 'dallas':         623, 'san francisco':  807,
  'boston':         506, 'atlanta':        524, 'washington':     511,
  'houston':        618, 'seattle':        819, 'tampa':          539,
  'minneapolis':    613, 'miami':          528, 'denver':         751,
  'cleveland':      510, 'orlando':        534, 'portland':       820,
  'st. louis':      609, 'pittsburgh':     508, 'raleigh':        560,
  'sacramento':     862, 'indianapolis':   527, 'baltimore':      512,
  'san diego':      825, 'nashville':      659, 'charlotte':      517,
  'hartford':       533, 'kansas city':    616, 'columbus':       535,
  'salt lake city': 770, 'san antonio':    641, 'las vegas':      839,
  'norfolk':        544, 'oklahoma city':  650, 'tulsa':       200671,
  'memphis':        640, 'austin':         635, 'new orleans':    622,
  'richmond':       556, 'jacksonville':   561, 'louisville':     529,
  'birmingham':     630, 'albuquerque':    790, 'tucson':         789,
  'omaha':          652, 'buffalo':        514, 'fresno':         866,
  'phoenix':        753,
};

const CITY_ALIASES: Record<string, string> = {
  'saint louis': 'st. louis', 'st louis': 'st. louis',
  'saint paul': 'minneapolis', 'st paul': 'minneapolis',
  'fort worth': 'dallas', 'ft worth': 'dallas',
  'fort lauderdale': 'miami', 'ft lauderdale': 'miami',
  'saint petersburg': 'tampa', 'st pete': 'tampa', 'st petersburg': 'tampa',
  'new york city': 'new york', 'nyc': 'new york', 'brooklyn': 'new york', 'queens': 'new york', 'bronx': 'new york',
  'la': 'los angeles',
  'dc': 'washington', 'd.c.': 'washington', 'washington dc': 'washington', 'washington d.c.': 'washington',
  'sf': 'san francisco', 'bay area': 'san francisco',
  'philly': 'philadelphia',
  'scottsdale': 'phoenix', 'mesa': 'phoenix', 'tempe': 'phoenix', 'chandler': 'phoenix',
  'henderson': 'las vegas',
  'arlington': 'dallas',
  'aurora': 'denver',
  'broken arrow': 'tulsa', 'owasso': 'tulsa', 'sand springs': 'tulsa', 'bixby': 'tulsa',
  'norman': 'oklahoma city', 'edmond': 'oklahoma city', 'moore': 'oklahoma city', 'midwest city': 'oklahoma city',
};

function normalizeCityKey(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/,.*/, '')       // strip ", state" suffix
    .replace(/\./g, '')       // strip periods (st. louis → st louis)
    .replace(/\s+/g, ' ');   // collapse whitespace
}

export function locationCodeForCity(city: string | null | undefined, stateAbbr: string | null | undefined): number {
  if (city) {
    const key = normalizeCityKey(city);
    const resolved = CITY_ALIASES[key] ?? key;
    // Try resolved key first, then with periods stripped from map keys
    const dma = US_DMA_CODES[resolved] ?? US_DMA_CODES[resolved.replace(/\./g, '')] ?? US_DMA_CODES[key];
    if (dma) return dma;
  }
  return locationCodeForState(stateAbbr);
}

// Returns unique DMA/state codes for a service area, deduped so multi-city areas
// in the same metro don't inflate volumes by querying the same pool twice.
export function locationCodesForServiceArea(
  serviceArea: string[],
  primaryCity: string | null | undefined,
  state: string | null | undefined,
): number[] {
  const cities = serviceArea.length > 0 ? serviceArea : [primaryCity ?? ''];
  const seen = new Set<number>();
  for (const city of cities) {
    seen.add(locationCodeForCity(city, state));
  }
  return Array.from(seen);
}

// Fetches search volumes aggregated across all unique location codes in the service
// area. Volumes for the same keyword across distinct DMAs are summed.
export async function getAggregatedSearchVolumes(
  keywords: string[],
  serviceArea: string[],
  primaryCity: string | null | undefined,
  state: string | null | undefined,
): Promise<SearchVolumeResult[]> {
  const codes = locationCodesForServiceArea(serviceArea, primaryCity, state);

  if (codes.length === 1) {
    return getSearchVolumes(keywords, codes[0]);
  }

  const allResults = await Promise.all(codes.map((code) => getSearchVolumes(keywords, code)));

  // Sum volumes across DMAs per keyword
  const totals = new Map<string, number | null>();
  for (const batch of allResults) {
    for (const { keyword, monthlySearchVolume } of batch) {
      const key = keyword.toLowerCase();
      const prev = totals.get(key);
      if (monthlySearchVolume == null) {
        if (!totals.has(key)) totals.set(key, null);
      } else {
        totals.set(key, (prev ?? 0) + monthlySearchVolume);
      }
    }
  }

  return keywords.map((kw) => ({
    keyword: kw,
    monthlySearchVolume: totals.get(kw.toLowerCase()) ?? null,
  }));
}

function authHeader(): string {
  const { login, password } = config.dataforseo;
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

async function dfsPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DataForSEO ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ─── SERP rank lookup ─────────────────────────────────────────────────────────

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

export function buildLocationName(city: string | null | undefined, state: string | null | undefined): string {
  const parts: string[] = [];
  if (city) parts.push(city.split(',')[0].trim());
  if (state) parts.push(STATE_NAMES[state.trim().toUpperCase()] ?? state.trim());
  parts.push('United States');
  return parts.join(',');
}

export interface SerpRankResult {
  rank: number | null;
  url: string | null;
  rankType: 'organic' | 'local_pack' | null;
}

function normalizeDomain(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function normalizeNameForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function businessMatches(
  resultTitle: string | null | undefined,
  resultUrl: string | null | undefined,
  resultPhone: string | null | undefined,
  businessName: string,
  websiteUrl: string | null | undefined,
  phone: string | null | undefined,
): boolean {
  if (websiteUrl && resultUrl) {
    const a = normalizeDomain(websiteUrl), b = normalizeDomain(resultUrl);
    if (a && b && (a.includes(b) || b.includes(a))) return true;
  }
  if (resultTitle) {
    const a = normalizeNameForMatch(businessName), b = normalizeNameForMatch(resultTitle);
    if (a && b && (a.includes(b) || b.includes(a))) return true;
  }
  if (phone && resultPhone) {
    const a = phone.replace(/\D/g, ''), b = resultPhone.replace(/\D/g, '');
    if (a.length >= 7 && b.includes(a.slice(-7))) return true;
  }
  return false;
}

export async function getRankForKeyword(params: {
  keyword: string;
  locationName: string;
  businessName: string;
  websiteUrl?: string | null;
  phone?: string | null;
}): Promise<SerpRankResult> {
  if (!config.dataforseo.login || !config.dataforseo.password) {
    throw new Error('DataForSEO credentials not configured');
  }

  const data = await dfsPost('/serp/google/organic/live/advanced', [{
    keyword: params.keyword,
    location_name: params.locationName,
    language_name: 'English',
    device: 'desktop',
    os: 'windows',
    depth: 30,
  }]) as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          type: string;
          rank_group?: number;
          url?: string;
          title?: string;
          items?: Array<{ type: string; rank_group?: number; title?: string; url?: string; phone?: string }>;
        }>;
      }>;
    }>;
  };

  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];

  // Local pack first (higher value for local SEO)
  for (const item of items) {
    if (item.type === 'local_pack' && item.items) {
      for (const sub of item.items) {
        if (businessMatches(sub.title, sub.url, sub.phone, params.businessName, params.websiteUrl, params.phone)) {
          return { rank: sub.rank_group ?? null, url: sub.url ?? null, rankType: 'local_pack' };
        }
      }
    }
  }

  // Organic fallback
  for (const item of items) {
    if (item.type === 'organic') {
      if (businessMatches(item.title, item.url, null, params.businessName, params.websiteUrl, params.phone)) {
        return { rank: item.rank_group ?? null, url: item.url ?? null, rankType: 'organic' };
      }
    }
  }

  return { rank: null, url: null, rankType: null };
}

// ─── Search volumes ───────────────────────────────────────────────────────────

interface SearchVolumeResult {
  keyword: string;
  monthlySearchVolume: number | null;
}

export async function getSearchVolumes(keywords: string[], locationCode = 2840): Promise<SearchVolumeResult[]> {
  if (!config.dataforseo.login || !config.dataforseo.password) {
    logger.warn('DataForSEO credentials not configured — skipping search volume fetch');
    return keywords.map((keyword) => ({ keyword, monthlySearchVolume: null }));
  }

  try {
    // Send all keywords in a single task for efficiency
    const tasks = [{ keywords, location_code: locationCode, language_code: 'en' }];

    const data = (await dfsPost('/keywords_data/google_ads/search_volume/live', tasks)) as {
      tasks?: Array<{
        result?: Array<{
          keyword: string;
          search_volume: number | null;
        }>;
      }>;
    };

    const resultMap = new Map<string, number | null>();
    for (const task of data.tasks ?? []) {
      for (const row of task.result ?? []) {
        resultMap.set(row.keyword.toLowerCase(), row.search_volume ?? null);
      }
    }

    return keywords.map((kw) => ({
      keyword: kw,
      monthlySearchVolume: resultMap.get(kw.toLowerCase()) ?? null,
    }));
  } catch (e) {
    logger.error('DataForSEO search volume fetch failed', { error: (e as Error).message, keywords });
    return keywords.map((keyword) => ({ keyword, monthlySearchVolume: null }));
  }
}
