import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { reserveUsage } from '../services/plan-usage';
import { catalog } from '../config/plans';
jest.mock('../services/email.service', () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined), sendWelcomeEmail: jest.fn(), sendPasswordResetEmail: jest.fn() }));
jest.mock('../services/dataforseo.service', () => ({ getAggregatedSearchVolumes: jest.fn().mockResolvedValue([]) }));
describe('new plan limits', () => {
let clientId: string, userId: string, locationId: string, token: string;
beforeAll(async () => {
  const email = `limits-${Date.now()}@example.invalid`;
  await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Limits fixture' });
  const user = await db('users').where({ email }).first(); userId = user.id;
  clientId = (await db('clients').where({ user_id: userId }).first()).id;
  token = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
  await db('clients').where({ id: clientId }).update({ product_line: 'lite', plan_key: 'starter', subscription_status: 'active' });
  locationId = (await db('locations').insert({ client_id: clientId, name: 'Quota fixture' }).returning('id'))[0].id;
});
afterAll(async () => { await db('users').where({ id: userId }).delete(); });
it('serves the same three-plan catalog publicly without authentication', async () => {
  const r = await request(app).get('/api/billing/catalog');
  expect(r.status).toBe(200); expect(r.body.data).toEqual(catalog);
});
it('reserves the last monthly scan atomically and does not reset on an upgrade', async () => {
  await reserveUsage(clientId, locationId, 'gridScans');
  const results = await Promise.allSettled([reserveUsage(clientId, locationId, 'gridScans'), reserveUsage(clientId, locationId, 'gridScans')]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  await db('clients').where({ id: clientId }).update({ plan_key: 'pro', product_line: 'pro' });
  await reserveUsage(clientId, locationId, 'gridScans', 8);
  await expect(reserveUsage(clientId, locationId, 'gridScans')).rejects.toMatchObject({ code: 'PLAN_LIMIT' });
  await db('clients').where({ id: clientId }).update({ plan_key: 'starter', product_line: 'lite' });
});
it('allows only one concurrent keyword insertion into the last slot', async () => {
  await db('keywords').insert(Array.from({ length: 9 }, (_, i) => ({ location_id: locationId, keyword: `keyword ${i}` })));
  const results = await Promise.all(['last A', 'last B'].map(keyword => request(app).post('/api/keywords').set('Authorization', `Bearer ${token}`).send({ locationId, keyword })));
  expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  expect(results.find(r => r.status === 409)?.body.error.code).toBe('PLAN_LIMIT');
  const existing = await db('keywords').where({ location_id: locationId }).first();
  expect((await request(app).post('/api/keywords').set('Authorization', `Bearer ${token}`).send({ locationId, keyword: existing.keyword })).status).toBe(201);
});
it('Starter can read its small maps but cannot request larger grids or white-label branding', async () => {
  expect((await request(app).get('/api/geo-grid').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  const keyword = await db('keywords').where({ location_id: locationId }).first();
  const response = await request(app).post('/api/geo-grid').set('Authorization', `Bearer ${token}`).send({ locationId, keywordId: keyword.id, gridSize: 13 });
  expect(response.status).toBe(409); expect(response.body.error.code).toBe('PLAN_LIMIT');
  expect((await request(app).patch('/api/clients').set('Authorization', `Bearer ${token}`).send({ whiteLabelCompanyName: 'Not entitled' })).status).toBe(409);
});
it.each(['/citations', '/audits/bl', '/reputation', '/team', '/qr', '/competitors/gap', '/analytics/rankings', '/rankings/export'])('Starter keeps %s locked behind Pro', async path => {
  const r = await request(app).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  expect(r.status).toBe(403); expect(r.body.error.code).toBe('PRO_REQUIRED');
});
it('expired trials cannot reserve provider work', async () => {
  await db('clients').where({ id: clientId }).update({ subscription_status: 'trialing', trial_ends_at: new Date(0) });
  await expect(reserveUsage(clientId, locationId, 'aiChecks')).rejects.toMatchObject({ code: 'PLAN_LIMIT' });
});

});
