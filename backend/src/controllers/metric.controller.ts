import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok } from '../utils/response';
import { latestRanks, latestCitations, summarizeRanks, summarizeCitations } from '../services/measurement.service';

export async function visibilityScore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // A labeled coverage measure replaces the undocumented composite that mixed
    // today's review/citation values into every historical day.
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    const loc = req.query.locationId as string | undefined;
    const daily = db('ranking_snapshots as rs').join('locations as l', 'rs.location_id', 'l.id')
      .where('l.client_id', req.clientId).whereBetween('rs.pulled_at', [start, end])
      .modify(q => { if (loc) q.where('l.id', loc); })
      .select(db.raw("DISTINCT ON ((rs.pulled_at AT TIME ZONE 'UTC')::date, rs.keyword_id, rs.location_id, rs.search_engine, rs.geo_location) rs.id"))
      .select(db.raw("(rs.pulled_at AT TIME ZONE 'UTC')::date::text as date"), 'rs.rank')
      .orderByRaw("(rs.pulled_at AT TIME ZONE 'UTC')::date, rs.keyword_id, rs.location_id, rs.search_engine, rs.geo_location, rs.pulled_at DESC, rs.id DESC");
    const rows = await daily as Array<{ date: string; rank: number | null }>;
    const groups = new Map<string, Array<{ rank: number | null }>>();
    for (const row of rows) groups.set(row.date, [...(groups.get(row.date) ?? []), row]);
    const series = [...groups.entries()].map(([date, values]) => ({ date,
      score: Math.round(values.filter(r => r.rank != null && r.rank > 0 && r.rank <= 10).length / values.length * 100) }));
    const current = series[series.length - 1]?.score ?? null;
    const delta = current != null && series.length > 1 ? current - series[0].score : null;
    ok(res, { current, delta, series, methodology: 'Top-10 share of the latest collected observation per keyword/location/area/engine on each UTC day. Unranked results are included; uncollected checks are not. Changes can reflect coverage changes.' });
  } catch (e) { next(e); }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [rankRows, citations, locations, keywords, reviews, newReviews] = await Promise.all([
      latestRanks(req.clientId, now), latestCitations(req.clientId, now),
      db('locations').where('client_id', req.clientId).count('id as n').first(),
      db('keywords as k').join('locations as l', 'k.location_id', 'l.id').where('l.client_id', req.clientId).count('k.id as n').first(),
      db('reviews').where('client_id', req.clientId).where('review_date', '<=', now).count('id as n').avg('rating as rating').first(),
      db('reviews').where('client_id', req.clientId).whereBetween('review_date', [start, now]).count('id as n').first(),
    ]);
    const ranks = summarizeRanks(rankRows);
    ok(res, { avgRank: ranks.avgRank, keywordsInTop3: ranks.keywordsInTop3, keywordsInTop10: ranks.keywordsInTop10,
      totalKeywords: Number(keywords?.n ?? 0), observedCount: ranks.observed, unrankedCount: ranks.absent,
      totalReviews: Number(reviews?.n ?? 0), avgRating: reviews?.rating == null ? null : Number(reviews.rating),
      newReviewsThisMonth: Number(newReviews?.n ?? 0), citationScore: summarizeCitations(citations).score,
      locationCount: Number(locations?.n ?? 0), date: rankRows.length ? new Date(Math.max(...rankRows.map((r: { pulledAt: Date }) => new Date(r.pulledAt).getTime()))).toISOString() : null });
  } catch (e) { next(e); }
}
