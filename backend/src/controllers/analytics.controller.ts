import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok } from '../utils/response';

export const rankingsHistorySchema = z.object({
  keywordId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().min(1).max(730).optional(),
});

export const reviewsTrendSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().min(1).max(730).default(30),
  platform: z.string().optional(),
});

export async function rankingsHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as z.infer<typeof rankingsHistorySchema>;

    let from: Date;
    let to: Date = new Date();

    if (q.from) {
      from = new Date(q.from);
    } else {
      from = new Date();
      from.setDate(from.getDate() - (q.days ?? 90));
    }
    if (q.to) to = new Date(q.to);

    let query = db('ranking_snapshots')
      .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
      .join('locations', 'ranking_snapshots.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .where('ranking_snapshots.pulled_at', '>=', from)
      .where('ranking_snapshots.pulled_at', '<=', to)
      .select(
        'ranking_snapshots.id',
        'keywords.keyword',
        'ranking_snapshots.keyword_id as keywordId',
        'locations.name as location',
        'ranking_snapshots.location_id as locationId',
        'ranking_snapshots.rank',
        'ranking_snapshots.pulled_at as pulledAt',
      )
      .orderBy('ranking_snapshots.pulled_at', 'asc');

    if (q.keywordId) query = query.where('ranking_snapshots.keyword_id', q.keywordId);
    if (q.locationId) query = query.where('ranking_snapshots.location_id', q.locationId);

    const rows = await query;
    ok(res, rows);
  } catch (e) {
    next(e);
  }
}

export async function reviewsTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as z.infer<typeof reviewsTrendSchema>;

    let from: Date;
    const to: Date = q.to ? new Date(q.to) : new Date();
    if (q.from) {
      from = new Date(q.from);
    } else {
      from = new Date();
      from.setDate(from.getDate() - (q.days ?? 30));
    }

    let volumeQuery = db('reviews')
      .where('reviews.client_id', req.clientId)
      .where('reviews.review_date', '>=', from)
      .where('reviews.review_date', '<=', to)
      .select(
        db.raw(`DATE(reviews.review_date) as date`),
        'reviews.platform',
        db.raw(`COUNT(*) as count`),
        db.raw(`ROUND(AVG(reviews.rating)::numeric, 2) as avg_rating`),
      )
      .groupByRaw('DATE(reviews.review_date), reviews.platform')
      .orderBy('date', 'asc');

    if (q.platform) volumeQuery = volumeQuery.where('reviews.platform', q.platform);

    const rows = await volumeQuery;

    // Build date-bucketed volume series and sentiment series
    const dateMap: Record<string, Record<string, number>> = {};
    const avgRatingByDate: Record<string, { total: number; count: number }> = {};

    for (const r of rows as Array<{ date: string; platform: string; count: string; avg_rating: string }>) {
      const d = r.date;
      if (!dateMap[d]) dateMap[d] = {};
      dateMap[d][r.platform] = Number(r.count);
      if (!avgRatingByDate[d]) avgRatingByDate[d] = { total: 0, count: 0 };
      avgRatingByDate[d].total += Number(r.avg_rating) * Number(r.count);
      avgRatingByDate[d].count += Number(r.count);
    }

    const volume = Object.entries(dateMap).map(([date, platforms]) => ({ date, ...platforms }));
    const sentiment = Object.entries(avgRatingByDate).map(([date, v]) => ({
      date,
      avgRating: v.count > 0 ? Math.round((v.total / v.count) * 100) / 100 : null,
    }));

    ok(res, { volume, sentiment });
  } catch (e) {
    next(e);
  }
}

export async function exportCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { type = 'rankings' } = req.query as { type?: 'rankings' | 'reviews' };

    if (type === 'rankings') {
      const rows = await db('ranking_snapshots')
        .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
        .join('locations', 'ranking_snapshots.location_id', 'locations.id')
        .where('locations.client_id', req.clientId)
        .select(
          'keywords.keyword',
          'locations.name as location',
          'ranking_snapshots.rank',
          'ranking_snapshots.search_engine as searchEngine',
          'ranking_snapshots.pulled_at as pulledAt',
        )
        .orderBy('ranking_snapshots.pulled_at', 'desc');

      const header = 'keyword,location,rank,search_engine,pulled_at\n';
      const csv = header + rows.map((r: Record<string, unknown>) =>
        [r.keyword, r.location, r.rank, r.searchEngine, r.pulledAt].map(csvEscape).join(','),
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="rankings-export.csv"`);
      res.send(csv);
    } else {
      const rows = await db('reviews')
        .where('client_id', req.clientId)
        .select('platform', 'author_name', 'rating', 'status', 'sentiment', 'review_date', 'body')
        .orderBy('review_date', 'desc');

      const header = 'platform,author_name,rating,status,sentiment,review_date,body\n';
      const csv = header + rows.map((r: Record<string, unknown>) =>
        [r.platform, r.author_name, r.rating, r.status, r.sentiment, r.review_date, r.body].map(csvEscape).join(','),
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="reviews-export.csv"`);
      res.send(csv);
    }
  } catch (e) {
    next(e);
  }
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
