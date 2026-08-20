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

/**
 * DataForSEO rate-limits per endpoint, and signals it in TWO different places:
 * HTTP 429, and — more awkwardly — a 200 response whose per-task status_code is
 * 40102 with an empty result.
 *
 * The second form is the dangerous one. Measured directly: of 12 concurrent
 * calls to my_business_info, ONE succeeded and eleven came back 200/40102. Read
 * naively that is "no listing found", so a throttled scan would tell 11 of 12
 * customers their Google Business Profile does not exist. Rate limiting must
 * never be mistaken for absence, so it retries and then throws.
 */
/**
 * Task-level codes that are worth retrying, all of which arrive as HTTP 200.
 *
 *   40102  rate limited — 12 concurrent my_business_info calls returned 1 success
 *          and 11 of these.
 *   40101  "Internal SE Server Error" — transient upstream failure. Confirmed by
 *          repeating one identical SERP query: it returned 0 items, then 33, 34
 *          and 13 items on the next three attempts.
 *
 * 40101 matters more than it looks. An empty SERP result means no client match,
 * which the ranking job writes as `rank: null` — telling a customer they dropped
 * out of the results because DataForSEO hiccupped. Retrying, then THROWING, is
 * the difference between a missing data point and a fabricated one.
 */
const RETRYABLE_TASK_CODES = new Set([40101, 40102]);
const MAX_ATTEMPTS = 4;

function taskRetryable(json: unknown): number | null {
  const tasks = (json as { tasks?: Array<{ status_code?: number }> })?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  // Every task must have failed — a partial success is a real result to use.
  const codes = tasks.map((t) => t?.status_code);
  const first = codes[0];
  if (first != null && RETRYABLE_TASK_CODES.has(first) && codes.every((c) => c === first)) return first;
  return null;
}

async function dfsPost(path: string, body: unknown): Promise<unknown> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      // Exponential backoff with a little jitter so parallel callers do not
      // retry in lockstep and re-create the burst that throttled them.
      const delay = 500 * 2 ** (attempt - 2) * (1 + Math.random());
      await new Promise((r) => setTimeout(r, delay));
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      lastError = 'HTTP 429 rate limited';
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DataForSEO ${path} failed (${res.status}): ${text}`);
    }

    const json = await res.json();
    const retryCode = taskRetryable(json);
    if (retryCode !== null) {
      lastError = `task status ${retryCode}`;
      continue;
    }

    return json;
  }

  // Deliberately throws rather than returning an empty result: callers turn an
  // exception into `unverified`, but an empty result into `not_found`.
  throw new Error(`DataForSEO ${path} failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
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

/**
 * Matches a SERP result against ANY of the business's known names.
 *
 * Clients sign up under a brand/account name (`clients.business_name`, e.g. "AirServe of
 * Tulsa") while the SERP shows the Google Business Profile listing name (`locations.name`,
 * e.g. "Aire Serv of South Tulsa"). Those legitimately differ — onboarding even tells users
 * to enter the location name exactly as it appears on their GBP. Matching on the client name
 * alone means the name check never fires, and we silently depend on the website/phone match.
 *
 * Also guards the substring check: businessMatches() does `a.includes(b) || b.includes(a)`,
 * so a short name ("Air") would match an unrelated result ("Airtron Heating") and report a
 * COMPETITOR's rank as the client's. Require a reasonably specific name before trusting
 * containment; below that, demand an exact match.
 */
const MIN_CONTAINMENT_LEN = 6;

function businessMatchesAny(
  resultTitle: string | null | undefined,
  resultUrl: string | null | undefined,
  resultPhone: string | null | undefined,
  names: Array<string | null | undefined>,
  websiteUrl: string | null | undefined,
  phone: string | null | undefined,
): boolean {
  for (const name of names) {
    if (!name) continue;
    const normalized = normalizeNameForMatch(name);
    // Too short to trust `includes()` — fall back to exact equality on the name, but still
    // let the URL/phone signals inside businessMatches() decide.
    if (normalized.length < MIN_CONTAINMENT_LEN && resultTitle) {
      if (normalizeNameForMatch(resultTitle) === normalized) return true;
      if (businessMatches(null, resultUrl, resultPhone, name, websiteUrl, phone)) return true;
      continue;
    }
    if (businessMatches(resultTitle, resultUrl, resultPhone, name, websiteUrl, phone)) return true;
  }
  return false;
}

