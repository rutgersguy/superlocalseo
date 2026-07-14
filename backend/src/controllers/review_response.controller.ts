import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, notFound, err } from '../utils/response';
import { draftReviewResponse } from '../services/ai.service';
import { replyToReview, EMRReplyError } from '../services/embedmyreviews.service';
import { getClientEMRKey } from '../services/emr_provisioning';
import { logger } from '../utils/logger';

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

/**
 * POST /reviews/:id/publish — post the reply publicly on Google, via EMR.
 *
 * EMR is the only path that can do this: BrightLocal told us in writing they don't support
 * review response via API (2026-07-14), and our own Google write scope is inert while the GBP
 * quota request is pending. EMR publishes immediately — no approval step — so this button
 * really does put text on the client's public Google listing.
 */
export async function publish(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: reviewId } = req.params;
    const { body } = z.object({ body: z.string().min(1).max(4096).optional() }).parse(req.body);

    const review = await db('reviews').where({ id: reviewId, client_id: req.clientId }).first();
    if (!review) {
      notFound(res, 'Review not found');
      return;
    }

    // Only EMR-sourced reviews carry an EMR review id in external_review_id; a GBP-sourced row
    // holds Google's own reviewId, which EMR's reply endpoint would not recognise.
    if (review.source !== 'emr') {
      err(res, 'This review did not come from your connected Google profile, so it cannot be replied to here.', 400, 'REPLY_SOURCE_UNSUPPORTED');
      return;
    }

    if (review.replied) {
      err(res, 'This review already has a reply.', 409, 'ALREADY_REPLIED');
      return;
    }

    const existing = await db('review_responses').where({ review_id: reviewId, client_id: req.clientId }).first();
    const text = body ?? (existing?.final_body as string | undefined) ?? (existing?.draft_body as string | undefined);
    if (!text) {
      err(res, 'No reply text — generate or write one first.', 400, 'NO_REPLY_TEXT');
      return;
    }

    const apiKey = await getClientEMRKey(req.clientId as string);
    if (!apiKey) {
      err(res, 'Review platform is not configured', 503, 'NOT_CONFIGURED');
      return;
    }

    try {
      await replyToReview(apiKey, review.external_review_id as string, text);
    } catch (e) {
      if (e instanceof EMRReplyError) {
        err(res, e.message, e.httpStatus, e.code);
        return;
      }
      throw e;
    }

    const now = new Date();
    await db('reviews').where({ id: reviewId }).update({
      replied: true,
      reply_date: now,
      emr_reply_text: text,
      status: 'responded',
    });

    if (existing) {
      await db('review_responses').where({ review_id: reviewId }).update({
        final_body: text,
        status: 'posted',
        approved_at: existing.approved_at ?? now,
        updated_at: now,
      });
    } else {
      await db('review_responses').insert({
        review_id: reviewId,
        client_id: req.clientId,
        draft_body: text,
        final_body: text,
        status: 'posted',
        approved_at: now,
      });
    }

    logger.info('Review reply published to Google via EMR', { clientId: req.clientId, reviewId });
    ok(res, { published: true, repliedAt: now.toISOString() });
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
