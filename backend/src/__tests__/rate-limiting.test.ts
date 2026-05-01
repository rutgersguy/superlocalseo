/**
 * Rate limiting regression tests.
 * Verifies that auth endpoints enforce limits and return correct error codes.
 */
import request from 'supertest';
import app from '../app';

describe('Rate limiting — auth endpoints', () => {
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
});

describe('Rate limiting — general API', () => {
  it('200 on normal requests (not limited)', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
  });
});