export async function getRankForCoordinate(params: {
  keyword: string;
  lat: number;
  lng: number;
  businessName: string;
  websiteUrl?: string | null;
  phone?: string | null;
}): Promise<SerpRankResult> {
  if (!config.dataforseo.login || !config.dataforseo.password) {
    throw new Error('DataForSEO credentials not configured');
  }

  const data = await dfsPost('/serp/google/maps/live/advanced', [{
    keyword: params.keyword,
    location_coordinate: `${params.lat},${params.lng}`,
    language_name: 'English',
    device: 'desktop',
  }]) as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          type: string;
          rank_group?: number;
          title?: string;
          url?: string;
          phone?: string;
        }>;
      }>;
    }>;
  };

  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  for (const item of items) {
    if (businessMatches(item.title, item.url, item.phone, params.businessName, params.websiteUrl, params.phone)) {
      return { rank: item.rank_group ?? null, url: item.url ?? null, rankType: 'local_pack' };
    }
  }
  return { rank: null, url: null, rankType: null };
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
          // Present on flat local_pack items — the shape DataForSEO actually returns.
          phone?: string;
          items?: Array<{ type: string; rank_group?: number; title?: string; url?: string; phone?: string }>;
        }>;
      }>;
    }>;
  };

  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];

  // Local pack first (higher value for local SEO). DataForSEO returns local_pack as FLAT
  // items — see the note in matchInItems(); `item.items` is normally undefined, so guarding
  // on it silently skipped every local-pack result.
  for (const item of items) {
    if (item.type !== 'local_pack') continue;
    for (const sub of item.items ?? [item]) {
      if (businessMatches(sub.title, sub.url, sub.phone, params.businessName, params.websiteUrl, params.phone)) {
        return { rank: sub.rank_group ?? null, url: sub.url ?? null, rankType: 'local_pack' };
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

// ─── getSerpRanks: one SERP call → client + competitor ranks ─────────────────

export interface CompetitorSerpRank {
  id: string;
  rank: number | null;
  url: string | null;
  rankType: 'organic' | 'local_pack' | null;
}

export interface SerpRanksResult {
  client: SerpRankResult;
  competitors: CompetitorSerpRank[];
  /**
   * EVERY result on the page, not just the ones we went looking for (#81).
   *
   * The SERP call already requests depth 30 and we were discarding all of it
   * except the client and any competitor someone had manually named. That threw
   * away the answer to the question clients actually ask — "who is beating me?"
   * — while having already paid for it. Capturing it costs no extra request.
   */
  allResults: SerpEntry[];
}

export interface SerpEntry {
  position: number;
  rankType: 'organic' | 'local_pack';
  domain: string | null;
  url: string | null;
  title: string | null;
}

type RawItem = {
  type: string;
  rank_group?: number;
  title?: string;
  url?: string;
  phone?: string;
  items?: Array<{ type: string; rank_group?: number; title?: string; url?: string; phone?: string }>;
};

function matchInItems(
  items: RawItem[],
  name: string | Array<string | null | undefined>,
  website: string | null | undefined,
  phone: string | null | undefined,
): SerpRankResult {
  const names = Array.isArray(name) ? name : [name];
  // Local pack first (higher value for local SEO).
  //
  // DataForSEO returns local_pack as FLAT items — one `local_pack` item per business, with
  // title/url/phone/rank_group directly on the item. It is NOT a container with a nested
  // `.items` array. The old code guarded on `item.items`, which is always undefined, so the
  // local-pack branch never ran and EVERY result fell through to organic. That's why no
  // local_pack snapshot was written after 2026-05-07. Keep the nested shape supported in case
  // some SERP layouts return it, but don't require it.
  for (const item of items) {
    if (item.type !== 'local_pack') continue;
    for (const sub of item.items ?? [item]) {
      if (businessMatchesAny(sub.title, sub.url, sub.phone, names, website, phone)) {
        return { rank: sub.rank_group ?? null, url: sub.url ?? null, rankType: 'local_pack' };
      }
    }
  }
  for (const item of items) {
    if (item.type === 'organic') {
      if (businessMatchesAny(item.title, item.url, null, names, website, phone)) {
        return { rank: item.rank_group ?? null, url: item.url ?? null, rankType: 'organic' };
      }
    }
  }
  return { rank: null, url: null, rankType: null };
}

export async function getSerpRanks(params: {
  keyword: string;
  locationName: string;
  businessName: string;
  /**
   * Additional names to match the client against — in practice the GBP listing name from
   * `locations.name`, which is what actually appears in the SERP and routinely differs from
   * the signup brand name in `clients.business_name`. See businessMatchesAny().
   */
  altBusinessNames?: Array<string | null | undefined>;
  websiteUrl?: string | null;
  phone?: string | null;
  competitors?: Array<{ id: string; name: string; website: string | null }>;
}): Promise<SerpRanksResult> {
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
  }]) as { tasks?: Array<{ result?: Array<{ items?: RawItem[] }> }> };

  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];

  // The GBP listing name (altBusinessNames, from locations.name) is what actually shows in
  // the SERP; the signup brand name often doesn't. Try both.
  const client = matchInItems(
    items,
    [params.businessName, ...(params.altBusinessNames ?? [])],
    params.websiteUrl,
    params.phone,
  );

  const competitors: CompetitorSerpRank[] = (params.competitors ?? []).map((c) => ({
    id: c.id,
    ...matchInItems(items, c.name, c.website, null),
  }));

  return { client, competitors, allResults: collectResults(items) };
}

