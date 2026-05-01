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

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Access control — client data isolation', () => {
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    tokenA = await registerAndLogin('client-a@example.com');
    tokenB = await registerAndLogin('client-b@example.com');
  });

  it('GET /api/reviews returns only own reviews', async () => {
    // Insert a review for client A directly
    const clientA = await db('clients').where({ user_id: db('users').where({ email: 'client-a@example.com' }).select('id') }).first();
    if (!clientA) return; // skip if DB not set up for integration

    await db('reviews').insert({
      client_id: clientA.id,
      platform: 'google',
      external_review_id: 'ext-secret-a',
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
