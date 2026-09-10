import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { PROSPECT_SOURCE } from '../services/prospect_report.service';

import { prospectRecovery } from '../services/prospect_recovery';
import { prospectReportsQueue } from '../jobs/queue';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  search: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'queued', 'processing', 'completed', 'failed', 'attention']).default('all'),
});
const stateSql = `COALESCE(audit_data->>'status', 'unknown')`;
const attentionSql = `(${stateSql} = 'failed' OR audit_data->>'emailStatus' IN ('failed','rejected','uncertain','sending','legacy_unknown') OR (${stateSql} IN ('queued','processing') AND updated_at < ?))`;

/** Native prospect reports only. No side effects, provider calls, or raw snapshot payloads. */
export async function listFreeReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const q = querySchema.parse(req.query);
    const staleBefore = new Date(Date.now() - 15 * 60000);
    const base = db('audit_leads').where({ source: PROSPECT_SOURCE });
    if (q.search) {
      // Literal substring search: percent/underscore must not broaden the match.
      const pattern = `%${q.search.replace(/[\\%_]/g, '\\$&')}%`;
      base.andWhere(b => b.whereILike('business_name', pattern).orWhereILike('email', pattern)
        .orWhereILike('city', pattern).orWhereILike('keyword', pattern).orWhereRaw('id::text ILIKE ?', [pattern]));
    }
    if (q.status === 'attention') base.andWhereRaw(attentionSql, [staleBefore]);
    else if (q.status !== 'all') base.andWhereRaw(`${stateSql} = ?`, [q.status]);
    const total = Number((await base.clone().count('* as n').first())?.n ?? 0);
    const rows = await base.clone().select('id', 'business_name', 'email', 'city', 'keyword', 'created_at', 'updated_at',
      db.raw(`jsonb_build_object('status',audit_data->'status','emailStatus',audit_data->'emailStatus','error',audit_data->'error',
        'generationToken',audit_data->'generationToken','progress',jsonb_build_object('profileAttemptedAt',audit_data->'progress'->'profileAttemptedAt','business',audit_data->'progress'->'business'),
        'snapshot',CASE WHEN audit_data->'snapshot' IS NOT NULL AND audit_data->'snapshot' <> 'null'::jsonb THEN '{}'::jsonb ELSE NULL END,'consentAt',audit_data->'consentAt','consentVersion',audit_data->'consentVersion',
        'generatedAt',audit_data->'snapshot'->'generatedAt','hasSnapshot',(audit_data->'snapshot' IS NOT NULL AND audit_data->'snapshot' <> 'null'::jsonb),
        'checked',audit_data->'snapshot'->'summary'->'checked','unavailable',audit_data->'snapshot'->'summary'->'unavailable') as details`))
      .orderBy('created_at', 'desc').orderBy('id', 'desc').limit(25).offset((q.page - 1) * 25);
    ok(res, { total, page: q.page, hasMore: q.page * 25 < total, reports: rows.map(r => {
      const d = r.details ?? {};
      const stale = ['queued', 'processing'].includes(d.status) && new Date(r.updated_at) < staleBefore;
      return { id: r.id, businessName: r.business_name, email: r.email, city: r.city, keyword: r.keyword,
        createdAt: r.created_at, updatedAt: r.updated_at, generatedAt: d.generatedAt ?? null,
        status: d.status ?? 'unknown', emailStatus: d.emailStatus ?? 'not_recorded', stale,
        needsAttention: stale || d.status === 'failed' || ['failed','rejected','uncertain','sending','legacy_unknown'].includes(d.emailStatus),
        recovery: prospectRecovery(d, r.updated_at),
        hasSnapshot: d.hasSnapshot === true, checked: d.checked ?? null, unavailable: d.unavailable ?? null,
        error: d.error ?? null, consentAt: d.consentAt ?? null, consentVersion: d.consentVersion ?? null };
    }) });
  } catch (e) { next(e); }
}

/** Only mounted behind requireAdmin. Queue and eligibility checks are serialized per lead. */
export async function recoverFreeReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await db.transaction(async trx => {
      const lead = await trx('audit_leads').where({ id, source: PROSPECT_SOURCE }).forUpdate().first();
      if (!lead) return { code: 404, message: 'Report not found' };
      const decision = prospectRecovery(lead.audit_data ?? {}, lead.updated_at);
      if (!decision.allowed) return { code: 409, message: decision.reason };
      const job = await prospectReportsQueue.getJob(id);
      if (job) {
        const state = await job.getState();
        if (state !== 'failed' && state !== 'completed') return { code: 409, message: 'A report job is already queued or active. Inspect the queue before recovery.' };
        if (state === 'failed') { await job.retry(); return { code: 202, message: 'Recovery queued' }; }
        await job.remove();
      }
      await prospectReportsQueue.add('generate', { id }, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 100, removeOnFail: 100 });
      return { code: 202, message: 'Recovery queued' };
    });
    if (result.code !== 202) { err(res, result.message, result.code); return; }
    ok(res, { message: result.message }, 202);
  } catch (e) { next(e); }
}
