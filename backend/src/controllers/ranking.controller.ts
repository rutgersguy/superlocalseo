import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { redis } from '../db/redis';
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

    // Get latest snapshot per keyword+location+engine+geo_location
    const latestSubquery = db('ranking_snapshots')
      .select(
        db.raw('DISTINCT ON (keyword_id, location_id, search_engine, geo_location) keyword_id, location_id, search_engine, geo_location, rank, url_ranked, pulled_at, id, rank_type'),
      )
      .orderByRaw('keyword_id, location_id, search_engine, geo_location, pulled_at DESC')
      .as('latest');

    // Get second-most-recent for delta calculation (per geo_location)
    const previousSubquery = db('ranking_snapshots')
      .select(
        db.raw('DISTINCT ON (keyword_id, location_id, search_engine, geo_location) keyword_id, location_id, search_engine, geo_location, rank as prev_rank'),
      )
      .where(
        'id',
        'not in',
        db('ranking_snapshots')
          .select(db.raw('DISTINCT ON (keyword_id, location_id, search_engine, geo_location) id'))
          .orderByRaw('keyword_id, location_id, search_engine, geo_location, pulled_at DESC'),
      )
      .orderByRaw('keyword_id, location_id, search_engine, geo_location, pulled_at DESC')
      .as('previous');

    let baseQuery = db
      .from(latestSubquery)
      .leftJoin(previousSubquery, function () {
        this.on('latest.keyword_id', '=', 'previous.keyword_id')
          .andOn('latest.location_id', '=', 'previous.location_id')
          .andOn('latest.search_engine', '=', 'previous.search_engine')
          .andOnVal(db.raw('latest.geo_location IS NOT DISTINCT FROM previous.geo_location'));
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
        'latest.geo_location as geoLocation',
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
      geoLocation: r.geoLocation ?? null,
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
    const cooldownKey = `rankings:sync:cooldown:${req.clientId as string}`;
    const lastSyncStr = await redis.get(cooldownKey);

    if (lastSyncStr) {
      const lastManualRefresh = new Date(lastSyncStr);
      const hoursSince = (Date.now() - lastManualRefresh.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        const timeStr = lastManualRefresh.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).replace(' AM', 'am').replace(' PM', 'pm');
        err(res, `Rankings were manually refreshed today at ${timeStr} EST. Manual refreshes are limited to once every 24 hours.`, 429, 'SYNC_COOLDOWN');
        return;
      }
    }

    await redis.set(cooldownKey, new Date().toISOString(), 'EX', 24 * 60 * 60);

    const result = await syncRankingsForClient(req.clientId as string);

    ok(res, {
      ...result,
      message: result.notConfigured
        ? 'BrightLocal is not configured on this server. Contact support.'
        : result.noKeywords
          ? `Found ${result.locationsFound} location(s) but no keywords are set up yet. Add keywords in Settings → Keywords.`
          : result.snapshotsSaved > 0
            ? `Refreshed ${result.snapshotsSaved} ranking data point(s) across ${result.locationsWithKeywords} location(s).`
            : result.errors.length > 0
              ? `Could not reach BrightLocal: ${result.errors[0]?.message ?? 'unknown error'}`
              : `Found ${result.locationsWithKeywords} location(s) with keywords but no ranking data returned yet — check server logs.`,
    });
  } catch (e) {
    next(e);
  }
}
