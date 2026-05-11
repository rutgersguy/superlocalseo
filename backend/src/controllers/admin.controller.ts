import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { redis } from '../db/redis';
import { ok, err } from '../utils/response';
import {
  rankingsQueue, citationsQueue, reviewsQueue, reportsQueue,
  competitorsQueue, auditsQueue, geoGridQueue, citationBuilderQueue, trialReminderQueue,
} from '../jobs/queue';
import { getCbCredits } from '../services/brightlocal.service';

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

    const [auditLeadsRow] = await db('audit_leads').whereNotNull('email').count('id as count');
    const auditLeads = parseInt(String((auditLeadsRow as { count: string }).count), 10);
    const [auditLeadsWeekRow] = await db('audit_leads').whereNotNull('email').where('created_at', '>=', weekAgo).count('id as count');
    const auditLeadsThisWeek = parseInt(String((auditLeadsWeekRow as { count: string }).count), 10);

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
      auditLeads: { total: auditLeads, thisWeek: auditLeadsThisWeek },
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

export async function analytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // New signups per month (last 12)
    const newClientsRows = await db('clients')
      .select(db.raw("DATE_TRUNC('month', created_at) as month"), db.raw('COUNT(*) as new_clients'))
      .where('created_at', '>=', db.raw("NOW() - INTERVAL '12 months'"))
      .groupByRaw("DATE_TRUNC('month', created_at)")
      .orderBy('month', 'asc') as Array<{ month: Date; new_clients: string }>;

    // Cancellations per month (last 12, by updated_at)
    const canceledRows = await db('clients')
      .select(db.raw("DATE_TRUNC('month', updated_at) as month"), db.raw('COUNT(*) as canceled'))
      .where('subscription_status', 'canceled')
      .where('updated_at', '>=', db.raw("NOW() - INTERVAL '12 months'"))
      .groupByRaw("DATE_TRUNC('month', updated_at)")
      .orderBy('month', 'asc') as Array<{ month: Date; canceled: string }>;

    // Merge new + canceled into unified month map
    const monthMap = new Map<string, { month: string; newClients: number; canceled: number }>();
    for (const r of newClientsRows) {
      const key = new Date(r.month).toISOString().slice(0, 7);
      monthMap.set(key, { month: key, newClients: parseInt(r.new_clients, 10), canceled: 0 });
    }
    for (const r of canceledRows) {
      const key = new Date(r.month).toISOString().slice(0, 7);
      const existing = monthMap.get(key);
      if (existing) {
        existing.canceled = parseInt(r.canceled, 10);
      } else {
        monthMap.set(key, { month: key, newClients: 0, canceled: parseInt(r.canceled, 10) });
      }
    }
    const churn = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    // MRR by month — active clients created in each month * tier price (approximation)
    const mrrRows = await db('clients')
      .select(
        db.raw("DATE_TRUNC('month', created_at) as month"),
        'subscription_tier',
        db.raw('COUNT(*) as count'),
      )
      .where('subscription_status', 'active')
      .where('created_at', '>=', db.raw("NOW() - INTERVAL '12 months'"))
      .groupByRaw("DATE_TRUNC('month', created_at), subscription_tier")
      .orderBy('month', 'asc') as Array<{ month: Date; subscription_tier: number; count: string }>;

    const mrrMap = new Map<string, { month: string; mrr: number; activeClients: number }>();
    for (const r of mrrRows) {
      const key = new Date(r.month).toISOString().slice(0, 7);
      const cnt = parseInt(r.count, 10);
      const price = TIER_PRICES[r.subscription_tier] ?? 0;
      const existing = mrrMap.get(key);
      if (existing) {
        existing.mrr += cnt * price;
        existing.activeClients += cnt;
      } else {
        mrrMap.set(key, { month: key, mrr: cnt * price, activeClients: cnt });
      }
    }
    const mrr = Array.from(mrrMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    // Tier breakdown (current state)
    const tierRows = await db('clients')
      .select('subscription_tier as tier')
      .count('id as count')
      .groupBy('subscription_tier')
      .orderBy('subscription_tier', 'asc') as Array<{ tier: number; count: string }>;
    const tierBreakdown = tierRows.map((r) => ({ tier: r.tier, count: parseInt(r.count, 10) }));

    // Status breakdown (current state)
    const statusRows = await db('clients')
      .select('subscription_status as status')
      .count('id as count')
      .groupBy('subscription_status') as Array<{ status: string; count: string }>;
    const statusBreakdown = statusRows.map((r) => ({ status: r.status, count: parseInt(r.count, 10) }));

    ok(res, { mrr, churn, tierBreakdown, statusBreakdown });
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

const JOB_QUEUE_MAP: Record<string, { queue: typeof rankingsQueue; jobName: string }> = {
  rankings: { queue: rankingsQueue, jobName: 'manual-trigger' },
  citations: { queue: citationsQueue, jobName: 'manual-trigger' },
  reviews: { queue: reviewsQueue, jobName: 'manual-trigger' },
  competitors: { queue: competitorsQueue, jobName: 'manual-trigger' },
  audits: { queue: auditsQueue, jobName: 'monthly-fan-out' },
};

export async function citationsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [credits, submissions] = await Promise.all([
      getCbCredits(),
      db('citation_submissions as cs')
        .join('clients as cl', 'cs.client_id', 'cl.id')
        .join('locations as l', 'cs.location_id', 'l.id')
        .select(
          'cs.id', 'cs.directory', 'cs.status', 'cs.listing_url',
          'cs.submitted_at', 'cs.live_at', 'cs.bl_submission_id',
          'cl.business_name as clientName',
          'l.name as locationName',
        )
        .orderBy('cs.submitted_at', 'desc')
        .limit(200),
    ]);

    const byStatus = (submissions as Array<{ status: string }>).reduce<Record<string, number>>((acc, s) => {
      acc[s.status] = (acc[s.status] ?? 0) + 1;
      return acc;
    }, {});

    ok(res, { credits, submissions, byStatus });
  } catch (e) {
    next(e);
  }
}

export async function triggerJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { job, clientId } = req.body as { job?: string; clientId?: string };

    if (!job || !JOB_QUEUE_MAP[job]) {
      err(res, `Unknown job "${job ?? ''}". Valid: ${Object.keys(JOB_QUEUE_MAP).join(', ')}`, 400, 'INVALID_JOB');
      return;
    }

    const { queue, jobName } = JOB_QUEUE_MAP[job];
    const added = await queue.add(jobName, clientId ? { clientId } : {});

    ok(res, { queued: true, jobId: added.id, job, clientId: clientId ?? null });
  } catch (e) {
    next(e);
  }
}
