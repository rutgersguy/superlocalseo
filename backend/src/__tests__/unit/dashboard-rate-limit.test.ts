import express from 'express';
import request from 'supertest';
import { generalLimiter } from '../../middleware/rateLimit';

it('allows dashboard polling, still limits excess traffic, and never blocks logout', async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const app = express();
  app.use(generalLimiter);
  app.get('/api/dashboard-fixture', (_req, res) => res.sendStatus(200));
  app.post('/api/auth/logout', (_req, res) => res.sendStatus(204));
  try {
    for (let i = 0; i < 1000; i++) {
      const res = await request(app).get('/api/dashboard-fixture');
      expect(res.status).toBe(200);
    }
    expect((await request(app).get('/api/dashboard-fixture')).status).toBe(429);
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  } finally { process.env.NODE_ENV = old; }
}, 20000);
