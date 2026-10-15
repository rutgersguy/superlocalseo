import { gridRequests, gridCoverage } from '../services/grid-runner';
import { completeGrid, GridPoint } from '../services/grid-observations';
import { catalog } from '../config/plans';
import { planFor } from '../config/plans';
import { reserveUsage, limitError } from '../services/plan-usage';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { createRankingRequest, fetchRankingResult } from '../services/brightlocal.service';
import { getRankForCoordinate } from '../services/dataforseo.service';
import { logger } from '../utils/logger';

const DEGREE_PER_MILE = 0.0145;
const POLL_MAX = 24;
const POLL_INTERVAL_MS = 5000;

const triggerSchema = z.object({
  locationId: z.string().uuid(),
  keywordId: z.string().uuid(),
  gridSize: z.union([z.literal(3), z.literal(7), z.literal(13)]).optional().default(7),
});

export async function trigger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = triggerSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }

    const { locationId, keywordId, gridSize } = parsed.data;
    if (req.client.pricing_version === catalog.version && gridSize > planFor(req.client).gridSize) throw limitError('Starter includes a 3×3 map. Upgrade for a larger geo-grid.');

    const location = await db('active_locations as locations')
      .where({ id: locationId, client_id: req.clientId })
      .first() as { id: string; lat?: number | null; lng?: number | null; city?: string | null; state?: string | null; name: string; website?: string | null; phone?: string | null; zip?: string | null } | undefined;
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }
    if (!location.lat || !location.lng) { err(res, 'Location has no coordinates — add lat/lng in Locations settings', 422, 'NO_COORDINATES'); return; }

    const keyword = await db('keywords')
      .where({ id: keywordId, location_id: locationId })
      .first() as { id: string; keyword: string } | undefined;
    if (!keyword) { err(res, 'Keyword not found', 404, 'NOT_FOUND'); return; }

    await reserveUsage(req.clientId, locationId, 'gridScans');
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

export async function runGeoGrid(
  reportId: string,
  keyword: string,
  centerLat: number,
  centerLng: number,
  gridSize: 3 | 7 | 13,
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
          lng: centerLng + col * DEGREE_PER_MILE / Math.max(0.1, Math.cos(centerLat * Math.PI / 180)),
        });
      }
    }

    type GridResult = typeof points[0] & { rank: number | null; url: string | null; observationStatus: 'observed' | 'unverified' };
    const results: GridResult[] = [];

    const deadline = Date.now() + 8 * 60 * 1000;
    const diagnostic = (provider: string, pt: typeof points[0], error: string) => logger.warn('Geo-grid point unavailable', { reportId, provider, gridRow: pt.gridRow, gridCol: pt.gridCol, error });
    // Queue each paid BrightLocal request once; polling retries reuse its ID.
    const attempts = await gridRequests(points, async pt => {
      if (Date.now() > deadline) throw new Error('Scan time budget exceeded');
      const requestId = await createRankingRequest({ keyword, searchEngine: 'google-local-finder', coordinates: { lat: pt.lat, lng: pt.lng }, country: 'USA', websiteUrl: locationMeta.website, businessName: locationMeta.name, phone: locationMeta.phone, postcode: locationMeta.zip });
      return { ...pt, requestId };
    });
    const fired = attempts.flatMap((r, i) => {
      if (r.status === 'fulfilled') return [r.value];
      diagnostic('brightlocal-submit', points[i], (r.reason as Error).message); return [];
    });
    const done = new Set<string>();
    for (let attempt = 0; attempt < POLL_MAX && done.size < fired.length && Date.now() < deadline; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      await gridRequests(fired.filter(p => !done.has(p.requestId)), async p => {
        try {
          const result = await fetchRankingResult(p.requestId);
          if (!result.ready) return;
          done.add(p.requestId);
          if (!result.success) { diagnostic('brightlocal-result', p, 'Provider returned unsuccessful result'); return; }
          results.push({ gridRow: p.gridRow, gridCol: p.gridCol, lat: p.lat, lng: p.lng, rank: result.rank, url: result.url, observationStatus: 'observed' });
        } catch (e) { diagnostic('brightlocal-poll', p, (e as Error).message); }
      });
    }
    for (const p of fired.filter(p => !done.has(p.requestId))) diagnostic('brightlocal-poll', p, 'Polling deadline exceeded');
    // Fall back for submission, result, and polling failures, not only submission
    // errors. DataForSEO retries transient task responses with backoff internally.
    await gridRequests(points.filter(p => !results.some(r => r.gridRow === p.gridRow && r.gridCol === p.gridCol)), async pt => {
      if (Date.now() > deadline) { diagnostic('dataforseo', pt, 'Scan time budget exceeded'); return; }
      try {
        const r = await getRankForCoordinate({ keyword, lat: pt.lat, lng: pt.lng, businessName: locationMeta.name, websiteUrl: locationMeta.website, phone: locationMeta.phone });
        results.push({ ...pt, rank: r.rank, url: r.url, observationStatus: 'observed' });
      } catch (e) { diagnostic('dataforseo', pt, (e as Error).message); }
    });

    // Keep failed provider calls in the grid as unknown, never silently omit them.
    for (const pt of points) if (!results.some(r => r.gridRow === pt.gridRow && r.gridCol === pt.gridCol)) results.push({ ...pt, rank: null, url: null, observationStatus: 'unverified' });
    await db('geo_grid_reports').where({ id: reportId }).update({
      status: gridCoverage(results).sufficient ? 'complete' : 'failed',
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
  const points = row.grid_data ? completeGrid(row.grid_data as GridPoint[], Number(row.grid_size), Number(row.center_lat), Number(row.center_lng)) : null;
  const insufficient = points && !gridCoverage(points).sufficient;
  return {
    coverage: points ? gridCoverage(points) : null,
    id: row.id,
    locationId: row.location_id,
    keywordId: row.keyword_id,
    status: row.status === 'complete' && insufficient ? 'failed' : row.status,
    gridSize: row.grid_size,
    centerLat: row.center_lat,
    centerLng: row.center_lng,
    gridData: points,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
