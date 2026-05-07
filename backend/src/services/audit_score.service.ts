import { db } from '../db/connection';
import { getDirectoriesForIndustry } from '../config/industry.config';

export interface AuditScores {
  napScore: number;
  citationScore: number;
  rankingScore: number;
  compositeScore: number;
}

export async function computeAuditScores(locationId: string, industry: string | null | undefined): Promise<AuditScores> {
  const [citationRows, rankRows] = await Promise.all([
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
  ]);

  // NAP score: % of listed dirs with accurate NAP
  const listed = citationRows.filter((r) => r.listed);
  const napAccurate = listed.filter(
    (r) => r.nap_name_match !== false && r.nap_address_match !== false && r.nap_phone_match !== false,
  );
  const napScore = listed.length > 0 ? Math.round((napAccurate.length / listed.length) * 100) : 0;

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

  return { napScore, citationScore, rankingScore, compositeScore };
}
