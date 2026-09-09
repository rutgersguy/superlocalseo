import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok } from '../utils/response';
import { PROSPECT_SOURCE } from '../services/prospect_report.service';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  search: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'queued', 'processing', 'completed', 'failed', 'attention']).default('all'),
});
const stateSql = `COALESCE(audit_data->>'status', 'unknown')`;
const attentionSql = `(${stateSql} = 'failed' OR audit_data->>'emailStatus' = 'failed' OR (${stateSql} IN ('queued','processing') AND updated_at < ?))`;

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
        'consentAt',audit_data->'consentAt','consentVersion',audit_data->'consentVersion',
        'generatedAt',audit_data->'snapshot'->'generatedAt','hasSnapshot',(audit_data->'snapshot' IS NOT NULL AND audit_data->'snapshot' <> 'null'::jsonb),
        'checked',audit_data->'snapshot'->'summary'->'checked','unavailable',audit_data->'snapshot'->'summary'->'unavailable') as details`))
      .orderBy('created_at', 'desc').orderBy('id', 'desc').limit(25).offset((q.page - 1) * 25);
    ok(res, { total, page: q.page, hasMore: q.page * 25 < total, reports: rows.map(r => {
      const d = r.details ?? {};
      const stale = ['queued', 'processing'].includes(d.status) && new Date(r.updated_at) < staleBefore;
      return { id: r.id, businessName: r.business_name, email: r.email, city: r.city, keyword: r.keyword,
        createdAt: r.created_at, updatedAt: r.updated_at, generatedAt: d.generatedAt ?? null,
        status: d.status ?? 'unknown', emailStatus: d.emailStatus ?? 'not_recorded', stale,
        needsAttention: stale || d.status === 'failed' || d.emailStatus === 'failed',
        hasSnapshot: d.hasSnapshot === true, checked: d.checked ?? null, unavailable: d.unavailable ?? null,
        error: d.error ?? null, consentAt: d.consentAt ?? null, consentVersion: d.consentVersion ?? null };
    }) });
  } catch (e) { next(e); }
}
