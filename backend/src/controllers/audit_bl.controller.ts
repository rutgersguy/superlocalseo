import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { createAuditReport, pollAuditReport } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const audits = await db('location_audits')
      .where({ client_id: req.clientId })
      .orderBy('created_at', 'desc') as Array<Record<string, unknown>>;
    ok(res, { audits: audits.map(formatAudit) });
  } catch (e) {
    next(e);
  }
}

export async function history(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { locationId } = req.params;
    const location = await db('locations').where({ id: locationId, client_id: req.clientId }).first();
    if (!location) { err(res, 'Not found', 404, 'NOT_FOUND'); return; }
    const audits = await db('location_audits')
      .where({ location_id: locationId, client_id: req.clientId, status: 'complete' })
      .orderBy('completed_at', 'asc') as Array<Record<string, unknown>>;
    ok(res, { audits: audits.map(formatAudit) });
  } catch (e) {
    next(e);
  }
}

const triggerSchema = z.object({ locationId: z.string().uuid() });

export async function trigger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = triggerSchema.safeParse(req.body);
    if (!parsed.success) { err(res, parsed.error.errors[0]?.message ?? 'Validation error', 400, 'VALIDATION_ERROR'); return; }

    const location = await db('locations')
      .where({ id: parsed.data.locationId, client_id: req.clientId })
      .first() as { id: string; brightlocal_campaign_id?: string } | undefined;
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }
    if (!location.brightlocal_campaign_id) { err(res, 'Location has no BrightLocal campaign configured', 422, 'NO_BL_CAMPAIGN'); return; }

    // 30-day cooldown
    const recent = await db('location_audits')
      .where({ location_id: location.id, client_id: req.clientId })
      .whereIn('status', ['complete', 'processing', 'pending'])
      .orderBy('created_at', 'desc')
      .first() as { created_at: Date } | undefined;

    if (recent) {
      const daysSince = (Date.now() - new Date(recent.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) {
        err(res, `Audit run ${Math.floor(daysSince)}d ago. Next in ${30 - Math.floor(daysSince)}d.`, 429, 'COOLDOWN');
        return;
      }
    }

    const { reportId } = await createAuditReport(location.brightlocal_campaign_id);
    const [row] = await db('location_audits').insert({
      client_id: req.clientId,
      location_id: location.id,
      bl_report_id: reportId,
      status: 'processing',
    }).returning('*') as Array<Record<string, unknown>>;

    ok(res, { audit: formatAudit(row) }, 202);
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const audit = await db('location_audits').where({ id, client_id: req.clientId }).first() as Record<string, unknown> | undefined;
    if (!audit) { err(res, 'Not found', 404, 'NOT_FOUND'); return; }
    ok(res, { audit: formatAudit(audit) });
  } catch (e) {
    next(e);
  }
}

export async function pollPending(): Promise<void> {
  const pending = await db('location_audits').where({ status: 'processing' }) as Array<Record<string, unknown>>;
  for (const row of pending) {
    if (!row.bl_report_id) continue;
    try {
      const result = await pollAuditReport(row.bl_report_id as string);
      if (result.status === 'processing') continue;
      await db('location_audits').where({ id: row.id }).update({
        status: result.status,
        nap_score: result.scores?.nap ?? null,
        citation_score: result.scores?.citations ?? null,
        review_score: result.scores?.reviews ?? null,
        google_score: result.scores?.google ?? null,
        composite_score: result.scores?.composite ?? null,
        recommendations: result.recommendations ? JSON.stringify(result.recommendations) : null,
        raw_data: result.raw ? JSON.stringify(result.raw) : null,
        completed_at: result.status === 'complete' ? new Date() : null,
      });
    } catch (e) {
      logger.warn('Audit poll failed', { id: row.id, error: (e as Error).message });
    }
  }
}

function formatAudit(row: Record<string, unknown>) {
  return {
    id: row.id,
    locationId: row.location_id,
    blReportId: row.bl_report_id,
    status: row.status,
    napScore: row.nap_score,
    citationScore: row.citation_score,
    reviewScore: row.review_score,
    googleScore: row.google_score,
    compositeScore: row.composite_score,
    recommendations: row.recommendations ?? [],
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
