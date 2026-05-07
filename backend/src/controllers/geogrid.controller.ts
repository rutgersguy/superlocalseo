import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { createRankingRequest, fetchRankingResult } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

const DEGREE_PER_MILE = 0.0145;
const POLL_MAX = 24;
const POLL_INTERVAL_MS = 5000;

const triggerSchema = z.object({
  locationId: z.string().uuid(),
  keywordId: z.string().uuid(),
  gridSize: z.union([z.literal(7), z.literal(13)]).optional().default(7),
});

export async function trigger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = triggerSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }

    const { locationId, keywordId, gridSize } = parsed.data;

    const location = await db('locations')
      .where({ id: locationId, client_id: req.clientId })
      .first() as { id: string; lat?: number | null; lng?: number | null; city?: string | null; state?: string | null; name: string; website?: string | null; phone?: string | null; zip?: string | null } | undefined;
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }
    if (!location.lat || !location.lng) { err(res, 'Location has no coordinates — add lat/lng in Locations settings', 422, 'NO_COORDINATES'); return; }

    const keyword = await db('keywords')
      .where({ id: keywordId })
      .first() as { id: string; keyword: string } | undefined;
    if (!keyword) { err(res, 'Keyword not found', 404, 'NOT_FOUND'); return; }

    const [row] = await db('geo_grid_reports').insert({
      client_id: req.clientId,
      location_id: locationId,
      keyword_id: keywordId,
      status: 'processing',
      grid_size: gridSize,
      center_lat: location.lat,
      center_lng: location.lng,
    }).returning('*') as Array<Record<string, unknown>>;

    void runGeoGrid(
      row.id as string,
      keyword.keyword,
      Number(location.lat),
      Number(location.lng),
      gridSize,
      { name: location.name, website: location.website, phone: location.phone, zip: location.zip, city: location.city, state: location.state },
    );

    ok(res, { report: formatReport(row) }, 202);
  } catch (e) {
    next(e);
  }
}

async function runGeoGrid(
  reportId: string,
  keyword: string,
  centerLat: number,
  centerLng: number,
  gridSize: 7 | 13,
  locationMeta: { name: string; website?: string | null; phone?: string | null; zip?: string | null; city?: string | null; state?: string | null },
): Promise<void> {
  try {
    const half = Math.floor(gridSize / 2);
    const points: Array<{ gridRow: number; gridCol: number; lat: number; lng: number }> = [];

    for (let row = -half; row <= half; row++) {
      for (let col = -half; col <= half; col++) {
        points.push({
          gridRow: row,
          gridCol: col,
          lat: centerLat + row * DEGREE_PER_MILE,
          lng: centerLng + col * DEGREE_PER_MILE,
        });
      }
    }

    // Fire all ranking requests
    const fired = (
      await Promise.allSettled(
        points.map((pt) =>
          createRankingRequest({
            keyword,
            searchEngine: 'google-local-finder',
            coordinates: { lat: pt.lat, lng: pt.lng },
            country: 'USA',
            websiteUrl: locationMeta.website,
            businessName: locationMeta.name,
            phone: locationMeta.phone,
            postcode: locationMeta.zip,
          }).then((requestId) => ({ ...pt, requestId })),
        ),
      )
    )
      .filter((r): r is PromiseFulfilledResult<typeof points[0] & { requestId: string }> => r.status === 'fulfilled')
      .map((r) => r.value);

    // Poll until all results are ready
    type GridResult = typeof points[0] & { rank: number | null; url: string | null };
    const results: GridResult[] = [];
    const done = new Set<string>();

    for (let attempt = 0; attempt < POLL_MAX && done.size < fired.length; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      await Promise.allSettled(
        fired
          .filter((p) => !done.has(p.requestId))
          .map(async (p) => {
            const result = await fetchRankingResult(p.requestId);
            if (!result.ready) return;
            done.add(p.requestId);
            results.push({ gridRow: p.gridRow, gridCol: p.gridCol, lat: p.lat, lng: p.lng, rank: result.rank, url: result.url });
          }),
      );
    }

    // Include timed-out points as null rank
    for (const p of fired) {
      if (!done.has(p.requestId)) {
        results.push({ gridRow: p.gridRow, gridCol: p.gridCol, lat: p.lat, lng: p.lng, rank: null, url: null });
      }
    }

    await db('geo_grid_reports').where({ id: reportId }).update({
      status: 'complete',
      grid_data: JSON.stringify(results),
      completed_at: new Date(),
    });
  } catch (e) {
    logger.warn('Geo-grid run failed', { reportId, error: (e as Error).message });
    await db('geo_grid_reports').where({ id: reportId }).update({ status: 'failed' }).catch(() => undefined);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { locationId, keywordId } = req.query as Record<string, string>;
    let q = db('geo_grid_reports')
      .where({ client_id: req.clientId })
      .orderBy('created_at', 'desc')
      .limit(20);
    if (locationId) q = q.where({ location_id: locationId });
    if (keywordId) q = q.where({ keyword_id: keywordId });
    const rows = await q as Array<Record<string, unknown>>;
    ok(res, { reports: rows.map(formatReport) });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const row = await db('geo_grid_reports').where({ id, client_id: req.clientId }).first() as Record<string, unknown> | undefined;
    if (!row) { err(res, 'Not found', 404, 'NOT_FOUND'); return; }
    ok(res, { report: formatReport(row) });
  } catch (e) {
    next(e);
  }
}

export async function pollPending(): Promise<void> {
  // Mark reports stuck in 'processing' for more than 10 minutes as failed
  await db('geo_grid_reports')
    .where({ status: 'processing' })
    .where('created_at', '<', new Date(Date.now() - 10 * 60 * 1000))
    .update({ status: 'failed' });
}

function formatReport(row: Record<string, unknown>) {
  return {
    id: row.id,
    locationId: row.location_id,
    keywordId: row.keyword_id,
    status: row.status,
    gridSize: row.grid_size,
    centerLat: row.center_lat,
    centerLng: row.center_lng,
    gridData: row.grid_data ?? null,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
