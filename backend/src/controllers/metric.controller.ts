import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { ok } from '../utils/response';

export async function visibilityScore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = req.query.locationId as string | undefined;

    let query = db('metrics_daily')
      .where({ client_id: req.clientId })
      .whereRaw(`date >= CURRENT_DATE - INTERVAL '30 days'`)
      .orderBy('date', 'asc');

    if (locationId) query = query.where({ location_id: locationId });

    const rows = await query.select('date', 'avg_ranking', 'citation_completeness', 'avg_rating') as Array<{
      date: string;
      avg_ranking: string | null;
      citation_completeness: string | null;
      avg_rating: string | null;
    }>;

    function computeScore(row: typeof rows[0]): number | null {
      const avgRank = row.avg_ranking ? parseFloat(String(row.avg_ranking)) : null;
      const citScore = row.citation_completeness ? parseFloat(String(row.citation_completeness)) : null;
      const avgRat = row.avg_rating ? parseFloat(String(row.avg_rating)) : null;

      if (avgRank === null && citScore === null && avgRat === null) return null;

      const rankingScore = avgRank !== null ? 100 - Math.min(99, Math.max(0, avgRank - 1)) : 50;
      const citationScore = citScore !== null ? Math.min(100, Math.max(0, citScore)) : 50;
      const reviewScore = avgRat !== null ? Math.min(100, Math.max(0, (avgRat - 1) / 4 * 100)) : 50;

      return Math.round(rankingScore * 0.5 + citationScore * 0.3 + reviewScore * 0.2);
    }

    const byDate = new Map<string, number[]>();
    for (const row of rows) {
      const score = computeScore(row);
      if (score === null) continue;
      const d = String(row.date).slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(score);
    }

    const series = Array.from(byDate.entries()).map(([date, scores]) => ({
      date,
      score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }));

    const current = series[series.length - 1]?.score ?? null;
    const prior30 = series[0]?.score ?? null;
    const delta = current !== null && prior30 !== null ? current - prior30 : null;

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
