import { db } from '../db/connection';

export interface RankObservation {
  keywordId: string;
  locationId: string;
  keyword: string;
  location: string;
  searchEngine: string;
  geoLocation: string | null;
  rankType: string | null;
  rank: number | null;
  monthlySearchVolume: number | null;
  pulledAt: Date;
}

export function rankKey(r: Pick<RankObservation, 'keywordId' | 'locationId' | 'searchEngine' | 'geoLocation'>): string {
  return JSON.stringify([r.keywordId, r.locationId, r.searchEngine, r.geoLocation]);
}

/** Select the latest observation BEFORE classifying it. Null means not found, not an old rank. */
export function latestRanks(clientId: string, end: Date, start?: Date, locationId?: string) {
  return db('ranking_snapshots as rs')
    .join('keywords as k', 'rs.keyword_id', 'k.id')
    .join('locations as l', 'rs.location_id', 'l.id')
    .where('l.client_id', clientId)
    .where('rs.pulled_at', '<', end)
    .modify(q => { if (start) q.where('rs.pulled_at', '>=', start); if (locationId) q.where('l.id', locationId); })
    .distinctOn('rs.keyword_id', 'rs.location_id', 'rs.search_engine', 'rs.geo_location')
    .select('rs.keyword_id as keywordId', 'rs.location_id as locationId', 'k.keyword', 'l.name as location',
      'rs.search_engine as searchEngine', 'rs.geo_location as geoLocation', 'rs.rank_type as rankType',
      'rs.rank', 'k.monthly_search_volume as monthlySearchVolume', 'rs.pulled_at as pulledAt')
    .orderByRaw('rs.keyword_id, rs.location_id, rs.search_engine, rs.geo_location, rs.pulled_at DESC, rs.id DESC');
}

export function summarizeRanks(rows: Array<{ rank: number | null }>) {
  const ranked = rows.filter((r): r is { rank: number } => r.rank != null && Number.isFinite(Number(r.rank)) && Number(r.rank) > 0);
  const winning = ranked.filter(r => Number(r.rank) <= 3).length;
  const top10 = ranked.filter(r => Number(r.rank) <= 10).length;
  return {
    avgRank: ranked.length ? Math.round(ranked.reduce((s, r) => s + Number(r.rank), 0) / ranked.length * 10) / 10 : null,
    keywordsInTop3: winning, keywordsInTop10: top10,
    winning, competing: top10 - winning, vulnerable: ranked.length - top10,
    absent: rows.filter(r => r.rank === null).length, observed: rows.length,
  };
}

export interface CitationObservation {
  listed: boolean;
  verification_status?: string | null;
  nap_match: boolean | null;
  nap_name_match?: boolean | null;
  nap_address_match?: boolean | null;
  nap_phone_match?: boolean | null;
}

export function latestCitations(clientId: string, end: Date, locationId?: string) {
  return db('citation_snapshots as cs').join('locations as l', 'cs.location_id', 'l.id')
    .where('l.client_id', clientId).where('cs.pulled_at', '<', end)
    .modify(q => { if (locationId) q.where('l.id', locationId); })
    .distinctOn('cs.location_id', 'cs.directory').select('cs.*')
    .orderByRaw('cs.location_id, cs.directory, cs.pulled_at DESC, cs.id DESC');
}

export function napVerdict(row: CitationObservation): boolean | null {
  const values = [row.nap_name_match, row.nap_address_match, row.nap_phone_match];
  if (values.every(v => v === undefined)) return row.nap_match;
  if (values.some(v => v === false)) return false;
  return values.every(v => v === true) ? true : null;
}

export function summarizeCitations(rows: CitationObservation[]) {
  const status = (r: CitationObservation) => r.verification_status ?? (r.listed ? 'listed' : 'not_found');
  const listed = rows.filter(r => status(r) === 'listed');
  const missing = rows.filter(r => status(r) === 'not_found').length;
  const checked = listed.length + missing;
  const napChecked = listed.filter(r => napVerdict(r) !== null).length;
  const napAccurate = listed.filter(r => napVerdict(r) === true).length;
  return { total: rows.length, listed: listed.length, missing, checked, unverified: rows.length - checked,
    napChecked, napAccurate, napDifferences: napChecked - napAccurate,
    score: checked ? Math.round(listed.length / checked * 100) : null };
}

