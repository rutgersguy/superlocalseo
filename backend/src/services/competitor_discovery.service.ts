/**
 * "Who is beating me, and on what?" — computed from SERP results we already
 * store, with no extra API calls (#81).
 *
 * WHAT COUNTS AS BEATING YOU
 * --------------------------
 * A competitor outranks the client on a keyword when it appears ABOVE them on
 * that keyword's page. Two cases need care and they pull in opposite directions:
 *
 *   - client ranked at N  → anything at position < N beats them.
 *   - client NOT ranked   → everything on the page beats them. Excluding these
 *     would hide the worst keywords entirely, which are precisely the ones a
 *     client needs to see.
 *
 * Ranks are compared WITHIN a rank type. A local-pack position 1 and an organic
 * position 1 are different places on the page, and mixing them would report a
 * business as beating the client when it sits below them on screen.
 *
 * IDENTITY
 * --------
 * Keyed on domain where there is one, falling back to business name. Local-pack
 * entries routinely have no website at all, so a domain-only key would silently
 * drop the most valuable competitors — the ones in the map pack.
 */
import { db } from '../db/connection';
import { DIRECTORIES } from '../config/directories.config';

/**
 * Directory and aggregator domains, reused from the citation registry (#174).
 *
 * Yelp, HomeAdvisor, Angi and Nextdoor rank for local queries constantly, and
 * calling them "competitors" is worse than useless — a plumber cannot out-rank
 * Yelp and should not be told to try. But they are not noise to be deleted
 * either: "six of the top ten are directories" tells the client the page is
 * aggregator-dominated, which is a genuine finding and changes the advice from
 * "beat these businesses" to "get listed on these directories".
 *
 * So they are classified, not dropped, and reported separately.
 */
const DIRECTORY_DOMAINS = new Set(
  Object.values(DIRECTORIES).map((d) => d.domain.split('/')[0].replace(/^www\./, '')),
);

// A few that rank locally but are not citation targets, so are absent from the
// citation registry.
const EXTRA_AGGREGATORS = [
  'tripadvisor.com', 'reddit.com', 'quora.com', 'wikipedia.org', 'amazon.com',
  'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'craigslist.org',
  'expertise.com', 'thumbtack.com', 'porch.com', 'bark.com', 'trustpilot.com',
];
for (const d of EXTRA_AGGREGATORS) DIRECTORY_DOMAINS.add(d);

