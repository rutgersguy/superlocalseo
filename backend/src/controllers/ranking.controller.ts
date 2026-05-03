import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { syncRankingsForClient } from '../jobs/rankings.job';

export const listQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  keywordId: z.string().uuid().optional(),
  searchEngine: z.enum(['google', 'bing']).optional(),
  rankType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  page: z.coerce.number().int().min(1).default(1),
});

export const trendQuerySchema = z.object({
  keywordId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

type ListQuery = z.infer<typeof listQuerySchema>;
type TrendQuery = z.infer<typeof trendQuerySchema>;

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as ListQuery;
    const { locationId, keywordId, searchEngine, rankType, limit, page } = query;

    // Get latest snapshot per keyword+location+search_engine using a subquery
    const latestSubquery = db('ranking_snapshots')
      .select(
        db.raw('DISTINCT ON (keyword_id, location_id, search_engine) keyword_id, location_id, search_engine, rank, url_ranked, pulled_at, id, rank_type'),
      )
      .orderByRaw('keyword_id, location_id, search_engine, pulled_at DESC')
      .as('latest');

    // Get second-most-recent for delta calculation
    const previousSubquery = db('ranking_snapshots')
      .select(
        db.raw('DISTINCT ON (keyword_id, location_id, search_engine) keyword_id, location_id, search_engine, rank as prev_rank'),
      )
      .where(
        'id',
        'not in',
        db('ranking_snapshots')
          .select(db.raw('DISTINCT ON (keyword_id, location_id, search_engine) id'))
          .orderByRaw('keyword_id, location_id, search_engine, pulled_at DESC'),
      )
      .orderByRaw('keyword_id, location_id, search_engine, pulled_at DESC')
      .as('previous');

    let baseQuery = db
      .from(latestSubquery)
      .leftJoin(previousSubquery, function () {
        this.on('latest.keyword_id', '=', 'previous.keyword_id')
          .andOn('latest.location_id', '=', 'previous.location_id')
          .andOn('latest.search_engine', '=', 'previous.search_engine');
      })
      .join('keywords', 'latest.keyword_id', 'keywords.id')
      .join('locations', 'latest.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .select(
        'latest.keyword_id as keywordId',
        'keywords.keyword',
        'latest.location_id as locationId',
        'locations.name as location',
        'latest.rank',
        'previous.prev_rank as previousRank',
        'latest.search_engine as searchEngine',
        'latest.url_ranked as url',
        'latest.pulled_at as pulledAt',
      );

    if (locationId) baseQuery = baseQuery.where('latest.location_id', locationId);
    if (keywordId) baseQuery = baseQuery.where('latest.keyword_id', keywordId);
    if (searchEngine) baseQuery = baseQuery.where('latest.search_engine', searchEngine);
    if (rankType && rankType !== 'all') baseQuery = baseQuery.where('latest.rank_type', rankType);

    const offset = (page - 1) * limit;
    const rows = await baseQuery.limit(limit).offset(offset);

    const results = rows.map((r: Record<string, unknown>) => ({
      keywordId: r.keywordId,
      keyword: r.keyword,
      locationId: r.locationId,
      location: r.location,
      rank: r.rank,
      previousRank: r.previousRank ?? null,
      delta: r.rank != null && r.previousRank != null ? (r.previousRank as number) - (r.rank as number) : null,
      searchEngine: r.searchEngine,
      url: r.url,
      pulledAt: r.pulledAt,
    }));

    ok(res, results);
  } catch (e) {
    next(e);
  }
}

export async function trend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as TrendQuery;
    const { keywordId, locationId, days } = query;

    const since = new Date();
    since.setDate(since.getDate() - (days ?? 30));

    let baseQuery = db('ranking_snapshots')
      .join('keywords', 'ranking_snapshots.keyword_id', 'keywords.id')
      .join('locations', 'ranking_snapshots.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .where('ranking_snapshots.keyword_id', keywordId)
      .where('ranking_snapshots.pulled_at', '>=', since)
      .select(
        db.raw(`DATE(ranking_snapshots.pulled_at) as date`),
        db.raw(`ROUND(AVG(ranking_snapshots.rank)) as rank`),
      )
      .groupByRaw('DATE(ranking_snapshots.pulled_at)')
      .orderBy('date', 'asc');

    if (locationId) {
      baseQuery = baseQuery.where('ranking_snapshots.location_id', locationId);
    }

    const rows = await baseQuery;

    ok(res, rows.map((r: Record<string, unknown>) => ({
      date: r.date,
      rank: r.rank !== null ? Number(r.rank) : null,
    })));
  } catch (e) {
    next(e);
  }
}

export async function sync(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Enforce 24-hour cooldown based on last_pull_at on the BrightLocal integration
    const integration = await db('integrations')
      .where({ client_id: req.clientId, provider: 'brightlocal', status: 'connected' })
      .select('last_pull_at')
      .first();

    if (integration?.last_pull_at) {
      const lastPull = new Date(integration.last_pull_at as string);
      const hoursSince = (Date.now() - lastPull.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        const nextAvailable = new Date(lastPull.getTime() + 24 * 60 * 60 * 1000);
        err(res, `Rankings were last synced ${Math.round(hoursSince)}h ago. Next sync available at ${nextAvailable.toLocaleTimeString()}.`, 429, 'SYNC_COOLDOWN');
        return;
      }
    }

    const result = await syncRankingsForClient(req.clientId as string);

    ok(res, {
      ...result,
      message: result.noIntegration
        ? 'No BrightLocal integration found. Connect BrightLocal in Settings → Integrations.'
        : result.noCampaignIds
          ? `Found ${result.locationsFound} location(s) but none have a BrightLocal campaign ID linked. Contact support to link your campaigns.`
          : result.snapshotsSaved > 0
            ? `Synced ${result.snapshotsSaved} ranking data point(s) across ${result.locationsWithCampaign} location(s).`
            : `Found ${result.locationsWithCampaign} linked campaign(s) but BrightLocal returned no ranking data yet — it may take 24–48h after campaign creation.`,
    });
  } catch (e) {
    next(e);
  }
}
