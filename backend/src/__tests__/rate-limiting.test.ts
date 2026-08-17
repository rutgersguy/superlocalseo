/**
 * Rate limiting regression tests.
 * Verifies that auth endpoints enforce limits and return correct error codes.
 */
import request from 'supertest';
import app from '../app';

describe('Rate limiting — auth endpoints', () => {
  // authLimiter skips when NODE_ENV is 'development' OR 'test', so that the e2e
  // suite — every spec of which authenticates, all from one IP — does not trip it
  // part-way through (#164). The skip predicate reads process.env at call time,
  // so flipping it here exercises the limiter as production actually runs it.
  const realEnv = process.env.NODE_ENV;
  beforeAll(() => { process.env.NODE_ENV = 'production'; });
  afterAll(() => { process.env.NODE_ENV = realEnv; });

  it('returns 429 after exceeding auth limit (11th request)', async () => {
    const attempts = Array.from({ length: 11 }, (_, i) =>
      request(app).post('/api/auth/login').send({
        email: `flood${i}@example.com`,
        password: 'wrongpassword',
      }),
    );

    const responses = await Promise.all(attempts);
    const statuses = responses.map((r) => r.status);

    // At least the last request should be rate-limited (authLimiter allows 10 per 15 min)
    expect(statuses).toContain(429);
  });

  it('is SKIPPED under NODE_ENV=test so the e2e suite can authenticate freely', async () => {
    process.env.NODE_ENV = 'test';
    const attempts = Array.from({ length: 12 }, (_, i) =>
      request(app).post('/api/auth/login').send({
        email: `skipflood${i}@example.com`,
        password: 'wrongpassword',
      }),
    );
    const statuses = (await Promise.all(attempts)).map((r) => r.status);
    expect(statuses).not.toContain(429);
    process.env.NODE_ENV = 'production';
  });
});

describe('Rate limiting — general API', () => {
  it('200 on normal requests (not limited)', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
  });
});
