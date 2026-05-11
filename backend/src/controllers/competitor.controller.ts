import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Queue } from 'bullmq';
import { db } from '../db/connection';
import { redis } from '../db/redis';
import { ok, err } from '../utils/response';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getCompetitorRankedKeywords } from '../services/dataforseo.service';

const createSchema = z.object({
  name: z.string().min(1).max(255),
  website: z.string().url().optional().or(z.literal('')),
  googlePlaceId: z.string().max(255).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const competitors = await db('competitors')
      .where({ client_id: req.clientId })
      .orderBy('name', 'asc');

    // Client's own review stats for comparison
    const clientStats = await db('reviews')
      .where({ client_id: req.clientId })
      .whereNotNull('rating')
      .select(db.raw('AVG(rating)::numeric(3,1) as avg_rating, COUNT(*) as review_count'))
      .first() as { avg_rating: string | null; review_count: string } | undefined;

    const platformBreakdown = await db('reviews')
      .where({ client_id: req.clientId })
      .whereNotNull('rating')
      .select('platform')
      .avg('rating as avg_rating')
      .count('id as count')
      .groupBy('platform')
      .orderBy('count', 'desc');

    ok(res, {
      competitors: competitors.map((c) => ({
        id: c.id,
        name: c.name,
        website: c.website,
        googlePlaceId: c.google_place_id,
        googleRating: c.google_rating ? parseFloat(c.google_rating) : null,
        googleReviewCount: c.google_review_count,
        lastSyncedAt: c.last_synced_at,
      })),
      clientStats: {
        avgRating: clientStats?.avg_rating ? parseFloat(clientStats.avg_rating) : null,
        reviewCount: parseInt(clientStats?.review_count ?? '0', 10),
        byPlatform: platformBreakdown.map((p) => ({
          platform: p.platform,
          avgRating: parseFloat(String(p.avg_rating)),
          count: parseInt(String(p.count), 10),
        })),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR');
      return;
    }

    const { name, website, googlePlaceId } = parsed.data;

    const [competitor] = await db('competitors')
      .insert({
        client_id: req.clientId,
        name,
        website: website || null,
        google_place_id: googlePlaceId || null,
      })
      .returning('*');

    // Immediately sync if we have a place_id
    if (googlePlaceId && config.googlePlacesApiKey) {
      try {
        await syncCompetitorPlaces(competitor.id as string, googlePlaceId);
        const updated = await db('competitors').where({ id: competitor.id }).first();
        ok(res, { competitor: formatCompetitor(updated) });
        return;
      } catch (syncErr) {
        logger.warn('Initial competitor sync failed', { error: (syncErr as Error).message });
      }
    }

    ok(res, { competitor: formatCompetitor(competitor) });
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deleted = await db('competitors')
      .where({ id: req.params.id, client_id: req.clientId })
      .delete();

    if (!deleted) {
      err(res, 'Competitor not found', 404, 'NOT_FOUND');
      return;
    }
    ok(res, { deleted: true });
  } catch (e) {
    next(e);
  }
}

export async function sync(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const competitor = await db('competitors')
      .where({ id: req.params.id, client_id: req.clientId })
      .first();

    if (!competitor) {
      err(res, 'Competitor not found', 404, 'NOT_FOUND');
      return;
    }

    if (!competitor.google_place_id) {
      err(res, 'No Google Place ID set for this competitor', 400, 'NO_PLACE_ID');
      return;
    }

    if (!config.googlePlacesApiKey) {
      err(res, 'Google Places API not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    await syncCompetitorPlaces(competitor.id as string, competitor.google_place_id as string);
    const updated = await db('competitors').where({ id: competitor.id }).first();
    ok(res, { competitor: formatCompetitor(updated) });
  } catch (e) {
    next(e);
  }
}

// Searches Google Places by name+website to find a place_id suggestion
export async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = String(req.query.q ?? '').trim();
    if (!query) {
      err(res, 'Query required', 400, 'BAD_REQUEST');
      return;
    }

    if (!config.googlePlacesApiKey) {
      ok(res, { results: [] });
      return;
    }

    // Bias results toward the client's primary location
    const primaryLoc = await db('locations')
      .where({ client_id: req.clientId })
      .select('city', 'state')
      .first() as { city: string | null; state: string | null } | undefined;

    const locationSuffix = [primaryLoc?.city, primaryLoc?.state].filter(Boolean).join(', ');
    const biasedQuery = locationSuffix ? `${query} ${locationSuffix}` : query;

    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(biasedQuery)}&key=${config.googlePlacesApiKey}`;
    const res2 = await fetch(url);
    const data = await res2.json() as {
      results?: Array<{ place_id: string; name: string; formatted_address?: string; rating?: number; user_ratings_total?: number }>;
    };

    ok(res, {
      results: (data.results ?? []).slice(0, 5).map((r) => ({
        placeId: r.place_id,
        name: r.name,
        address: r.formatted_address ?? null,
        rating: r.rating ?? null,
        reviewCount: r.user_ratings_total ?? null,
      })),
    });
  } catch (e) {
    next(e);
  }
}

export async function gap(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationRows = (
      await db('locations').where({ client_id: req.clientId }).select('id', 'name', 'city', 'state')
    ) as Array<{ id: string; name: string; city: string | null; state: string | null }>;

    if (locationRows.length === 0) {
      ok(res, { rows: [], summary: { winning: 0, losing: 0, uncontested: 0 }, competitors: [] });
      return;
    }

    const locIds = locationRows.map((l) => l.id);
    const locNameMap = new Map(locationRows.map((l) => [l.id, l.name]));
    const locAreaMap = new Map(locationRows.map((l) => [
      l.id,
      [l.city, l.state].filter(Boolean).join(', ') || l.name,
    ]));

    const competitors = await db('competitors')
      .where({ client_id: req.clientId })
      .select('id', 'name') as Array<{ id: string; name: string }>;

    const compNameMap = new Map(competitors.map((c) => [c.id, c.name]));

    // Latest client rank per keyword + location + geo
    const clientRows = await db.raw<{ rows: Array<{ keyword: string; keyword_id: string; location_id: string; geo_location: string | null; rank: number; pulled_at: string }> }>(`
      SELECT DISTINCT ON (rs.keyword_id, rs.location_id, COALESCE(rs.geo_location, ''))
        k.keyword, rs.keyword_id, rs.location_id, rs.geo_location, rs.rank, rs.pulled_at
      FROM ranking_snapshots rs
      JOIN keywords k ON rs.keyword_id = k.id
      WHERE rs.location_id = ANY(?) AND rs.rank IS NOT NULL
      ORDER BY rs.keyword_id, rs.location_id, COALESCE(rs.geo_location, ''), rs.pulled_at DESC
    `, [locIds]).then((r) => r.rows);

    // Latest competitor rank per competitor + keyword + location + geo
    const compRows = await db.raw<{ rows: Array<{ competitor_id: string; keyword_id: string; location_id: string; geo_location: string | null; rank: number | null }> }>(`
      SELECT DISTINCT ON (cr.competitor_id, cr.keyword_id, cr.location_id, COALESCE(cr.geo_location, ''))
        cr.competitor_id, cr.keyword_id, cr.location_id, cr.geo_location, cr.rank
      FROM competitor_rankings cr
      WHERE cr.location_id = ANY(?) AND cr.rank IS NOT NULL
      ORDER BY cr.competitor_id, cr.keyword_id, cr.location_id, COALESCE(cr.geo_location, ''), cr.pulled_at DESC
    `, [locIds]).then((r) => r.rows);

    // For each keyword+location+geo, find the best (lowest) competitor rank and who holds it.
    // Fall back to matching on keyword+location when geo_location isn't populated yet.
    type BestComp = { rank: number; competitorId: string };
    const bestCompMap = new Map<string, BestComp>();
    for (const r of compRows) {
      if (r.rank == null) continue;
      // Try geo-specific key first, then location-only fallback key
      for (const key of [
        `${r.keyword_id}:${r.location_id}:${r.geo_location ?? ''}`,
        `${r.keyword_id}:${r.location_id}:__any__`,
      ]) {
        const existing = bestCompMap.get(key);
        if (!existing || r.rank < existing.rank) {
          bestCompMap.set(key, { rank: r.rank, competitorId: r.competitor_id });
        }
      }
    }

    function getBestComp(kwId: string, locId: string, geo: string | null): BestComp | undefined {
      return bestCompMap.get(`${kwId}:${locId}:${geo ?? ''}`)
        ?? bestCompMap.get(`${kwId}:${locId}:__any__`);
    }

    const rows = clientRows.map((r) => {
      const best = getBestComp(r.keyword_id, r.location_id, r.geo_location);
      const status: 'winning' | 'losing' | 'uncontested' =
        !best ? 'uncontested'
        : r.rank <= best.rank ? 'winning'
        : 'losing';
      return {
        keyword: r.keyword,
        location: locNameMap.get(r.location_id) ?? r.location_id,
        area: r.geo_location ?? locAreaMap.get(r.location_id) ?? r.location_id,
        yourRank: r.rank,
        bestCompetitorRank: best?.rank ?? null,
        bestCompetitor: best ? (compNameMap.get(best.competitorId) ?? null) : null,
        status,
        lastChecked: r.pulled_at,
      };
    });

    rows.sort((a, b) => {
      const order = { losing: 0, winning: 1, uncontested: 2 };
      return order[a.status] - order[b.status];
    });

    const summary = {
      winning: rows.filter((r) => r.status === 'winning').length,
      losing: rows.filter((r) => r.status === 'losing').length,
      uncontested: rows.filter((r) => r.status === 'uncontested').length,
    };

    ok(res, {
      rows,
      summary,
      competitors: competitors.map((c) => ({
        id: c.id,
        name: c.name,
        // legacy fields kept so existing callers don't break
        website: null,
        googleRating: null,
        googleReviewCount: null,
      })),
    });
  } catch (e) {
    next(e);
  }
}

// ─── headToHead ───────────────────────────────────────────────────────────────

export async function headToHead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationRows = await db('locations')
      .where({ client_id: req.clientId })
      .select('id', 'name') as Array<{ id: string; name: string }>;

    if (locationRows.length === 0) {
      ok(res, { keywords: [], competitors: [] });
      return;
    }

    const locIds = locationRows.map((l) => l.id);
    const locNameMap = new Map(locationRows.map((l) => [l.id, l.name]));

    const competitors = await db('competitors')
      .where({ client_id: req.clientId })
      .select('id', 'name') as Array<{ id: string; name: string }>;

    // Latest client rank per keyword+location
    const clientRows = await db.raw<{ rows: Array<{ keyword: string; keyword_id: string; location_id: string; rank: number | null; pulled_at: string }> }>(`
      SELECT DISTINCT ON (rs.keyword_id, rs.location_id)
        k.keyword, rs.keyword_id, rs.location_id, rs.rank, rs.pulled_at
      FROM ranking_snapshots rs
      JOIN keywords k ON rs.keyword_id = k.id
      WHERE rs.location_id = ANY(?) AND rs.rank IS NOT NULL
      ORDER BY rs.keyword_id, rs.location_id, rs.pulled_at DESC
    `, [locIds]).then((r) => r.rows);

    // Latest competitor rank per competitor+keyword+location
    const compRows = await db.raw<{ rows: Array<{ competitor_id: string; keyword_id: string; location_id: string; rank: number | null }> }>(`
      SELECT DISTINCT ON (cr.competitor_id, cr.keyword_id, cr.location_id)
        cr.competitor_id, cr.keyword_id, cr.location_id, cr.rank
      FROM competitor_rankings cr
      WHERE cr.location_id = ANY(?)
      ORDER BY cr.competitor_id, cr.keyword_id, cr.location_id, cr.pulled_at DESC
    `, [locIds]).then((r) => r.rows);

    // Index competitor ranks: "compId:kwId:locId" → rank
    const compRankMap = new Map<string, number | null>();
    for (const r of compRows) {
      compRankMap.set(`${r.competitor_id}:${r.keyword_id}:${r.location_id}`, r.rank);
    }

    const keywords = clientRows.map((r) => ({
      keyword: r.keyword,
      keywordId: r.keyword_id,
      location: locNameMap.get(r.location_id) ?? r.location_id,
      locationId: r.location_id,
      yourRank: r.rank,
      competitorRanks: competitors.map((c) => ({
        competitorId: c.id,
        rank: compRankMap.get(`${c.id}:${r.keyword_id}:${r.location_id}`) ?? null,
      })),
    }));

    ok(res, { keywords, competitors });
  } catch (e) {
    next(e);
  }
}

// ─── discoverKeywords ─────────────────────────────────────────────────────────

export async function discoverKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const competitor = await db('competitors')
      .where({ id: req.params.id, client_id: req.clientId })
      .first() as { id: string; name: string; website: string | null } | undefined;

    if (!competitor?.website) {
      err(res, 'Competitor has no website set', 400, 'NO_WEBSITE');
      return;
    }

    if (!config.dataforseo.login || !config.dataforseo.password) {
      err(res, 'DataForSEO not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    // DataForSEO Labs ranked_keywords only accepts country-level codes (2840 = US national).
    // DMA and state codes are rejected by this endpoint.
    const discovered = await getCompetitorRankedKeywords({
      domain: competitor.website,
      locationCode: 2840,
      limit: 1000,
    });

    // Find keywords the client already tracks (any location)
    const trackedRows = await db('keywords')
      .join('locations', 'keywords.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .select('keywords.keyword') as Array<{ keyword: string }>;

    const trackedSet = new Set(trackedRows.map((r) => r.keyword.toLowerCase()));

    // Get client's locations for the "add to location" picker
    const locations = await db('locations')
      .where({ client_id: req.clientId })
      .select('id', 'name', 'city', 'state') as Array<{ id: string; name: string; city: string | null; state: string | null }>;

    const newKeywords = discovered.filter((k) => !trackedSet.has(k.keyword.toLowerCase()));

    ok(res, {
      keywords: newKeywords,
      locations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        label: [l.name, l.city && l.state ? `${l.city}, ${l.state}` : l.city ?? l.state].filter(Boolean).join(' — '),
      })),
    });
  } catch (e) {
    next(e);
  }
}

// ─── syncRankings: manual trigger (24-hour cooldown) ─────────────────────────

const SCAN_COOLDOWN_TTL = 24 * 60 * 60; // 24 hours in seconds
function scanCooldownKey(clientId: string) { return `rankings:cooldown:${clientId}`; }

export async function scanStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ttl = await redis.ttl(scanCooldownKey(req.clientId));
    if (ttl > 0) {
      ok(res, { available: false, retryAfterSeconds: ttl });
    } else {
      ok(res, { available: true, retryAfterSeconds: 0 });
    }
  } catch (e) {
    next(e);
  }
}

export async function syncRankings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ttl = await redis.ttl(scanCooldownKey(req.clientId));
    if (ttl > 0) {
      err(res, 'Rankings scan already ran recently. Try again later.', 429, 'RATE_LIMITED');
      return;
    }

    const redisHost = process.env.REDIS_HOST ?? 'redis';
    const q = new Queue('rankings', { connection: { host: redisHost, port: 6379 } });
    const job = await q.add('sync', { clientId: req.clientId }, { jobId: `manual-${req.clientId}-${Date.now()}` });
    await q.close();

    await redis.setex(scanCooldownKey(req.clientId), SCAN_COOLDOWN_TTL, '1');

    logger.info('Manual rankings sync queued', { clientId: req.clientId, jobId: job.id });
    ok(res, { queued: true, jobId: job.id });
  } catch (e) {
    next(e);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

export async function syncCompetitorPlaces(competitorId: string, placeId: string): Promise<void> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=rating,user_ratings_total&key=${config.googlePlacesApiKey}`;
  const res = await fetch(url);
  const data = await res.json() as {
    result?: { rating?: number; user_ratings_total?: number };
    status?: string;
  };

  if (data.status !== 'OK') {
    throw new Error(`Places API error: ${data.status ?? 'unknown'}`);
  }

  await db('competitors').where({ id: competitorId }).update({
    google_rating: data.result?.rating ?? null,
    google_review_count: data.result?.user_ratings_total ?? null,
    last_synced_at: new Date(),
    updated_at: new Date(),
  });
}

function formatCompetitor(c: Record<string, unknown>) {
  return {
    id: c.id,
    name: c.name,
    website: c.website,
    googlePlaceId: c.google_place_id,
    googleRating: c.google_rating ? parseFloat(String(c.google_rating)) : null,
    googleReviewCount: c.google_review_count,
    lastSyncedAt: c.last_synced_at,
  };
}
