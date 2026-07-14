import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { fetchReputationReviews } from '../services/brightlocal.service';
import { logger } from '../utils/logger';

const replySchema = z.object({
  replyText: z.string().min(1).max(4000).optional(),
});

// reply() REMOVED (2026-07-14): it POSTed to BrightLocal /v4/rf/reply, and BrightLocal state
// they do not support review response via API. Replies publish through EMR instead —
// see review_response.controller.publish() / POST /api/reviews/:id/publish.

export async function syncBLReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locations = await db('locations')
      .where({ client_id: req.clientId })
      .whereNotNull('brightlocal_campaign_id')
      .select('id', 'brightlocal_campaign_id') as Array<{ id: string; brightlocal_campaign_id: string }>;

    if (locations.length === 0) { ok(res, { synced: 0 }); return; }

    let synced = 0;
    for (const loc of locations) {
      try {
        const { reviews: blReviews } = await fetchReputationReviews(loc.brightlocal_campaign_id);
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
