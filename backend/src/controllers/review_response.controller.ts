import { immutableReplyStates, publishReply, reconcileReply } from '../services/reply_publication';
import { mappingError } from '../services/provider_mapping.service';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, notFound, err } from '../utils/response';
import { draftReviewResponse } from '../services/ai.service';

// POST /reviews/:id/response/draft — generate AI draft
export async function draft(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: reviewId } = req.params;

    // Verify ownership
    const review = await db('reviews').where({ id: reviewId, client_id: req.clientId }).first();
    if (!review) {
      notFound(res, 'Review not found');
      return;
    }

    if (!review.body) {
      err(res, 'Review has no text to respond to', 400, 'NO_REVIEW_BODY');
      return;
    }

    const client = req.client as Record<string, unknown>;

    const draftText = await draftReviewResponse({
      businessName: client.business_name as string,
      industry: client.industry as string | null,
      authorName: (review.author_name as string) || 'there',
      rating: review.rating as number,
      body: review.body as string,
      platform: review.platform as string,
    });

    const response = await db.transaction(async trx => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`reply:${reviewId}`]);
      const currentReview = await trx('reviews').where({ id: reviewId, client_id: req.clientId }).first();
      const existing = await trx('review_responses').where({ review_id: reviewId, client_id: req.clientId }).forUpdate().first();
      if (currentReview?.replied || (existing && immutableReplyStates.includes(existing.status))) throw mappingError('An existing or unresolved publication cannot be replaced by a draft.');
      const values = { draft_body: draftText, final_body: null, status: 'draft', approved_at: null, updated_at: new Date() };
      const [saved] = existing ? await trx('review_responses').where({ id: existing.id }).update(values).returning('*') : await trx('review_responses').insert({ review_id: reviewId, client_id: req.clientId, ...values }).returning('*');
      return saved;
    });

    ok(res, formatResponse(response as Record<string, unknown>));
  } catch (e) {
    next(e);
  }
}

// PATCH /reviews/:id/response — edit body or approve
export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: reviewId } = req.params;
    const { body, approve } = z.object({
      body: z.string().trim().min(1).max(4096).optional(),
      approve: z.boolean().optional(),
    }).parse(req.body);

    const response = await db.transaction(async trx => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`reply:${reviewId}`]);
      const existing = await trx('review_responses').where({ review_id: reviewId, client_id: req.clientId }).forUpdate().first();
      if (!existing) throw mappingError('No response draft found — generate one first', 404);
      if (immutableReplyStates.includes(existing.status)) throw mappingError('An existing or unresolved publication cannot be edited.');
      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (body !== undefined) { updates.final_body = body; updates.status = 'draft'; updates.approved_at = null; }
      if (approve) { updates.status = 'approved'; updates.approved_at = new Date(); updates.final_body = body ?? existing.final_body ?? existing.draft_body; }
      if (approve === false) { updates.status = 'draft'; updates.approved_at = null; }
      const [saved] = await trx('review_responses').where({ id: existing.id }).update(updates).returning('*');
      return saved;
    });

    ok(res, formatResponse(response as Record<string, unknown>));
  } catch (e) {
    next(e);
  }
}

// GET /reviews/:id/response
export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: reviewId } = req.params;

    const review = await db('reviews').where({ id: reviewId, client_id: req.clientId }).first();
    if (!review) {
      notFound(res, 'Review not found');
      return;
    }

    const response = await db('review_responses').where({ review_id: reviewId }).first();
    ok(res, response ? formatResponse(response as Record<string, unknown>) : null);
  } catch (e) {
    next(e);
  }
}

// Explicit approval-and-publish action; text is required and never taken silently from an AI draft.
export async function publish(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { body } = z.object({ body: z.string().trim().min(1).max(4096) }).strict().parse(req.body);
    ok(res, await publishReply(req.clientId, req.params.id, body));
  } catch (e) { next(e); }
}
// Read-only upstream reconciliation. It never resends a reply.
export async function reconcile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { ok(res, await reconcileReply(req.clientId, req.params.id)); }
  catch (e) { next(e); }
}

function formatResponse(r: Record<string, unknown>) {
  return {
    id: r.id,
    reviewId: r.review_id,
    draftBody: r.draft_body,
    finalBody: r.final_body ?? null,
    status: r.status,
    approvedAt: r.approved_at ?? null,
    lastPublishError: r.last_publish_error ?? null,
    publishingStartedAt: r.publishing_started_at ?? null,
    reconcileCheckedAt: r.reconcile_checked_at ?? null,
    createdAt: r.created_at,
  };
}
