import request from 'supertest';
import app from '../app';

describe('GET /api/health/live', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