/** Host without www, or null when the URL is unusable. Local-pack items often have none. */
function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Flattens a SERP response into the entries worth storing.
 *
 * Local pack is handled the same way as matchInItems: DataForSEO returns those
 * as FLAT items, one per business, not as a container with nested `.items`.
 * Guarding on `item.items` is what made the local-pack branch dead code until
 * it was fixed — see the note in matchInItems.
 */
function collectResults(items: RawItem[]): SerpEntry[] {
  const out: SerpEntry[] = [];
  for (const item of items) {
    if (item.type === 'local_pack') {
      for (const sub of item.items ?? [item]) {
        out.push({
          position: sub.rank_group ?? 0,
          rankType: 'local_pack',
          domain: domainOf(sub.url),
          url: sub.url ?? null,
          // For local pack the business NAME is the identity — most have no
          // website in the pack, so a domain alone would lose them entirely.
          title: sub.title ?? null,
        });
      }
    } else if (item.type === 'organic') {
      out.push({
        position: item.rank_group ?? 0,
        rankType: 'organic',
        domain: domainOf(item.url),
        url: item.url ?? null,
        title: item.title ?? null,
      });
    }
  }
  return out.filter((r) => r.position > 0 && (r.domain || r.title));
}

// ─── getCompetitorRankedKeywords: DataForSEO Labs keyword discovery ───────────

export interface DiscoveredKeyword {
  keyword: string;
  competitorRank: number;
  competitorUrl: string | null;
  searchVolume: number | null;
}

export async function getCompetitorRankedKeywords(params: {
  domain: string;
  locationCode?: number;
  limit?: number;
}): Promise<DiscoveredKeyword[]> {
  if (!config.dataforseo.login || !config.dataforseo.password) {
    throw new Error('DataForSEO credentials not configured');
  }

  const target = params.domain
    .replace(/^https?:\/\/(www\.)?/, '')
    .split('/')[0]
    .split('?')[0];

  const data = await dfsPost('/dataforseo_labs/google/ranked_keywords/live', [{
    target,
    location_code: params.locationCode ?? 2840,
    language_code: 'en',
    limit: params.limit ?? 100,
    order_by: ['keyword_data.keyword_info.search_volume,desc'],
    filters: [['keyword_data.keyword_info.search_volume', '>', 0]],
  }]) as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number } };
          ranked_serp_element?: { serp_item?: { rank_group?: number; url?: string } };
        }>;
      }>;
    }>;
  };

  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];

  return items
    .map((item) => ({
      keyword: item.keyword_data?.keyword ?? '',
      competitorRank: item.ranked_serp_element?.serp_item?.rank_group ?? null,
      competitorUrl: item.ranked_serp_element?.serp_item?.url ?? null,
      searchVolume: item.keyword_data?.keyword_info?.search_volume ?? null,
    }))
    .filter((k): k is DiscoveredKeyword => !!k.keyword && k.competitorRank != null);
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

// ─── On-Page Lighthouse ───────────────────────────────────────────────────────

export interface LighthouseAuditItem {
  title: string;
  description: string;
  displayValue: string | null;
  score: number | null;       // 0–1
}

export interface LighthouseData {
  performanceScore: number;    // 0–100
  accessibilityScore: number;
  bestPracticesScore: number;
  seoScore: number;
  lcp: number | null;          // Largest Contentful Paint, ms
  cls: number | null;          // Cumulative Layout Shift (unitless)
  tbt: number | null;          // Total Blocking Time, ms
  fcp: number | null;          // First Contentful Paint, ms
  speedIndex: number | null;   // Speed Index, ms
  // Top failing/warning audits per category, sorted by weight (highest impact first)
  categoryAudits: {
    performance: LighthouseAuditItem[];
    accessibility: LighthouseAuditItem[];
    bestPractices: LighthouseAuditItem[];
    seo: LighthouseAuditItem[];
  };
  fetchedAt: string;
}

