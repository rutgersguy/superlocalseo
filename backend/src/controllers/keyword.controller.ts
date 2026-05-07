import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, created, noContent, notFound, err } from '../utils/response';
import { getSearchVolumes, locationCodeForCity } from '../services/dataforseo.service';

export const keywordSchema = z.object({
  locationId: z.string().uuid(),
  keyword: z.string().min(1).max(255),
});

export const keywordQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
});

type KeywordBody = z.infer<typeof keywordSchema>;

function formatKeyword(k: Record<string, unknown>) {
  return {
    id: k.id,
    locationId: k.location_id,
    keyword: k.keyword,
    createdAt: k.created_at,
  };
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { locationId } = req.query as { locationId?: string };

    let query = db('keywords')
      .join('locations', 'keywords.location_id', 'locations.id')
      .where('locations.client_id', req.clientId)
      .select('keywords.*');

    if (locationId) {
      query = query.where('keywords.location_id', locationId);
    }

    const keywords = await query.orderBy('keywords.created_at', 'asc');
    ok(res, keywords.map(formatKeyword));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as KeywordBody;

    // Verify the location belongs to this client
    const location = await db('locations').where({ id: body.locationId, client_id: req.clientId }).first();
    if (!location) {
      notFound(res, 'Location not found');
      return;
    }

    // Check for duplicate
    const existing = await db('keywords').where({ location_id: body.locationId, keyword: body.keyword }).first();
    if (existing) {
      err(res, 'Keyword already exists for this location', 409, 'KEYWORD_EXISTS');
      return;
    }

    const [keyword] = await db('keywords').insert({
      location_id: body.locationId,
      keyword: body.keyword,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('*');

    // Fetch search volume in background — don't block the response
    void getSearchVolumes([body.keyword], locationCodeForCity(location.city as string | null, location.state as string | null)).then(([result]) => {
      if (result?.monthlySearchVolume != null) {
        return db('keywords').where({ id: (keyword as Record<string, unknown>).id }).update({
          monthly_search_volume: result.monthlySearchVolume,
          updated_at: new Date(),
        });
      }
    });

    created(res, formatKeyword(keyword as Record<string, unknown>));
  } catch (e) {
    next(e);
  }
}

export async function updateVolume(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { monthlySearchVolume } = z.object({
      monthlySearchVolume: z.number().int().min(0).nullable(),
    }).parse(req.body);

    const keyword = await db('keywords')
      .join('locations', 'keywords.location_id', 'locations.id')
      .where('keywords.id', id)
      .where('locations.client_id', req.clientId)
      .select('keywords.*')
      .first();

    if (!keyword) {
      notFound(res, 'Keyword not found');
      return;
    }

    const [updated] = await db('keywords').where({ id }).update({
      monthly_search_volume: monthlySearchVolume,
      updated_at: new Date(),
    }).returning('*');

    ok(res, {
      ...formatKeyword(updated as Record<string, unknown>),
      monthlySearchVolume: (updated as Record<string, unknown>).monthly_search_volume,
    });
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    // Verify ownership via join
    const keyword = await db('keywords')
      .join('locations', 'keywords.location_id', 'locations.id')
      .where('keywords.id', id)
      .where('locations.client_id', req.clientId)
      .select('keywords.*')
      .first();

    if (!keyword) {
      notFound(res, 'Keyword not found');
      return;
    }

    await db('keywords').where({ id }).delete();
    noContent(res);
  } catch (e) {
    next(e);
  }
}
