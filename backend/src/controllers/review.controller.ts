import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
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

export async function listFeedback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = 20;
    const campaignId = req.query.campaignId as string | undefined;

    let query = db('private_feedback').where({ client_id: req.clientId });
    if (campaignId) query = query.where({ campaign_id: campaignId });

    const countResult = await query.clone().count('id as cnt').first();
    const total = parseInt(String((countResult as Record<string, unknown>)?.cnt ?? 0), 10);

    const rows = await query
      .orderBy('received_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    ok(res, {
      feedback: rows.map((f) => ({
        id: f.id,
        campaignId: f.campaign_id,
        contactName: maskName(f.contact_name as string | null),
        contactEmail: maskEmail(f.contact_email as string | null),
        contactPhone: maskPhone(f.contact_phone as string | null),
        rating: f.rating,
        message: f.message,
        receivedAt: f.received_at,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e) {
    next(e);
  }
}

function maskName(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts.map((p) => p[0] + '***').join(' ');
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.slice(0, 3) + '***';
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

