import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { createAuditReport, pollAuditReport, createRankingRequest, fetchRankingResult } from '../services/brightlocal.service';
import { getPrimaryKeyword } from '../config/industry.config';
import { computeAuditScores } from '../services/audit_score.service';
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
      .first() as Record<string, unknown> | undefined;
    if (!location) { err(res, 'Location not found', 404, 'NOT_FOUND'); return; }

    // 30-day cooldown
    const recent = await db('location_audits')
      .where({ location_id: location.id as string, client_id: req.clientId })
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

    // BrightLocal NAP/citation audit — only runs if location has a campaign ID (Management API, paid plan).
    let reportId: string | null = null;
    if (location.brightlocal_campaign_id) {
      try {
        const result = await createAuditReport(location.brightlocal_campaign_id as string);
        reportId = result.reportId;
      } catch (e) {
        logger.warn('BrightLocal audit skipped', { locationId: location.id, error: (e as Error).message });
      }
    }

    // Always fire a Data API ranking request for the primary industry keyword.
    // This captures fresh ranking data at audit time regardless of BL plan tier.
    const client = await db('clients').where({ id: req.clientId }).select('industry').first() as { industry?: string } | undefined;
    const primaryKeyword = getPrimaryKeyword(client?.industry, location.city as string | null);
    if (primaryKeyword) {
      void fireAuditRankingRequest(location.id as string, primaryKeyword, location);
    }

    const [row] = await db('location_audits').insert({
      client_id: req.clientId,
      location_id: location.id,
      bl_report_id: reportId,
      status: 'processing',
      completed_at: null,
    }).returning('*') as Array<Record<string, unknown>>;

    // After the location_audits insert, fire background score computation
    void computeAndSaveScores(req.clientId as string, location.id as string, client?.industry, row.id as string);

    ok(res, { audit: formatAudit(row) }, 202);
  } catch (e) {
    next(e);
  }
}

async function computeAndSaveScores(
  clientId: string,
  locationId: string,
  industry: string | undefined,
  auditId: string,
): Promise<void> {
  // Wait for any in-flight ranking/citation data — poll until we have something or 3 min
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const hasCitations = await db('citation_snapshots').where({ location_id: locationId }).first();
    const hasRankings = await db('ranking_snapshots').where({ location_id: locationId }).first();
    if (hasCitations || hasRankings) break;
  }
  try {
    const scores = await computeAuditScores(locationId, industry ?? null);
    await db('location_audits').where({ id: auditId }).update({
      nap_score: scores.napScore,
      citation_score: scores.citationScore,
      composite_score: scores.compositeScore,
      status: 'complete',
      completed_at: new Date(),
    });
  } catch (e) {
    logger.warn('Audit score computation failed', { auditId, error: (e as Error).message });
  }
}

// Fires a ranking request for the primary industry keyword and stores the snapshot.
// Runs in the background — does not block the API response.
async function fireAuditRankingRequest(
  locationId: string,
  keyword: string,
  location: Record<string, unknown>,
): Promise<void> {
  try {
    const exists = await db('keywords').where({ location_id: locationId, keyword }).first();
    if (!exists) {
      await db('keywords').insert({ location_id: locationId, keyword, created_at: new Date(), updated_at: new Date() });
    }

    const geoLocation = [location.city, location.state, 'United States'].filter(Boolean).join(', ') || (location.name as string);
    const requestId = await createRankingRequest({
      keyword,
      searchEngine: 'google-local-finder',
      geoLocation,
      websiteUrl: location.website as string | null,
      businessName: location.name as string,
      phone: location.phone as string | null,
      postcode: location.zip as string | null,
    });

    let result = await fetchRankingResult(requestId);
    for (let i = 0; i < 24 && !result.ready; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      result = await fetchRankingResult(requestId);
    }
    if (!result.ready) { logger.warn('Audit ranking request timed out', { locationId, keyword }); return; }

    const kw = await db('keywords').where({ location_id: locationId, keyword }).first() as { id: string } | undefined;
    if (kw) {
      await db('ranking_snapshots').insert({
        keyword_id: kw.id,
        location_id: locationId,
        rank: result.rank,
        url_ranked: result.url,
        search_engine: result.searchEngine,
        rank_type: result.rankType ?? 'organic',
        pulled_at: new Date(),
      });
      logger.info('Audit ranking snapshot saved', { locationId, keyword, rank: result.rank });
    }
  } catch (e) {
    logger.warn('Audit ranking request failed', { locationId, keyword, error: (e as Error).message });
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
  // Poll BL for audits that have a bl_report_id (legacy Management API audits)
  const blPending = await db('location_audits')
    .where({ status: 'processing' })
    .whereNotNull('bl_report_id') as Array<Record<string, unknown>>;

  for (const row of blPending) {
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

  // Score any Data API audits stuck in processing for > 5 minutes
  const dataApiPending = await db('location_audits')
    .where({ status: 'processing' })
    .whereNull('bl_report_id')
    .where('created_at', '<', new Date(Date.now() - 5 * 60 * 1000))
    .join('locations', 'location_audits.location_id', 'locations.id')
    .join('clients', 'location_audits.client_id', 'clients.id')
    .select(
      'location_audits.id as auditId',
      'location_audits.location_id as locationId',
      'clients.industry as industry',
    ) as Array<{ auditId: string; locationId: string; industry: string | null }>;

  for (const row of dataApiPending) {
    try {
      const scores = await computeAuditScores(row.locationId, row.industry);
      await db('location_audits').where({ id: row.auditId }).update({
        nap_score: scores.napScore,
        citation_score: scores.citationScore,
        composite_score: scores.compositeScore,
        status: 'complete',
        completed_at: new Date(),
      });
    } catch (e) {
      logger.warn('Data API audit score fallback failed', { auditId: row.auditId, error: (e as Error).message });
    }
  }

  // Backfill composite_score for 'complete' audits that have no score yet
  const nullScoreAudits = await db('location_audits')
    .where({ status: 'complete' })
    .whereNull('composite_score')
    .whereNull('bl_report_id')
    .join('locations', 'location_audits.location_id', 'locations.id')
    .join('clients', 'location_audits.client_id', 'clients.id')
    .select(
      'location_audits.id as auditId',
      'location_audits.location_id as locationId',
      'clients.industry as industry',
    )
    .limit(50) as Array<{ auditId: string; locationId: string; industry: string | null }>;

  for (const row of nullScoreAudits) {
    try {
      const scores = await computeAuditScores(row.locationId, row.industry);
      await db('location_audits').where({ id: row.auditId }).update({
        nap_score: scores.napScore,
        citation_score: scores.citationScore,
        composite_score: scores.compositeScore,
        completed_at: db.raw('COALESCE(completed_at, NOW())'),
      });
    } catch (e) {
      logger.warn('Null-score audit backfill failed', { auditId: row.auditId, error: (e as Error).message });
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