// Picks failing audits (score < 0.9) for a category, sorted by weight descending.
function extractFailingAudits(
  category: { auditRefs?: Array<{ id: string; weight?: number }> } | undefined,
  audits: Record<string, {
    title?: string;
    description?: string;
    score?: number | null;
    scoreDisplayMode?: string;
    displayValue?: string;
  }>,
  limit = 6,
): LighthouseAuditItem[] {
  if (!category?.auditRefs) return [];
  const SKIP_MODES = new Set(['informative', 'manual', 'notApplicable']);
  return category.auditRefs
    .filter((ref) => (ref.weight ?? 0) >= 0)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .map((ref) => ({ ref, audit: audits[ref.id] }))
    .filter(({ audit }) => audit && !SKIP_MODES.has(audit.scoreDisplayMode ?? '') && (audit.score == null || audit.score < 0.9))
    .slice(0, limit)
    .map(({ audit }) => ({
      title: audit.title ?? '',
      description: (audit.description ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), // strip markdown links
      displayValue: audit.displayValue ?? null,
      score: audit.score ?? null,
    }));
}

export async function submitLighthouseTask(url: string): Promise<string | null> {
  if (!config.dataforseo.login || !config.dataforseo.password) return null;
  try {
    const data = await dfsPost('/on_page/lighthouse/task_post', [{ url, for_mobile: false }]) as {
      tasks?: Array<{ id?: string; status_code?: number; status_message?: string }>;
    };
    const task = data.tasks?.[0];
    if (!task?.id || (task.status_code !== 20100 && task.status_code !== 20000)) {
      logger.warn('Lighthouse task post rejected', { url, status: task?.status_code, msg: task?.status_message });
      return null;
    }
    return task.id;
  } catch (e) {
    logger.warn('Lighthouse task submit failed', { url, error: (e as Error).message });
    return null;
  }
}

