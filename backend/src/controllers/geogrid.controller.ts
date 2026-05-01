import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { createGeoGridReport, pollGeoGridReport } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

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
      .first() as { id: string; bl_campaign_id?: string; lat?: number; lng?: number } | undefined;
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }
    if (!location.bl_campaign_id) { err(res, 'Location has no BrightLocal campaign', 422, 'NO_BL_CAMPAIGN'); return; }
    if (!location.lat || !location.lng) { err(res, 'Location has no coordinates — add lat/lng in Locations settings', 422, 'NO_COORDINATES'); return; }

    const keyword = await db('keywords')
      .where({ id: keywordId, client_id: req.clientId })
      .first() as { id: string; keyword: string } | undefined;
    if (!keyword) { err(res, 'Keyword not found', 404, 'NOT_FOUND'); return; }

    const { reportId } = await createGeoGridReport(
      location.bl_campaign_id,
      keyword.keyword,
      Number(location.lat),
      Number(location.lng),
      gridSize,
    );

    const [row] = await db('geo_grid_reports').insert({
      client_id: req.clientId,
      location_id: locationId,
      keyword_id: keywordId,
      bl_report_id: reportId,
      status: 'processing',
      grid_size: gridSize,
      center_lat: location.lat,
      center_lng: location.lng,
    }).returning('*') as Array<Record<string, unknown>>;

    ok(res, { report: formatReport(row) }, 202);
  } catch (e) {
    next(e);
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
  const pending = await db('geo_grid_reports').where({ status: 'processing' }) as Array<Record<string, unknown>>;
  for (const row of pending) {
    if (!row.bl_report_id) continue;
    try {
      const result = await pollGeoGridReport(row.bl_report_id as string);
      if (result.status === 'processing') continue;
      await db('geo_grid_reports').where({ id: row.id }).update({
        status: result.status,
        grid_data: result.grid ? JSON.stringify(result.grid) : null,
        completed_at: result.status === 'complete' ? new Date() : null,
      });
    } catch (e) {
      logger.warn('Geo-grid poll failed', { id: row.id, error: (e as Error).message });
    }
  }
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
