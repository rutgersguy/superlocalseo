/**
 * Access-control regression tests.
 * Verifies that client A cannot read or modify client B's data.
 * Uses the real DB (SQLite in-memory via knex test config).
 */
import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';

// ── helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin(email: string): Promise<string> {
  await request(app).post('/api/auth/register').send({
    email,
    password: 'Password123!',
    businessName: 'Test Business',
  });
  const login = await request(app).post('/api/auth/login').send({
    email,
    password: 'Password123!',
  });
  return (login.body as { data?: { accessToken?: string } }).data?.accessToken ?? '';
}

// The shared test DB is persistent, so a fixture registered on a prior run keeps its
// original trial_ends_at — which eventually lapses and makes requireClient return 402
// (TRIAL_EXPIRED) instead of 200. Reset the billing state each run so these
// data-isolation tests never depend on wall-clock time or prior pollution.
async function ensureHealthyTrial(email: string): Promise<void> {
  const user = await db('users').where({ email }).first();
  if (!user) return;
  await db('clients').where({ user_id: user.id }).update({
    subscription_status: 'trialing',
    trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Access control — client data isolation', () => {
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    tokenA = await registerAndLogin('client-a@example.com');
    tokenB = await registerAndLogin('client-b@example.com');
    await ensureHealthyTrial('client-a@example.com');
    await ensureHealthyTrial('client-b@example.com');
  });

  it('campaign lists remain scoped to the authenticated client', async () => {
    const a = await db('clients').where({ user_id: db('users').where({ email: 'client-a@example.com' }).select('id') }).first();
    const b = await db('clients').where({ user_id: db('users').where({ email: 'client-b@example.com' }).select('id') }).first();
    expect(a).toBeDefined(); expect(b).toBeDefined();
    const rows = await db('emr_campaigns').insert([
      { client_id: a.id, emr_campaign_id: `qa-a-${Date.now()}`, name: 'Private campaign A' },
      { client_id: b.id, emr_campaign_id: `qa-b-${Date.now()}`, name: 'Private campaign B' },
    ]).returning('*');
    try {
      const responseA = await request(app).get('/api/campaigns').set('Authorization', `Bearer ${tokenA}`);
      const responseB = await request(app).get('/api/campaigns').set('Authorization', `Bearer ${tokenB}`);
      expect(responseA.status).toBe(200); expect(responseB.status).toBe(200);
      const idsA = responseA.body.data.campaigns.map((c: { id: string }) => c.id);
      const idsB = responseB.body.data.campaigns.map((c: { id: string }) => c.id);
      expect(idsA).toContain(rows[0].id); expect(idsA).not.toContain(rows[1].id);
      expect(idsB).toContain(rows[1].id); expect(idsB).not.toContain(rows[0].id);
    } finally { await db('emr_campaigns').whereIn('id', rows.map(r => r.id)).del(); }
  });

  it('legacy campaign creation explains assisted setup without creating a campaign', async () => {
    const before = await db('emr_campaigns').count('* as count').first();
    const response = await request(app).post('/api/campaigns').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Release QA' });
    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe('CAMPAIGN_SETUP_REQUIRED');
    expect(await db('emr_campaigns').count('* as count').first()).toEqual(before);
  });

  it('GET /api/reviews returns only own reviews', async () => {
    // Insert a review for client A directly
    const clientA = await db('clients').where({ user_id: db('users').where({ email: 'client-a@example.com' }).select('id') }).first();
    if (!clientA) return; // skip if DB not set up for integration

    await db('reviews').insert({
      client_id: clientA.id,
      platform: 'google',
      external_review_id: `ext-secret-a-${Date.now()}`,
      author_name: 'Secret Author',
      rating: 5,
      body: 'secret review content',
      status: 'new',
      review_date: new Date(),
      ingested_at: new Date(),
    });

    const res = await request(app)
      .get('/api/reviews')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    const reviews = (res.body as { data?: { reviews?: Array<{ body?: string }> } }).data?.reviews ?? [];
    expect(reviews.some((r) => r.body === 'secret review content')).toBe(false);
  });

  it('cannot access review response of another client', async () => {
    // Use a fake UUID that belongs to no one
    const res = await request(app)
      .get('/api/reviews/00000000-0000-0000-0000-000000000001/response')
      .set('Authorization', `Bearer ${tokenB}`);

    // Should be 404 (not 403 leak), never 200
    expect(res.status).not.toBe(200);
  });

  it('GET /api/rankings returns 200 with empty data for fresh client', async () => {
    const res = await request(app)
      .get('/api/rankings')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
  });

  it('unauthenticated requests to protected routes return 401', async () => {
    const endpoints = [
      ['GET', '/api/reviews'],
      ['GET', '/api/rankings'],
      ['GET', '/api/campaigns'],
      ['GET', '/api/competitors'],
      ['GET', '/api/qr'],
    ] as const;

    for (const [method, path] of endpoints) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (request(app) as any)[method.toLowerCase()](path) as request.Response;
      expect(res.status).toBe(401);
    }
  });
});
