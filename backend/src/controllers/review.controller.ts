import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { config } from '../config';
import { logger } from '../utils/logger';

export const listQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  platform: z.string().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type ListQuery = z.infer<typeof listQuerySchema>;

function formatReview(r: Record<string, unknown>) {
  return {
    id: r.id,
    platform: r.platform,
    externalReviewId: r.external_review_id,
    authorName: r.author_name,
    rating: r.rating,
    body: r.body,
    sentiment: r.sentiment,
    status: r.status,
    reviewDate: r.review_date,
    ingestedAt: r.ingested_at,
    platformUrl: r.platform_url,
    locationId: r.location_id,
    // Only EMR-sourced reviews can be replied to via the API (BrightLocal can't reply at all,
    // and our own GBP write is quota-blocked), so the UI needs to know where each came from.
    source: r.source,
    replied: r.replied,
    replyDate: r.reply_date,
    emrReplyText: r.emr_reply_text,
    hidden: r.hidden,
    avatarUrl: r.avatar_url,
    verified: r.verified,
  };
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as ListQuery;
    const { platform, rating, status, search, page, limit } = query;

    let baseQuery = db('reviews').where({ client_id: req.clientId });

    if (query.locationId) {
      const owned = await db('locations').where({ id: query.locationId, client_id: req.clientId }).first();
      if (!owned) { err(res, 'Location not found', 404); return; }
      baseQuery = baseQuery.where({ location_id: query.locationId });
    }
    if (platform) baseQuery = baseQuery.where({ platform });
    if (rating !== undefined) baseQuery = baseQuery.where({ rating });
    if (status === 'responded') baseQuery = baseQuery.where({replied:true});
    else if (status === 'new') baseQuery = baseQuery.where(q=>q.where({replied:false}).orWhereNull('replied'));
    else if (status) baseQuery = baseQuery.where({ status });
    if (search) {
      baseQuery = baseQuery.where(function () {
        this.whereILike('author_name', `%${search}%`).orWhereILike('body', `%${search}%`);
      });
    }

    const countResult = await baseQuery.clone().count('id as cnt').first();
    const total = parseInt(String((countResult as Record<string, unknown>)?.cnt ?? 0), 10);

    const offset = (page - 1) * limit;
    const reviews = await baseQuery
      .orderBy('review_date', 'desc').orderBy('id', 'desc')
      .limit(limit)
      .offset(offset);

    ok(res, {
      reviews: reviews.map(formatReview),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e) {
    next(e);
  }
}

interface WebhookPayload {
  event?: string;
  id?: string;
  platform?: string;
  source?: string;
  author?: string;
  author_name?: string;
  rating?: number;
  body?: string;
  message?: string;
  date?: string;
  url?: string;
  source_url?: string;
  client_api_key?: string;
  location_id?: string;
  replied?: boolean;
  reply?: string | null;
  reply_date?: string | null;
  hidden?: boolean;
  avatar?: string | null;
  verified?: boolean | null;
}

// NOTE: the inbound EMR webhook handler that used to live here has been removed.
// It matched clients on locations.id — a value EMR never sends — so it silently
// dropped every payload, while the endpoint that DID work (/webhooks/emr) had no
// authentication at all. Both URLs now share one authenticated implementation in
// controllers/emr_webhook.controller.ts (issue #148).

