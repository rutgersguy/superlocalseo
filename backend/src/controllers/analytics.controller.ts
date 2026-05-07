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
      const from = new Date();
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

// CTR curves — local pack (map pack) clicks are lower-intent than organic
const CTR_ORGANIC: Record<number, number> = {
  1: 0.285, 2: 0.157, 3: 0.110, 4: 0.080, 5: 0.072,
  6: 0.051, 7: 0.040, 8: 0.032, 9: 0.028, 10: 0.025,
};
const CTR_LOCAL_PACK: Record<number, number> = {
  1: 0.050, 2: 0.038, 3: 0.028,
};
function ctrForRank(rank: number, rankType: string): number {
  if (rankType === 'local_pack') {
    return CTR_LOCAL_PACK[rank] ?? 0.010;
  }
  if (rank <= 10) return CTR_ORGANIC[rank] ?? 0.025;
  if (rank <= 20) return 0.010;
  return 0.003;
}

const DEFAULT_ROI = { avgCustomerValue: 0, conversionRate: 2.5 };

export async function roi(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = req.client as Record<string, unknown>;
    const cfg = { ...DEFAULT_ROI, ...(client.roi_config as object ?? {}) };

    // Latest rank per keyword for this client
    const rows = await db('ranking_snapshots')
      .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
      .join('locations', 'ranking_snapshots.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .whereNotNull('ranking_snapshots.rank')
      .select(
        'keywords.id as keywordId',
        'keywords.keyword',
        'keywords.monthly_search_volume as monthlySearchVolume',
        'locations.name as location',
        'ranking_snapshots.location_id as locationId',
        db.raw('MAX(ranking_snapshots.pulled_at) as latest_pulled'),
      )
      .groupBy('keywords.id', 'keywords.keyword', 'keywords.monthly_search_volume', 'locations.name', 'ranking_snapshots.location_id');

    // For each group, get the rank at the latest pull
    const keywordIds = rows.map((r) => r.keywordId);
    const latestRanks = keywordIds.length
      ? await db('ranking_snapshots')
          .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
          .join('locations', 'ranking_snapshots.location_id', 'locations.id')
          .where('locations.client_id', req.clientId)
          .whereIn('keywords.id', keywordIds)
          .select(
            'keywords.id as keywordId',
            'ranking_snapshots.location_id as locationId',
            'ranking_snapshots.rank',
            'ranking_snapshots.rank_type as rankType',
            'ranking_snapshots.pulled_at as pulledAt',
          )
          .orderBy('ranking_snapshots.pulled_at', 'desc')
      : [];

    // Build a map: keywordId+locationId → { rank, rankType } (first = latest)
    const rankMap: Record<string, { rank: number; rankType: string }> = {};
    for (const r of latestRanks as Array<{ keywordId: string; locationId: string; rank: number; rankType: string }>) {
      const key = `${r.keywordId}:${r.locationId}`;
      if (!(key in rankMap)) rankMap[key] = { rank: r.rank, rankType: r.rankType ?? 'organic' };
    }

    const convRate = (cfg.conversionRate as number) / 100;

    let totalClicks = 0;
    let totalLeads = 0;
    let totalRevenue = 0;

    const keywords = rows.map((r) => {
      const key = `${r.keywordId}:${r.locationId}`;
      const rankEntry = rankMap[key];
      const rank: number = rankEntry?.rank ?? 0;
      const rankType: string = rankEntry?.rankType ?? 'organic';
      const vol: number = (r.monthlySearchVolume as number) ?? 0;
      const ctr = rank > 0 ? ctrForRank(rank, rankType) : 0;
      const estClicks = Math.round(vol * ctr);
      const estLeads = Math.round(estClicks * convRate * 10) / 10;
      const estRevenue = Math.round(estLeads * (cfg.avgCustomerValue as number));

      totalClicks += estClicks;
      totalLeads += estLeads;
      totalRevenue += estRevenue;

      return {
        keywordId: r.keywordId,
        keyword: r.keyword,
        location: r.location,
        locationId: r.locationId,
        monthlySearchVolume: vol || null,
        rank: rank || null,
        ctr: rank > 0 ? Math.round(ctr * 1000) / 10 : null, // as % with 1 decimal
        estClicks: vol && rank ? estClicks : null,
        estLeads: vol && rank ? estLeads : null,
        estRevenue: vol && rank ? estRevenue : null,
      };
    });

    ok(res, {
      roiConfig: cfg,
      keywords,
      totals: {
        estClicks: totalClicks,
        estLeads: Math.round(totalLeads * 10) / 10,
        estRevenue: totalRevenue,
      },
    });
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
    const days = Math.min(180, Math.max(7, parseInt(String(req.query.days ?? '90'), 10)));
    const locationId = req.query.locationId as string | undefined;

    let query = db('citation_snapshots')
      .where({ 'locations.client_id': req.clientId })
      .join('locations', 'citation_snapshots.location_id', 'locations.id')
      .whereRaw(`citation_snapshots.pulled_at >= NOW() - INTERVAL '${days} days'`);

    if (locationId) query = query.where('citation_snapshots.location_id', locationId);

    const rows = await query
      .select(
        db.raw(`DATE(citation_snapshots.pulled_at) AS date`),
        db.raw(`COUNT(*) AS total`),
        db.raw(`SUM(CASE WHEN citation_snapshots.listed THEN 1 ELSE 0 END) AS listed`)
      )
      .groupByRaw(`DATE(citation_snapshots.pulled_at)`)
      .orderBy('date', 'asc') as Array<{ date: string; total: string; listed: string }>;

    const series = rows.map((r) => ({
      date: r.date,
      completeness: Math.round((parseInt(r.listed) / Math.max(1, parseInt(r.total))) * 100),
    }));

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