/** A modeled scenario, never attribution. Each keyword/location volume is counted once. */
export function estimateTraffic(rows: RankObservation[], cfg: { avgCustomerValue?: number; conversionRate?: number }) {
  const organic: Record<number, number> = { 1: .285, 2: .157, 3: .110, 4: .080, 5: .072, 6: .051, 7: .040, 8: .032, 9: .028, 10: .025 };
  const groups = new Map<string, RankObservation[]>();
  for (const r of rows) {
    // The modeled CTR curves do not cover local-finder grids or other engines.
    if (r.searchEngine !== 'google') continue;
    if (r.rank !== null && (!Number.isInteger(r.rank) || r.rank <= 0)) continue;
    if (r.rankType !== 'organic' && r.rankType !== 'local_pack' && !(r.rank === null && r.rankType === null)) continue;
    if (r.rankType === 'local_pack' && r.rank !== null && r.rank > 3) continue;
    const key = JSON.stringify([r.keywordId, r.locationId]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const keywords = [...groups.values()].map(group => {
    const r = group[0];
    const rawVolume = r.monthlySearchVolume;
    const volume = rawVolume != null && Number.isFinite(rawVolume) && rawVolume >= 0 ? rawVolume : null;
    const ctr = group.reduce((sum, row) => {
      if (row.rank === null) return sum;
      const rank = Number(row.rank);
      if (rank <= 0) return sum;
      return sum + (row.rankType === 'local_pack'
        ? ({ 1: .05, 2: .038, 3: .028 } as Record<number, number>)[rank] ?? .01
        : organic[rank] ?? (rank <= 20 ? .01 : .003));
    }, 0) / group.length;
    const ranks = group.filter(x => x.rank !== null).map(x => Number(x.rank));
    const clicks = volume === null ? null : Math.round(volume * ctr);
    const conversion = cfg.conversionRate ?? 2.5;
    const validConversion = Number.isFinite(conversion) && conversion >= 0 && conversion <= 100;
    const value = cfg.avgCustomerValue;
    const validValue = value != null && Number.isFinite(value) && value > 0;
    const leads = clicks === null || !validConversion ? null : Math.round(clicks * conversion / 100 * 10) / 10;
    const revenue = leads === null || !validValue ? null : Math.round(leads * value);
    return { keywordId: r.keywordId, locationId: r.locationId, keyword: r.keyword, location: r.location,
      monthlySearchVolume: volume, rank: ranks.length ? Math.round(ranks.reduce((s, n) => s + n, 0) / ranks.length * 10) / 10 : null,
      ctr: Math.round(ctr * 1000) / 10, estClicks: clicks, estLeads: leads, estRevenue: revenue };
  });
  const known = keywords.filter(k => k.estClicks !== null);
  return { keywords, totals: {
    estClicks: known.length ? known.reduce((s, k) => s + (k.estClicks ?? 0), 0) : null,
    estLeads: known.length && known.every(k => k.estLeads !== null) ? Math.round(known.reduce((s, k) => s + (k.estLeads ?? 0), 0) * 10) / 10 : null,
    estRevenue: known.length && known.every(k => k.estRevenue !== null) ? known.reduce((s, k) => s + (k.estRevenue ?? 0), 0) : null,
  }, measuredKeywords: known.length, totalKeywords: keywords.length,
  methodology: 'Scenario using stored monthly search volumes, assumed CTR and your conversion settings. Latest supported Google organic/local-pack observations per area; unsupported result types and invalid ranks are excluded. Unranked observations contribute zero modeled clicks. Areas are equally weighted. Missing or invalid volumes are excluded. Invalid conversion or customer-value settings leave the corresponding estimates unavailable. Overlapping keyword demand is not deduplicated. Not measured traffic, leads or revenue.' };
}

/** Latest collected check per directory/location per UTC day. No carry-forward imputation. */
export async function citationHistory(clientId: string, days: number, locationId?: string) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const rows = await db('citation_snapshots as cs').join('locations as l', 'cs.location_id', 'l.id')
    .where('l.client_id', clientId).whereBetween('cs.pulled_at', [start, end])
    .modify(q => { if (locationId) q.where('l.id', locationId); })
    .select(db.raw("DISTINCT ON ((cs.pulled_at AT TIME ZONE 'UTC')::date, cs.location_id, cs.directory) cs.*"))
    .select(db.raw("(cs.pulled_at AT TIME ZONE 'UTC')::date::text as date"))
    .orderByRaw("(cs.pulled_at AT TIME ZONE 'UTC')::date, cs.location_id, cs.directory, cs.pulled_at DESC, cs.id DESC");
  const groups = new Map<string, CitationObservation[]>();
  for (const row of rows) groups.set(row.date, [...(groups.get(row.date) ?? []), row]);
  return [...groups.entries()].map(([date, values]) => {
    const result = summarizeCitations(values);
    return { date, listedCount: result.listed, totalCount: result.total, checkedCount: result.checked,
      unverifiedCount: result.unverified, completeness: result.score };
  });
}
