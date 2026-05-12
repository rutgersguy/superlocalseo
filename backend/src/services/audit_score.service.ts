import { db } from '../db/connection';
import { getDirectoriesForIndustry } from '../config/industry.config';
import { checkOnPageSeo } from './onpage.service';
import { submitLighthouseTask } from './dataforseo.service';

export interface AuditScores {
  napScore: number;
  citationScore: number;
  rankingScore: number;
  compositeScore: number;
  onPageScore: number | null;
  onPageDetails: string[];
  dfsLighthouseTaskId: string | null;
}

export async function computeAuditScores(locationId: string, industry: string | null | undefined): Promise<AuditScores> {
  const [citationRows, rankRows, location] = await Promise.all([
    db('citation_snapshots')
      .where({ location_id: locationId })
      .select('directory', 'listed', 'nap_name_match', 'nap_address_match', 'nap_phone_match') as Promise<Array<{
        directory: string; listed: boolean;
        nap_name_match: boolean | null; nap_address_match: boolean | null; nap_phone_match: boolean | null;
      }>>,
    db('ranking_snapshots')
      .where({ location_id: locationId })
      .whereNotNull('rank')
      .select('rank') as Promise<Array<{ rank: number }>>,
    db('locations').where({ id: locationId }).select('website').first() as Promise<{ website: string | null } | undefined>,
  ]);

  // NAP score: % of listed dirs with accurate NAP — only among rows that have detail data.
  // Rows where all three NAP fields are null have no detail (BrightLocal didn't return field-level
  // NAP data for that directory) and must not be counted as "accurate".
  const listed = citationRows.filter((r) => r.listed);
  const withDetail = listed.filter(
    (r) => r.nap_name_match !== null || r.nap_address_match !== null || r.nap_phone_match !== null,
  );
  const napAccurate = withDetail.filter(
    (r) => r.nap_name_match !== false && r.nap_address_match !== false && r.nap_phone_match !== false,
  );
  const napScore = withDetail.length > 0
    ? Math.round((napAccurate.length / withDetail.length) * 100)
    : 0;

  // Citation score: % of target dirs where listed
  const targetDirs = getDirectoriesForIndustry(industry);
  const listedDirs = new Set(listed.map((r) => r.directory));
  const citationScore =
    targetDirs.length > 0
      ? Math.round((targetDirs.filter((d) => listedDirs.has(d)).length / targetDirs.length) * 100)
      : 0;

  // Ranking score: map avg rank to 0–100 (rank 1=100, rank 20=60, rank 50=10, >50=0)
  let rankingScore = 0;
  if (rankRows.length > 0) {
    const avg = rankRows.reduce((sum, r) => sum + r.rank, 0) / rankRows.length;
    rankingScore = Math.max(0, Math.round(110 - avg * 2));
  }

  // Composite: citations 40%, NAP 30%, rankings 30%
  const compositeScore = Math.round(citationScore * 0.4 + napScore * 0.3 + rankingScore * 0.3);

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
