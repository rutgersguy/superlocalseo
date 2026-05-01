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

    // Upsert — replace any existing draft for this review
    const existing = await db('review_responses').where({ review_id: reviewId }).first();
    let response;

    if (existing) {
      [response] = await db('review_responses')
        .where({ review_id: reviewId })
        .update({ draft_body: draftText, final_body: null, status: 'draft', approved_at: null, updated_at: new Date() })
        .returning('*');
    } else {
      [response] = await db('review_responses')
        .insert({ review_id: reviewId, client_id: req.clientId, draft_body: draftText })
        .returning('*');
    }

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
      body: z.string().min(1).optional(),
      approve: z.boolean().optional(),
    }).parse(req.body);

    const existing = await db('review_responses')
      .where({ review_id: reviewId, client_id: req.clientId })
      .first();

    if (!existing) {
      notFound(res, 'No response draft found — generate one first');
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body !== undefined) updates.final_body = body;
    if (approve) {
      updates.status = 'approved';
      updates.approved_at = new Date();
      if (!updates.final_body && !existing.final_body) {
        updates.final_body = existing.draft_body;
      }
    }

    const [response] = await db('review_responses')
      .where({ review_id: reviewId })
      .update(updates)
      .returning('*');

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

function formatResponse(r: Record<string, unknown>) {
  return {
    id: r.id,
    reviewId: r.review_id,
    draftBody: r.draft_body,
    finalBody: r.final_body ?? null,
    status: r.status,
    approvedAt: r.approved_at ?? null,
    createdAt: r.created_at,
  };
}
