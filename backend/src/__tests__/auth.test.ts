import request from 'supertest';
import app from '../app';

describe('POST /api/auth/register', () => {
  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('rejects weak password', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'test@example.com', password: 'short', businessName: 'Test Co',
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  it('rejects invalid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com', password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('allows an unverified user to sign in (verification is a soft nudge, not a gate)', async () => {
    const email = `soft-verify-${Date.now()}@example.com`;
    await request(app).post('/api/auth/register').send({
      email, password: 'Password123!', businessName: 'Soft Co',
    });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.data?.accessToken).toBeTruthy();
  });
});
