import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { feedbackFilter, feedbackUpdate, feedbackView, feedbackCsv, feedbackCoverage } from '../services/private_feedback';

async function filtered(req: Request) {
  const filter = feedbackFilter.parse(req.query);
  if (filter.locationId && !await db('locations').where({ id: filter.locationId, client_id: req.clientId }).first()) return null;
  let query = db('private_feedback').where({ client_id: req.clientId });
  if (filter.locationId) query = query.where({ location_id: filter.locationId });
  if (filter.rating) query = query.where({ rating: filter.rating });
  if (filter.campaignId) query = query.where({ campaign_id: filter.campaignId });
  if (filter.status) query = query.where({ follow_up_status: filter.status });
  // Wrap the query: returning a Knex thenable directly would execute it.
  return { query, page: filter.page };
}
async function assignees(clientId: string) {
  const owner = await db('clients').join('users', 'users.id', 'clients.user_id').where('clients.id', clientId).select('users.id', 'users.email').first();
  const members = await db('team_members').join('users', 'users.id', 'team_members.user_id').where({ 'team_members.client_id': clientId, 'team_members.role': 'admin' }).whereNotNull('team_members.accepted_at').select('users.id', 'users.email');
  return [...(owner ? [owner] : []), ...members].filter((m, i, list) => list.findIndex(x => x.id === m.id) === i);
}
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await filtered(req);
    if (!result) { err(res, 'Location not found', 404); return; }
    const { query, page } = result;
    const count = await query.clone().count('id as cnt').first();
    const total = Number(count?.cnt ?? 0);
    const canManage = req.teamRole === 'owner' || req.teamRole === 'admin';
    const rows = await query.orderBy('received_at', 'desc').orderBy('id', 'desc').limit(20).offset((page - 1) * 20);
    res.setHeader('Cache-Control', 'no-store');
    ok(res, { feedback: rows.map(f => feedbackView(f, canManage)), total, page, pages: Math.ceil(total / 20), canManage, assignees: canManage ? await assignees(req.clientId) : [], coverage: feedbackCoverage });
  } catch (e) { next(e); }
}
export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const input = feedbackUpdate.parse(req.body);
    const existing = await db('private_feedback').where({ id, client_id: req.clientId }).first();
    if (!existing) { err(res, 'Feedback not found', 404); return; }
    if (input.assignedUserId && !(await assignees(req.clientId)).some(m => m.id === input.assignedUserId)) {
      err(res, 'Assign an active owner or admin from this account', 422); return;
    }
    const changed = await db('private_feedback').where({ id, client_id: req.clientId, follow_up_version: input.version }).update({
      follow_up_status: input.status, assigned_user_id: input.assignedUserId, follow_up_notes: input.notes,
      follow_up_version: input.version + 1, follow_up_updated_at: new Date(), follow_up_updated_by: req.userId,
    }).returning('*');
    if (!changed.length) { err(res, 'Feedback was changed by another teammate. Refresh before saving.', 409); return; }
    ok(res, feedbackView(changed[0], true));
  } catch (e) { next(e); }
}
export async function exportCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await filtered(req);
    if (!result) { err(res, 'Location not found', 404); return; }
    const rows = await result.query.orderBy('received_at', 'desc').orderBy('id', 'desc').limit(5001);
    if (rows.length > 5000) { err(res, 'Export is limited to 5,000 responses. Narrow the location, rating, or status filters.', 422); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="private-feedback.csv"');
    // Deliberately omit internal notes, even for managers, and reuse inbox masking.
    res.send(feedbackCsv(rows.map(f => feedbackView(f, false))));
  } catch (e) { next(e); }
}
