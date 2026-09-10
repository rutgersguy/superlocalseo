import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { redis } from '../db/redis';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { PROSPECT_SOURCE, searchProspect, findArea } from '../services/prospect_report.service';
import { prospectReportsQueue } from '../jobs/queue';
const router = Router();
const lookupLimit = rateLimit({ windowMs: 3600000, max: 10, validate: false, standardHeaders: true, legacyHeaders: false });
const createLimit = rateLimit({ windowMs: 86400000, max: 3, validate: false, standardHeaders: true, legacyHeaders: false });
const identifier = z.string().regex(/^[A-Za-z0-9_-]{5,255}$/);
const searchSchema = z.object({ business: z.string().trim().min(2).max(150), city: z.string().trim().min(2).max(150) });
export const prospectCreateSchema = z.object({ placeId: identifier, areaId: z.string().regex(/^\d{7}$/),
  keyword: z.string().trim().min(2).max(100), email: z.string().trim().email().max(255).transform(s => s.toLowerCase()),
  consent: z.literal(true), website: z.string().max(0).optional() });
router.post('/search', lookupLimit, async (req,res,next) => {
  try {
    res.setHeader('Cache-Control', 'no-store'); const p = searchSchema.parse(req.body);
    const key = `prospect:lookup:${new Date().toISOString().slice(0,10)}`;
    const used = Number(await redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],86400) end; return n', 1, key));
    if (used > 300) { err(res, 'Business lookup is at its daily limit. Please try again tomorrow.', 429); return; }
    ok(res, await searchProspect(p.business,p.city));
  }
  catch(e) { next(e); }
});
router.post('/', createLimit, async (req,res,next) => {
  try {
    const p = prospectCreateSchema.parse(req.body);
    const area = findArea(p.areaId);
    if (!area) { err(res, 'Choose a supported city', 400); return; }
    const id = await db.transaction(async trx => {
      // A global cap and per-email cap are enforced atomically across API processes.
      await trx.raw('SELECT pg_advisory_xact_lock(202609091)');
      const since = new Date(Date.now() - 86400000);
      const base = () => trx('audit_leads').where({ source: PROSPECT_SOURCE }).where('created_at','>=',since);
      const total = Number((await base().count('id as count').first())?.count ?? 0);
      const perEmail = Number((await base().where({ email: p.email }).count('id as count').first())?.count ?? 0);
      if (total >= 50 || perEmail >= 2) return null;
      const [lead] = await trx('audit_leads').insert({ business_name: 'Report pending verification', city: area.name, keyword: p.keyword,
        email: p.email, google_place_id: p.placeId, source: PROSPECT_SOURCE,
        audit_data: JSON.stringify({ status: 'queued', emailStatus: 'not_started', areaId: p.areaId, consentAt: new Date().toISOString(), consentVersion: 'report-delivery-only-v1' }) }).returning('id');
      return lead.id as string;
    });
    if (!id) { err(res,'The free-report limit has been reached. Please try again tomorrow.',429,'RATE_LIMITED'); return; }
    try { await prospectReportsQueue.add('generate',{ id },{ jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 100, removeOnFail: 100 }); }
    catch { await db('audit_leads').where({ id }).update({ audit_data: db.raw("audit_data || ?::jsonb", [JSON.stringify({ status: 'failed', error: 'Report scheduling is temporarily unavailable. An administrator can recover this request.' })]), updated_at: new Date() }); }
    ok(res,{ id },202);
  } catch(e) { next(e); }
});
router.get('/:id', async (req,res,next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) { err(res,'Report not found',404); return; }
    const row = await db('audit_leads').where({ id: req.params.id, source: PROSPECT_SOURCE }).select('audit_data','created_at','updated_at').first();
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Robots-Tag','noindex, nofollow');
    if (!row) { err(res,'Report not found',404); return; }
    const data = row.audit_data ?? {};
    const stalled = data.status === 'processing' && Date.now() - new Date(row.updated_at).getTime() > 15 * 60000;
    // Never expose lead email, consent records or raw job/provider errors on capability URLs.
    ok(res,{ status: stalled ? 'failed' : data.status, snapshot: data.snapshot ?? null, emailStatus: data.emailStatus ?? null,
      error: stalled ? 'This report is taking longer than expected. Please contact hello@superlocalseo.com.' : data.error ?? null });
  } catch(e) { next(e); }
});
export default router;