export async function getLighthouseResult(taskId: string): Promise<LighthouseData | null> {
  if (!config.dataforseo.login || !config.dataforseo.password) return null;
  try {
    const res = await fetch(`${BASE_URL}/on_page/lighthouse/task_get/json/${taskId}`, {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) return null;

    const data = await res.json() as {
      tasks?: Array<{
        status_code?: number;
        result?: Array<{
          categories?: {
            performance?: { score?: number; auditRefs?: Array<{ id: string; weight?: number }> };
            accessibility?: { score?: number; auditRefs?: Array<{ id: string; weight?: number }> };
            'best-practices'?: { score?: number; auditRefs?: Array<{ id: string; weight?: number }> };
            seo?: { score?: number; auditRefs?: Array<{ id: string; weight?: number }> };
          };
          audits?: Record<string, {
            title?: string;
            description?: string;
            score?: number | null;
            scoreDisplayMode?: string;
            displayValue?: string;
            numericValue?: number;
          }>;
        }>;
      }>;
    };

    const task = data.tasks?.[0];
    // 40602 = task still running
    if (!task || task.status_code === 40602) return null;

    const result = task.result?.[0];
    if (!result) return null;

    const cats = result.categories ?? {};
    const audits = (result.audits ?? {}) as Record<string, {
      title?: string; description?: string; score?: number | null;
      scoreDisplayMode?: string; displayValue?: string; numericValue?: number;
    }>;
    const score = (v: number | undefined) => v != null ? Math.round(v * 100) : 0;

    return {
      performanceScore: score(cats.performance?.score),
      accessibilityScore: score(cats.accessibility?.score),
      bestPracticesScore: score(cats['best-practices']?.score),
      seoScore: score(cats.seo?.score),
      lcp: audits['largest-contentful-paint']?.numericValue ?? null,
      cls: audits['cumulative-layout-shift']?.numericValue ?? null,
      tbt: audits['total-blocking-time']?.numericValue ?? null,
      fcp: audits['first-contentful-paint']?.numericValue ?? null,
      speedIndex: audits['speed-index']?.numericValue ?? null,
      categoryAudits: {
        performance: extractFailingAudits(cats.performance, audits),
        accessibility: extractFailingAudits(cats.accessibility, audits),
        bestPractices: extractFailingAudits(cats['best-practices'], audits),
        seo: extractFailingAudits(cats.seo, audits),
      },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    logger.warn('Lighthouse result fetch failed', { taskId, error: (e as Error).message });
    return null;
  }
}

// ── citation auditing primitives (issue #174) ───────────────────────────────

export interface SerpResult {
  url: string;
  title: string;
  description: string;
}

/**
 * A plain organic SERP search, used by the citation scanner for `site:` queries.
 *
 * `depth: 5` is deliberate — a citation lookup only cares about the first result
 * or two, and depth drives the price. Costs ~$0.01 per call.
 */
export async function serpSearch(keyword: string, depth = 5): Promise<SerpResult[]> {
  if (!config.dataforseo.login || !config.dataforseo.password) {
    throw new Error('DataForSEO credentials not configured');
  }

  const json = (await dfsPost('/serp/google/organic/live/advanced', [{
    keyword,
    location_code: 2840,
    language_code: 'en',
    depth,
  }])) as {
    tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }>;
  };

  const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
  return items
    .filter((i) => i.type === 'organic')
    .map((i) => ({
      url: (i.url as string) ?? '',
      title: (i.title as string) ?? '',
      description: (i.description as string) ?? '',
    }))
    .filter((r) => r.url);
}

/**
 * Fetches a listing page and returns its readable text.
 *
 * Best-effort by design: several directories block automated fetching — Yelp
 * returns 403 — so callers must treat null as "could not read", never as
 * "not listed". Costs ~$0.00015 per call, far cheaper than the SERP query.
 */
export async function fetchPageText(url: string): Promise<string | null> {
  // Correct path is on_page/content_parsing/live — plain "content_parsing" is the
  // task-based variant and returns "Task Not Found" when called directly.
  //
  // Deliberately WITHOUT javascript. Measured on a real BBB listing: JS-enabled
  // costs 10x ($0.0015 vs $0.00015) and returned no items at all, while the
  // non-JS fetch returns the page but not the NAP — these directories render
  // contact details client-side. So fetching is a cheap opportunistic extra, and
  // the SERP snippet remains the primary source.
  const json = (await dfsPost('/on_page/content_parsing/live', [{
    url,
    enable_javascript: false,
  }])) as {
    tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }>;
  };

  const item = json.tasks?.[0]?.result?.[0]?.items?.[0];
  if (!item) return null;

  const status = item.status_code as number | undefined;
  if (status !== undefined && (status < 200 || status >= 300)) return null;

  // The parsed page is a nested structure; flattening it to a string is enough
  // for regex extraction and avoids depending on their exact shape.
  const blob = JSON.stringify(item.page_content ?? item);
  return blob.length > 2 ? blob : null;
}

export interface GoogleListing {
  title: string | null;
  address: string | null;
  phone: string | null;
  url: string | null;
}

/**
 * Google Business Profile listing, from Google My Business Info.
 *
 * Google is scanned through this rather than a `site:` search, because Google
 * Maps listings are not indexed as ordinary web pages — a `site:google.com/maps`
 * query finds nothing, which is why validation showed Google as a miss while
 * BrightLocal had it listed. This returns the fields structured, so no snippet
 * scraping is involved at all.
 *
 * Costs ~$0.0054 — pricier than a SERP query, and worth it for the single most
 * important directory.
 */
export async function getGoogleListing(
  businessName: string,
  street: string | null,
  city: string | null,
  state: string | null,
): Promise<GoogleListing | null> {
  // Two attempts, because this lookup is markedly keyword-sensitive: for a
  // Greenwich Village pizzeria, "Joe's Pizza New York NY" returns nothing at
  // all while "Joe's Pizza 7 Carmine St New York NY" returns the listing. The
  // street address is tried first because it disambiguates common names, and
  // the broader query is the fallback for a business that has since moved (in
  // which case the stored street would defeat the lookup).
  //
  // Including our address does not bias the result: Google returns its OWN
  // record — it answered "Ste Ab" to a query carrying our stored "Suite Ab",
  // which is exactly the mismatch we exist to detect.
  const where = [city, state].filter(Boolean).join(' ');
  const queries = [
    [businessName, street, where].filter(Boolean).join(' ').trim(),
    [businessName, where].filter(Boolean).join(' ').trim(),
  ].filter((q, i, a) => q && a.indexOf(q) === i);

  let item: Record<string, unknown> | undefined;
  for (const keyword of queries) {
    const json = (await dfsPost('/business_data/google/my_business_info/live', [{
      keyword,
      location_code: 2840,
      language_code: 'en',
    }])) as { tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }> };
    item = json.tasks?.[0]?.result?.[0]?.items?.[0];
    if (item) break;
  }
  if (!item) return null;

  return {
    title: (item.title as string) ?? null,
    address: (item.address as string) ?? null,
    phone: (item.phone as string) ?? null,
    url: (item.url as string) ?? null,
  };
}

