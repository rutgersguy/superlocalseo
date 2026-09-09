import { db } from '../db/connection';
import { summarizeCitations, summarizeRanks, CitationObservation } from './measurement.service';
import { checkOnPageSeo } from './onpage.service';
import { submitLighthouseTask } from './dataforseo.service';

export interface AuditScores {
  napScore: number | null;
  citationScore: number | null;
  rankingScore: number | null;
  compositeScore: number | null;
  onPageScore: number | null;
  onPageDetails: string[];
  dfsLighthouseTaskId: string | null;
}

export async function computeAuditScores(locationId: string, industry: string | null | undefined): Promise<AuditScores> {
  const now = new Date();
  const [citationRows, rankRows, location] = await Promise.all([
    db('citation_snapshots').where({ location_id: locationId }).where('pulled_at', '<=', now)
      .distinctOn('directory').select('*').orderByRaw('directory, pulled_at DESC, id DESC'),
    db('ranking_snapshots').where({ location_id: locationId }).where('pulled_at', '<=', now)
      .distinctOn('keyword_id', 'search_engine', 'geo_location').select('rank')
      .orderByRaw('keyword_id, search_engine, geo_location, pulled_at DESC, id DESC'),
    db('locations').where({ id: locationId }).select('website').first() as Promise<{ website: string | null } | undefined>,
  ]);
  const { napScore, citationScore, rankingScore, compositeScore } = summarizeAuditScores(citationRows, rankRows);

  // On-page SEO: crawl the location's website if one is configured
  let onPageScore: number | null = null;
  let onPageDetails: string[] = [];
  let dfsLighthouseTaskId: string | null = null;
  const website = location?.website?.trim();
  if (website) {
    try {
      const result = await checkOnPageSeo(website);
      onPageScore = result.score;
      onPageDetails = result.details;
    } catch {
      // non-blocking — on-page failure doesn't break the audit
    }
    // Submit Lighthouse task asynchronously — result polled later
    dfsLighthouseTaskId = await submitLighthouseTask(website).catch(() => null);
  }

  return { napScore, citationScore, rankingScore, compositeScore, onPageScore, onPageDetails, dfsLighthouseTaskId };
}

/** Heuristic, not a Google score. Missing components do not silently become zero. */
export function summarizeAuditScores(citations: CitationObservation[], ranks: Array<{ rank: number | null }>) {
  const c = summarizeCitations(citations);
  const r = summarizeRanks(ranks);
  const napScore = c.napChecked ? Math.round(c.napAccurate / c.napChecked * 100) : null;
  const citationScore = c.score;
  // Top-10 coverage includes unranked observations and is bounded at 0–100.
  const rankingScore = r.observed ? Math.round(r.keywordsInTop10 / r.observed * 100) : null;
  const compositeScore = napScore == null || citationScore == null || rankingScore == null ? null
    : Math.round(citationScore * .4 + napScore * .3 + rankingScore * .3);
  return { napScore, citationScore, rankingScore, compositeScore };
}
