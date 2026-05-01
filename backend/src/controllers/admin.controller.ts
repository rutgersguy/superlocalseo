import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { redis } from '../db/redis';
import { ok } from '../utils/response';
import {
  rankingsQueue, citationsQueue, reviewsQueue, reportsQueue,
  competitorsQueue, auditsQueue, geoGridQueue, citationBuilderQueue, trialReminderQueue,
} from '../jobs/queue';

const TIER_PRICES: Record<number, number> = { 1: 350, 2: 700, 3: 1200 };

const ALL_QUEUES = [
  { queue: rankingsQueue, name: 'rankings' },
  { queue: citationsQueue, name: 'citations' },
  { queue: reviewsQueue, name: 'reviews' },
  { queue: reportsQueue, name: 'reports' },
  { queue: competitorsQueue, name: 'competitors' },
  { queue: auditsQueue, name: 'audits' },
  { queue: geoGridQueue, name: 'geo-grid' },
  { queue: citationBuilderQueue, name: 'citation-builder' },
  { queue: trialReminderQueue, name: 'trial-reminder' },
];

export async function overview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Client aggregate stats
    const rows = await db('clients')
      .select('subscription_status', 'subscription_tier')
      .count('id as count')
      .groupBy('subscription_status', 'subscription_tier') as Array<{
        subscription_status: string;
        subscription_tier: number;
        count: string;
      }>;

    let total = 0, active = 0, trialing = 0, pastDue = 0, canceled = 0, mrr = 0;
    for (const r of rows) {
      const n = parseInt(r.count, 10);
      total += n;
      if (r.subscription_status === 'active') {
        active += n;
        mrr += n * (TIER_PRICES[r.subscription_tier] ?? 0);
      }
      if (r.subscription_status === 'trialing') trialing += n;
      if (r.subscription_status === 'past_due') pastDue += n;
      if (r.subscription_status === 'canceled') canceled += n;
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [newThisWeekRow] = await db('clients').where('created_at', '>=', weekAgo).count('id as count');
    const newThisWeek = parseInt(String((newThisWeekRow as { count: string }).count), 10);

    // 14-day signup sparkline
    const signupRows = await db('clients')
      .where('created_at', '>=', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))
      .select(db.raw("DATE(created_at) as date"), db.raw('COUNT(*) as count'))
      .groupByRaw('DATE(created_at)')
      .orderBy('date', 'asc') as Array<{ date: string; count: string }>;

    const signups = signupRows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) }));

    // System health
    let dbLatencyMs = -1;
    try {
      const t = Date.now();
      await db.raw('SELECT 1');
      dbLatencyMs = Date.now() - t;
    } catch {}

    let redisLatencyMs = -1;
    try {
      const t = Date.now();
      await redis.ping();
      redisLatencyMs = Date.now() - t;
    } catch {}

    // Queue counts
    const queueHealth = await Promise.all(
      ALL_QUEUES.map(async ({ queue, name }) => {
        try {
          const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
          return { name, ...counts, ok: true };
        } catch {
          return { name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, ok: false };
        }
      }),
    );

    ok(res, {
      clients: { total, active, trialing, pastDue, canceled, newThisWeek, mrr },
      health: {
        db: { ok: dbLatencyMs >= 0, latencyMs: dbLatencyMs },
        redis: { ok: redisLatencyMs >= 0, latencyMs: redisLatencyMs },
      },
      signups,
      queues: queueHealth,
    });
  } catch (e) {
    next(e);
  }
}

export async function clients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(100, parseInt(String(req.query.limit ?? '25'), 10));
    const search = String(req.query.search ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    const offset = (page - 1) * limit;

    let query = db('clients')
      .join('users', 'clients.user_id', 'users.id')
      .select(
        'clients.id',
        'clients.business_name',
        'clients.subscription_status',
        'clients.subscription_tier',
        'clients.trial_ends_at',
        'clients.subscription_current_period_end',
        'clients.created_at',
        'users.email',
      )
      .orderBy('clients.created_at', 'desc');

    if (search) {
      query = query.where((b) => {
        void b.whereILike('clients.business_name', `%${search}%`).orWhereILike('users.email', `%${search}%`);
      });
    }
    if (status) {
      query = query.where('clients.subscription_status', status);
    }

    const [countRow, rows] = await Promise.all([
      query.clone().clearSelect().clearOrder().count('clients.id as count').first() as unknown as Promise<{ count: string }>,
      query.offset(offset).limit(limit),
    ]);

    const clientIds = (rows as Array<{ id: string }>).map((r) => r.id);
    const locationCounts = clientIds.length > 0
      ? await db('locations').whereIn('client_id', clientIds).select('client_id').count('id as count').groupBy('client_id') as Array<{ client_id: string; count: string }>
      : [];
    const locMap = new Map(locationCounts.map((r) => [r.client_id, parseInt(r.count, 10)]));

    const total = parseInt(countRow.count, 10);

    ok(res, {
      clients: (rows as Array<Record<string, unknown>>).map((r) => ({
        id: r.id,
        businessName: r.business_name,
        email: r.email,
        status: r.subscription_status,
        tier: r.subscription_tier,
        trialEndsAt: r.trial_ends_at ?? null,
        periodEnd: r.subscription_current_period_end ?? null,
        locationCount: locMap.get(r.id as string) ?? 0,
        createdAt: r.created_at,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e) {
    next(e);
  }
}

export async function queues(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const results = await Promise.all(
      ALL_QUEUES.map(async ({ queue, name }) => {
        try {
          const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
          const failed = await queue.getFailed(0, 4);
          return {
            name,
            ...counts,
            ok: true,
            recentFailures: failed.map((j) => ({
              id: j.id,
              name: j.name,
              failedReason: j.failedReason,
              finishedOn: j.finishedOn,
            })),
          };
        } catch (e) {
          return { name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, ok: false, recentFailures: [] };
        }
      }),
    );
    ok(res, { queues: results });
  } catch (e) {
    next(e);
  }
}
