import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok } from '../utils/response';
import { latestRanks, estimateTraffic, RankObservation, citationHistory } from '../services/measurement.service';

export const rankingsHistorySchema = z.object({
  keywordId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().min(1).max(730).optional(),
  rankType: z.string().optional(),
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

    let to: Date = new Date();
    if (q.to) to = new Date(q.to);

    let query = db('ranking_snapshots')
      .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
      .join('locations', 'ranking_snapshots.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
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
    if (q.rankType && q.rankType !== 'all') query = query.where('ranking_snapshots.rank_type', q.rankType);

    if (q.from) {
      query = query.where('ranking_snapshots.pulled_at', '>=', new Date(q.from));
    } else if (q.days) {
      const from = new Date(to);
      from.setDate(from.getDate() - q.days);
      query = query.where('ranking_snapshots.pulled_at', '>=', from);
    } else {
      const minRow = await db('ranking_snapshots')
        .where('ranking_snapshots.keyword_id', q.keywordId ?? db.raw('ranking_snapshots.keyword_id'))
        .join('locations', 'ranking_snapshots.location_id', 'locations.id')
        .where('locations.client_id', req.clientId)
        .min('ranking_snapshots.pulled_at as min_pulled')
        .first() as { min_pulled: Date | null } | undefined;
      if (minRow?.min_pulled) {
        query = query.where('ranking_snapshots.pulled_at', '>=', minRow.min_pulled);
      }
    }

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
      from = new Date(to);
      from.setDate(from.getDate() - (q.days ?? 30));
    }

    let volumeQuery = db('reviews')
      .where('reviews.client_id', req.clientId)
      .where('reviews.review_date', '>=', from)
      .where('reviews.review_date', '<=', to)
      .select(
        db.raw(`(reviews.review_date AT TIME ZONE 'UTC')::date ::text as date`),
        'reviews.platform',
        db.raw(`COUNT(*) as count`),
        db.raw(`COUNT(reviews.rating) as rated_count`),
        db.raw(`SUM(reviews.rating) as rating_total`),
      )
      .groupByRaw("(reviews.review_date AT TIME ZONE 'UTC')::date, reviews.platform")
      .orderBy('date', 'asc');

    if (q.platform) volumeQuery = volumeQuery.where('reviews.platform', q.platform);

    const rows = await volumeQuery;

    // Build date-bucketed volume series and sentiment series
    const dateMap: Record<string, Record<string, number>> = {};
    const avgRatingByDate: Record<string, { total: number; count: number }> = {};

    for (const r of rows as Array<{ date: string; platform: string; count: string; rating_total: string | null; rated_count: string }>) {
      const d = r.date;
      if (!dateMap[d]) dateMap[d] = {};
      dateMap[d][r.platform] = Number(r.count);
      if (!avgRatingByDate[d]) avgRatingByDate[d] = { total: 0, count: 0 };
      avgRatingByDate[d].total += Number(r.rating_total ?? 0);
      avgRatingByDate[d].count += Number(r.rated_count);
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

const DEFAULT_ROI = { avgCustomerValue: 0, conversionRate: 2.5 };

export async function roi(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = req.client as Record<string, unknown>;
    const cfg = { ...DEFAULT_ROI, ...(client.roi_config as object ?? {}) };

    const rows = await latestRanks(req.clientId, new Date()) as RankObservation[];
    ok(res, { roiConfig: cfg, ...estimateTraffic(rows, cfg) });
  } catch (e) {
    next(e);
  }
}

export async function updateRoiConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { avgCustomerValue, conversionRate } = z.object({
      avgCustomerValue: z.number().min(0).optional(),
      conversionRate: z.number().min(0).max(100).optional(),
    }).parse(req.body);

    const client = req.client as Record<string, unknown>;
    const current = { ...DEFAULT_ROI, ...(client.roi_config as object ?? {}) };
    const merged = {
      ...current,
      ...(avgCustomerValue !== undefined ? { avgCustomerValue } : {}),
      ...(conversionRate !== undefined ? { conversionRate } : {}),
    };

    await db('clients').where({ id: req.clientId }).update({
      roi_config: merged,
      updated_at: new Date(),
    });

    ok(res, { roiConfig: merged });
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

export async function citationTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { days, locationId } = z.object({ days: z.coerce.number().int().min(7).max(180).default(90), locationId: z.string().uuid().optional() }).parse(req.query);
    const series = await citationHistory(req.clientId, days, locationId);

    ok(res, { series, days });
  } catch (e) { next(e); }
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