/** Matches the domain or any parent (uk.trustpilot.com → trustpilot.com). */
export function isDirectoryDomain(domain: string | null): boolean {
  if (!domain) return false;
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (DIRECTORY_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

export interface OutrankingCompetitor {
  key: string;
  domain: string | null;
  businessName: string | null;
  /** Keywords where this competitor appears above the client. */
  keywordsOutranking: number;
  /** Their average position across those keywords. */
  avgPosition: number;
  bestPosition: number;
  rankTypes: string[];
  /**
   * True for directories and aggregators. Kept in the response rather than
   * filtered out — being outranked by Yelp is real, but it is a different
   * problem with a different fix, so the UI separates them.
   */
  isDirectory: boolean;
  /** Average position in the previous window, and the delta. Null when unseen before. */
  previousAvgPosition: number | null;
  change: number | null;
  sampleKeywords: string[];
}

export interface OutrankingReport {
  /** Real businesses only — the ones the client can actually compete with. */
  competitors: OutrankingCompetitor[];
  /** Directories and aggregators ranking above the client, reported separately. */
  directories: OutrankingCompetitor[];
  keywordsTracked: number;
  keywordsWhereClientUnranked: number;
  lastPulledAt: string | null;
  windowDays: number;
}

interface SerpRow {
  keyword_id: string;
  keyword: string;
  position: number;
  rank_type: string;
  domain: string | null;
  business_name: string | null;
}

interface ClientRankRow {
  keyword_id: string;
  rank: number | null;
  rank_type: string | null;
}

/** Domain and name of the client itself, so they are never listed as their own competitor. */
async function clientIdentity(locationId: string): Promise<{ domains: Set<string>; names: Set<string> }> {
  const loc = await db('locations').where({ id: locationId }).first('name', 'website');
  const domains = new Set<string>();
  const names = new Set<string>();
  if (loc?.website) {
    try { domains.add(new URL(loc.website as string).hostname.replace(/^www\./, '').toLowerCase()); }
    catch { /* a malformed website must not break the report */ }
  }
  if (loc?.name) names.add((loc.name as string).trim().toLowerCase());
  return { domains, names };
}

function identityKey(r: { domain: string | null; business_name: string | null }): string | null {
  if (r.domain) return `d:${r.domain}`;
  if (r.business_name) return `n:${r.business_name.trim().toLowerCase()}`;
  return null;
}

/** Rows from the most recent scan within `days`, one window. */
async function windowRows(locationId: string, since: Date, until: Date): Promise<SerpRow[]> {
  return db('serp_competitors as sc')
    .join('keywords as k', 'k.id', 'sc.keyword_id')
    .where('sc.location_id', locationId)
    .where('sc.pulled_at', '>=', since)
    .where('sc.pulled_at', '<', until)
    .select('sc.keyword_id', 'k.keyword', 'sc.position', 'sc.rank_type', 'sc.domain', 'sc.business_name') as Promise<SerpRow[]>;
}

async function clientRanks(locationId: string, since: Date, until: Date): Promise<Map<string, ClientRankRow>> {
  const rows = await db('ranking_snapshots')
    .where({ location_id: locationId })
    .where('pulled_at', '>=', since)
    .where('pulled_at', '<', until)
    .select('keyword_id', 'rank', 'rank_type')
    .orderBy('pulled_at', 'desc') as ClientRankRow[];

  // First row wins — ordered newest first, so this keeps the latest per keyword.
  const map = new Map<string, ClientRankRow>();
  for (const r of rows) if (!map.has(r.keyword_id)) map.set(r.keyword_id, r);
  return map;
}

/** Aggregates one window into position lists per competitor. */
function tally(
  rows: SerpRow[],
  ranks: Map<string, ClientRankRow>,
  self: { domains: Set<string>; names: Set<string> },
) {
  const acc = new Map<string, {
    domain: string | null; businessName: string | null;
    positions: number[]; keywords: Set<string>; rankTypes: Set<string>;
  }>();

  for (const r of rows) {
    if (r.domain && self.domains.has(r.domain)) continue;
    if (r.business_name && self.names.has(r.business_name.trim().toLowerCase())) continue;

    const key = identityKey(r);
    if (!key) continue;

    const client = ranks.get(r.keyword_id);
    // Same rank type only — a local-pack 1 is not above an organic 1.
    const clientRank = client && client.rank_type === r.rank_type ? client.rank : null;
    const beatsClient = clientRank == null || r.position < clientRank;
    if (!beatsClient) continue;

    const entry = acc.get(key) ?? {
      domain: r.domain, businessName: r.business_name,
      positions: [], keywords: new Set<string>(), rankTypes: new Set<string>(),
    };
    entry.positions.push(r.position);
    entry.keywords.add(r.keyword);
    entry.rankTypes.add(r.rank_type);
    // Prefer a real name over none, so map-pack businesses are identifiable.
    if (!entry.businessName && r.business_name) entry.businessName = r.business_name;
    acc.set(key, entry);
  }
  return acc;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export async function getOutrankingCompetitors(
  locationId: string,
  windowDays = 7,
): Promise<OutrankingReport> {
  const latest = await db('serp_competitors')
    .where({ location_id: locationId })
    .max('pulled_at as latest')
    .first() as { latest: Date | null } | undefined;

  if (!latest?.latest) {
    return {
      competitors: [], directories: [], keywordsTracked: 0,
      keywordsWhereClientUnranked: 0, lastPulledAt: null, windowDays,
    };
  }

  const end = new Date(latest.latest);
  const currentStart = new Date(end.getTime() - windowDays * 86_400_000);
  const priorStart = new Date(currentStart.getTime() - windowDays * 86_400_000);
  const justAfterEnd = new Date(end.getTime() + 1000);

  const self = await clientIdentity(locationId);

  const [curRows, curRanks, prevRows, prevRanks] = await Promise.all([
    windowRows(locationId, currentStart, justAfterEnd),
    clientRanks(locationId, currentStart, justAfterEnd),
    windowRows(locationId, priorStart, currentStart),
    clientRanks(locationId, priorStart, currentStart),
  ]);

  const current = tally(curRows, curRanks, self);
  const previous = tally(prevRows, prevRanks, self);

  const all: OutrankingCompetitor[] = [...current.entries()]
    .map(([key, e]) => {
      const prev = previous.get(key);
      const avgPos = avg(e.positions);
      const prevAvg = prev ? avg(prev.positions) : null;
      return {
        key,
        domain: e.domain,
        businessName: e.businessName,
        keywordsOutranking: e.keywords.size,
        avgPosition: Math.round(avgPos * 10) / 10,
        bestPosition: Math.min(...e.positions),
        rankTypes: [...e.rankTypes].sort(),
        previousAvgPosition: prevAvg == null ? null : Math.round(prevAvg * 10) / 10,
        // Negative = they moved UP the page (a lower position number), i.e. worse for us.
        change: prevAvg == null ? null : Math.round((avgPos - prevAvg) * 10) / 10,
        isDirectory: isDirectoryDomain(e.domain),
        sampleKeywords: [...e.keywords].slice(0, 5),
      };
    })
    // Most keywords first, then closest to the top — "beats me everywhere" matters
    // more than "beats me once, at position 2".
    .sort((a, b) => b.keywordsOutranking - a.keywordsOutranking || a.avgPosition - b.avgPosition);

  const keywordIds = new Set(curRows.map((r) => r.keyword_id));
  let unranked = 0;
  for (const id of keywordIds) {
    const c = curRanks.get(id);
    if (!c || c.rank == null) unranked++;
  }

  return {
    competitors: all.filter((c) => !c.isDirectory),
    directories: all.filter((c) => c.isDirectory),
    keywordsTracked: keywordIds.size,
    keywordsWhereClientUnranked: unranked,
    lastPulledAt: end.toISOString(),
    windowDays,
  };
}
