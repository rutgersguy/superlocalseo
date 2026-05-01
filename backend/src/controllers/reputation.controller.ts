import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { fetchReputationReviews, replyToReview } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

const replySchema = z.object({
  replyText: z.string().min(1).max(4000).optional(),
});

export async function reply(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { reviewId } = req.params;

    const review = await db('reviews')
      .where({ id: reviewId, client_id: req.clientId })
      .first() as Record<string, unknown> | undefined;
    if (!review) { err(res, 'Review not found', 404, 'NOT_FOUND'); return; }
    if (!review.bl_review_id) { err(res, 'Review is not linked to BrightLocal', 422, 'NO_BL_REVIEW'); return; }
    if (review.bl_reply_status === 'posted') { err(res, 'Reply already posted', 409, 'ALREADY_POSTED'); return; }

    const parsed = replySchema.safeParse(req.body);
    let replyText: string;

    if (parsed.success && parsed.data.replyText) {
      replyText = parsed.data.replyText;
    } else {
      const draft = await db('review_responses')
        .where({ review_id: reviewId })
        .first() as { ai_draft?: string; final_body?: string } | undefined;
      const text = draft?.final_body ?? draft?.ai_draft;
      if (!text) { err(res, 'No reply text provided and no AI draft available', 400, 'NO_REPLY_TEXT'); return; }
      replyText = text;
    }

    // Find location's BL campaign
    let campaignId: string | undefined;
    if (review.location_id) {
      const loc = await db('locations').where({ id: review.location_id }).first() as { bl_campaign_id?: string } | undefined;
      campaignId = loc?.bl_campaign_id;
    }
    if (!campaignId) {
      const anyLoc = await db('locations')
        .where({ client_id: req.clientId })
        .whereNotNull('bl_campaign_id')
        .first() as { bl_campaign_id: string } | undefined;
      campaignId = anyLoc?.bl_campaign_id;
    }
    if (!campaignId) { err(res, 'No BrightLocal campaign configured', 422, 'NO_BL_CAMPAIGN'); return; }

    await replyToReview(campaignId, review.bl_review_id as string, replyText);

    await db('reviews').where({ id: reviewId }).update({
      bl_reply_status: 'posted',
      bl_reply_posted_at: new Date(),
      replied: true,
    });

    ok(res, { posted: true });
  } catch (e) {
    logger.error('BL reply failed', { error: (e as Error).message });
    next(e);
  }
}

export async function syncBLReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locations = await db('locations')
      .where({ client_id: req.clientId })
      .whereNotNull('bl_campaign_id')
      .select('id', 'bl_campaign_id') as Array<{ id: string; bl_campaign_id: string }>;

    if (locations.length === 0) { ok(res, { synced: 0 }); return; }

    let synced = 0;
    for (const loc of locations) {
      try {
        const { reviews: blReviews } = await fetchReputationReviews(loc.bl_campaign_id);
        for (const blReview of blReviews) {
          const existing = await db('reviews')
            .where({ client_id: req.clientId })
            .whereNull('bl_review_id')
            .where('author_name', 'ilike', blReview.authorName)
            .orderBy('review_date', 'desc')
            .first() as { id: string } | undefined;
          if (existing) {
            await db('reviews').where({ id: existing.id }).update({ bl_review_id: blReview.blReviewId });
            synced++;
          }
        }
      } catch (e) {
        logger.warn('BL sync failed for location', { locationId: loc.id, error: (e as Error).message });
      }
    }

    ok(res, { synced });
  } catch (e) {
    next(e);
  }
}
