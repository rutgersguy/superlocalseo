import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/connection';
import { ok, err } from '../utils/response';
import { config } from '../config';
import { logger } from '../utils/logger';

export const listQuerySchema = z.object({
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
  };
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as ListQuery;
    const { platform, rating, status, search, page, limit } = query;

    let baseQuery = db('reviews').where({ client_id: req.clientId });

    if (platform) baseQuery = baseQuery.where({ platform });
    if (rating !== undefined) baseQuery = baseQuery.where({ rating });
    if (status) baseQuery = baseQuery.where({ status });
    if (search) {
      baseQuery = baseQuery.where(function () {
        this.whereILike('author_name', `%${search}%`).orWhereILike('body', `%${search}%`);
      });
    }

    const countResult = await baseQuery.clone().count('id as cnt').first();
    const total = parseInt(String((countResult as Record<string, unknown>)?.cnt ?? 0), 10);

    const offset = (page - 1) * limit;
    const reviews = await baseQuery
      .orderBy('review_date', 'desc')
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
  id?: string;
  platform?: string;
  author_name?: string;
  rating?: number;
  body?: string;
  date?: string;
  url?: string;
  client_api_key?: string;
  location_id?: string;
}

export async function webhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Validate HMAC signature
    const signature = req.headers['x-embedmyreviews-signature'] as string | undefined;
    if (!signature || !config.embedmyreviews.webhookSecret) {
      err(res, 'Missing signature', 401, 'UNAUTHORIZED');
      return;
    }

    const rawBody = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', config.embedmyreviews.webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      err(res, 'Invalid signature', 401, 'INVALID_SIGNATURE');
      return;
    }

    const payload = req.body as WebhookPayload;

    if (!payload.id || !payload.platform) {
      err(res, 'Missing required fields', 400, 'BAD_REQUEST');
      return;
    }

    // Find the client by matching API key (webhook includes client context)
    // We'll look up by location_id if provided, otherwise skip
    const locationId = payload.location_id ?? null;
    let clientId: string | null = null;

    if (locationId) {
      const location = await db('locations').where({ id: locationId }).first();
      if (location) clientId = location.client_id as string;
    }

    if (!clientId) {
      // Can't associate — log and accept gracefully
      logger.warn('Webhook received but could not associate with a client', { externalId: payload.id });
      res.status(200).json({ received: true });
      return;
    }

    const reviewDate = payload.date ? new Date(payload.date) : new Date();
    const now = new Date();

    await db('reviews')
      .insert({
        client_id: clientId,
        location_id: locationId,
        platform: payload.platform,
        external_review_id: payload.id,
        author_name: payload.author_name ?? 'Unknown',
        rating: payload.rating ?? null,
        body: payload.body ?? null,
        sentiment: null,
        status: 'new',
        review_date: reviewDate,
        ingested_at: now,
        platform_url: payload.url ?? null,
      })
      .onConflict(['platform', 'external_review_id'])
      .merge({
        author_name: payload.author_name ?? 'Unknown',
        rating: payload.rating ?? null,
        body: payload.body ?? null,
        platform_url: payload.url ?? null,
        ingested_at: now,
      });

    res.status(200).json({ received: true });
  } catch (e) {
    next(e);
  }
}
