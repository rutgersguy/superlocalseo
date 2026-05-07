import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok } from '../utils/response';

export async function visibilityScore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = req.query.locationId as string | undefined;

    // Daily avg rank from ranking_snapshots over the last 30 days
    let rankQuery = db('ranking_snapshots')
      .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
      .join('locations', 'keywords.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .whereNotNull('ranking_snapshots.rank')
      .whereRaw(`ranking_snapshots.pulled_at >= CURRENT_DATE - INTERVAL '30 days'`)
      .select(
        db.raw(`DATE(ranking_snapshots.pulled_at) as date`),
        db.raw(`AVG(ranking_snapshots.rank::numeric) as avg_rank`),
      )
      .groupByRaw(`DATE(ranking_snapshots.pulled_at)`)
      .orderBy('date', 'asc');

    if (locationId) rankQuery = rankQuery.where('locations.id', locationId);

    const rankRows = await rankQuery as Array<{ date: string; avg_rank: string }>;

    // Overall avg rating (used as a constant across all days)
    let ratingQuery = db('reviews')
      .where('client_id', req.clientId)
      .whereNotNull('rating')
      .select(db.raw(`AVG(rating::numeric) as avg_rating`));

    const ratingRow = await ratingQuery.first() as { avg_rating: string | null } | undefined;
    const avgRating = ratingRow?.avg_rating ? parseFloat(ratingRow.avg_rating) : null;
    const reviewScore = avgRating !== null ? Math.min(100, Math.max(0, (avgRating - 1) / 4 * 100)) : 50;

    // Latest citation completeness
    let citQuery = db('citation_snapshots')
      .join('locations', 'citation_snapshots.location_id', 'locations.id')
      .where('locations.client_id', req.clientId);

    if (locationId) citQuery = citQuery.where('citation_snapshots.location_id', locationId);

    const citRows = await citQuery.select('citation_snapshots.listed') as Array<{ listed: boolean }>;
    const citScore = citRows.length > 0
      ? Math.min(100, Math.max(0, (citRows.filter((c) => c.listed).length / citRows.length) * 100))
      : 50;

    // Build daily score series
    const series = rankRows.map((r) => {
      const avgRank = parseFloat(r.avg_rank);
      const rankingScore = Math.max(0, 100 - Math.min(99, avgRank - 1));
      return {
        date: String(r.date).slice(0, 10),
        score: Math.round(rankingScore * 0.5 + citScore * 0.3 + reviewScore * 0.2),
      };
    });

    const current = series[series.length - 1]?.score ?? null;
    const prior = series[0]?.score ?? null;
    const delta = current !== null && prior !== null && series.length > 1 ? current - prior : null;

    ok(res, { current, delta, series });
  } catch (e) { next(e); }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Try to get the latest metrics_daily row
    const latestMetrics = await db('metrics_daily')
      .where({ client_id: req.clientId })
      .orderBy('date', 'desc')
      .first();

    // Location count (always computed fresh)
    const locationCountResult = await db('locations')
      .where({ client_id: req.clientId })
      .count('id as cnt')
      .first();
    const locationCount = parseInt(String((locationCountResult as Record<string, unknown>)?.cnt ?? 0), 10);

    if (latestMetrics) {
      ok(res, {
        avgRank: latestMetrics.avg_rank !== null ? Number(latestMetrics.avg_rank) : null,
        keywordsInTop3: latestMetrics.keywords_in_top3,
        keywordsInTop10: latestMetrics.keywords_in_top10,
        totalKeywords: null, // not stored in metrics_daily, compute below
        totalReviews: latestMetrics.total_reviews,
        avgRating: latestMetrics.avg_rating !== null ? Number(latestMetrics.avg_rating) : null,
        newReviewsThisMonth: latestMetrics.new_reviews,
        citationScore: latestMetrics.citation_score !== null ? Number(latestMetrics.citation_score) : null,
        locationCount,
        date: latestMetrics.date,
      });
      return;
    }

    // Fall back to computing from raw tables
    // Keywords
    const totalKeywordsResult = await db('keywords')
      .join('locations', 'keywords.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .count('keywords.id as cnt')
      .first();
    const totalKeywords = parseInt(String((totalKeywordsResult as Record<string, unknown>)?.cnt ?? 0), 10);

    // Latest rank snapshots per keyword
    const latestRankRows = await db
      .from(
        db('ranking_snapshots')
          .select(
            db.raw('DISTINCT ON (keyword_id) keyword_id, rank, pulled_at'),
          )
          .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
          .join('locations', 'keywords.location_id', 'locations.id')
          .where('locations.client_id', req.clientId)
          .whereNotNull('ranking_snapshots.rank')
          .orderByRaw('keyword_id, pulled_at DESC')
          .as('lr'),
      )
      .select('lr.rank');

    const ranks = latestRankRows.map((r: Record<string, unknown>) => Number(r.rank));
    const avgRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
    const keywordsInTop3 = ranks.filter((r) => r <= 3).length;
    const keywordsInTop10 = ranks.filter((r) => r <= 10).length;

    // Reviews
    const totalReviewsResult = await db('reviews').where({ client_id: req.clientId }).count('id as cnt').first();
    const totalReviews = parseInt(String((totalReviewsResult as Record<string, unknown>)?.cnt ?? 0), 10);

    const avgRatingResult = await db('reviews')
      .where({ client_id: req.clientId })
      .whereNotNull('rating')
      .avg('rating as avg')
      .first();
    const avgRating = avgRatingResult ? Number((avgRatingResult as Record<string, unknown>).avg) : null;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const newReviewsResult = await db('reviews')
      .where({ client_id: req.clientId })
      .where('ingested_at', '>=', startOfMonth)
      .count('id as cnt')
      .first();
    const newReviewsThisMonth = parseInt(String((newReviewsResult as Record<string, unknown>)?.cnt ?? 0), 10);

    // Citation score: (listed / total) * 100 from latest snapshots
    const latestCitations = await db
      .from(
        db('citation_snapshots')
          .select(
            db.raw('DISTINCT ON (citation_snapshots.location_id, citation_snapshots.directory) citation_snapshots.listed'),
          )
          .join('locations', 'citation_snapshots.location_id', 'locations.id')
          .where('locations.client_id', req.clientId)
          .orderByRaw('citation_snapshots.location_id, citation_snapshots.directory, citation_snapshots.pulled_at DESC')
          .as('lc'),
      )
      .select('lc.listed');

    const totalDirs = latestCitations.length;
    const listedCount = latestCitations.filter((c: Record<string, unknown>) => c.listed).length;
    const citationScore = totalDirs > 0 ? Math.round((listedCount / totalDirs) * 100) : null;

    ok(res, {
      avgRank: avgRank !== null ? Math.round(avgRank * 10) / 10 : null,
      keywordsInTop3,
      keywordsInTop10,
      totalKeywords,
      totalReviews,
      avgRating: avgRating !== null ? Math.round(avgRating * 10) / 10 : null,
      newReviewsThisMonth,
      citationScore,
      locationCount,
      date: null,
    });
  } catch (e) {
    next(e);
  }
}
