import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { config } from '../config';
import { logger } from '../utils/logger';

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

    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${config.googlePlacesApiKey}`;
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