export interface MapsBusiness {
  title: string | null;
  address: string | null;
  phone: string | null;
}

/**
 * Businesses from the Google Maps pack for a query.
 *
 * Used to assemble a corpus of REAL businesses with authoritative NAP for
 * measuring directory coverage, rather than inventing test data. Costs $0.002.
 */
export async function mapsSearch(keyword: string, depth = 10): Promise<MapsBusiness[]> {
  const json = (await dfsPost('/serp/google/maps/live/advanced', [{
    keyword, location_code: 2840, language_code: 'en', depth,
  }])) as { tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }> };

  return (json.tasks?.[0]?.result?.[0]?.items ?? []).map((i) => ({
    title: (i.title as string) ?? null,
    address: (i.address as string) ?? null,
    phone: (i.phone as string) ?? null,
  }));
}

// ─── AI assistant responses (ai_optimization/llm_responses) ──────────────────

export interface LlmResponseResult {
  modelName: string;
  text: string;
  /**
   * Source URLs the assistant reported, from each section's `annotations`.
   *
   * Only ChatGPT writes citations inline in the prose; Gemini and Perplexity
   * return none in the text at all — Perplexity uses bare "[2][4]" markers.
   * Verified across all three engines 2026-08-20. Scraping URLs out of the text
   * therefore captures sources for one engine of three, so the structured field
   * is the real source and the text is only a fallback.
   */
  sourceUrls: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Ask one assistant one question, with web search on.
 *
 * RESPONSE SHAPE — verified live 2026-08-20, not from documentation.
 * The answer is NOT at `result[].items[].text`, which exists but is always
 * empty. It is nested one level further at `result[].items[].sections[].text`,
 * and an `items` entry of type "reasoning" carries `sections: null`. Reading the
 * wrong field yields empty strings that look exactly like a model declining to
 * answer, which would be recorded as "you are not mentioned".
 *
 * Empty text therefore THROWS rather than returning ''. The caller turns an
 * exception into `unverified`; it turns an empty answer into `absent`. Those are
 * very different claims to put in front of a customer.
 *
 * `web_search` is always true — see ai_engines.config.ts.
 */
export async function runLlmPrompt(params: {
  engine: string;
  modelName: string;
  prompt: string;
}): Promise<LlmResponseResult> {
  const json = (await dfsPost(
    `/ai_optimization/${params.engine}/llm_responses/live`,
    [{ user_prompt: params.prompt, model_name: params.modelName, web_search: true }],
  )) as {
    cost?: number;
    tasks?: Array<{
      status_code?: number;
      status_message?: string;
      result?: Array<{
        model_name?: string;
        input_tokens?: number;
        output_tokens?: number;
        money_spent?: number;
        items?: Array<{
          type?: string;
          sections?: Array<{
            type?: string;
            text?: string;
            annotations?: Array<{ url?: string; title?: string }> | null;
          }> | null;
        }>;
      }>;
    }>;
  };

  const task = json.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(
      `llm_responses task failed for ${params.engine}/${params.modelName}: ${task?.status_message ?? 'no task returned'}`,
    );
  }

  const result = task.result?.[0];
  if (!result) throw new Error(`llm_responses returned no result for ${params.engine}`);

  let text = '';
  const sourceUrls: string[] = [];
  for (const item of result.items ?? []) {
    for (const section of item.sections ?? []) {
      if (section?.text) text += section.text;
      for (const a of section?.annotations ?? []) {
        if (a?.url) sourceUrls.push(a.url);
      }
    }
  }
  text = text.trim();

  if (!text) {
    throw new Error(`llm_responses returned an empty answer for ${params.engine}/${params.modelName}`);
  }

  return {
    modelName: result.model_name ?? params.modelName,
    text,
    sourceUrls,
    inputTokens: result.input_tokens ?? 0,
    outputTokens: result.output_tokens ?? 0,
    // money_spent is the token+search cost for this call; json.cost is the
    // billed total for the request. They differ slightly; money_spent is the
    // per-result figure and is what we attribute to the snapshot.
    costUsd: result.money_spent ?? json.cost ?? 0,
  };
}
