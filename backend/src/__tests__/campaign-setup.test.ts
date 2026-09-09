import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';

describe('Campaign setup requests', () => {
  let token: string, otherToken: string, adminToken: string, clientId: string, locationId: string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emails: string[] = [];
  async function account(kind: string, admin = false) {
    const email = `campaign-${kind}-${suffix}@example.com`; emails.push(email);
    const result = await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: `Campaign ${kind}` });
    expect(result.status).toBe(201);
    const user = await db('users').where({ email }).first();
    if (admin) await db('users').where({ id: user.id }).update({ role: 'admin' });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    expect(login.status).toBe(200);
    return { token: login.body.data.accessToken, client: await db('clients').where({ user_id: user.id }).first() };
  }
  beforeAll(async () => {
    const a = await account('a'); token = a.token; clientId = a.client.id;
    otherToken = (await account('b')).token; adminToken = (await account('admin', true)).token;
    const [loc] = await db('locations').insert({ client_id: clientId, name: 'Requested branch', city: 'Atlanta' }).returning('id');
    locationId = loc.id;
  });
  afterAll(async () => { await db('users').whereIn('email', emails).del(); });
  it('rejects foreign locations and invalid input', async () => {
    expect((await request(app).post('/api/campaigns/setup').set('Authorization', `Bearer ${otherToken}`).send({ locationId })).status).toBe(404);
    expect((await request(app).post('/api/campaigns/setup').set('Authorization', `Bearer ${token}`).send({ locationId: 'bad' })).status).toBe(400);
  });
  it('persists exactly one request under concurrent retries', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => request(app).post('/api/campaigns/setup').set('Authorization', `Bearer ${token}`).send({ locationId })));
    results.forEach(r => expect(r.status).toBe(200));
    expect(new Set(results.map(r => r.body.data.id)).size).toBe(1);
    expect(Number((await db('campaign_setup_requests').where({ client_id: clientId }).count('* as n').first())?.n)).toBe(1);
  });
  it('shows the saved status only to its owning client', async () => {
    const own = await request(app).get('/api/campaigns/setup').set('Authorization', `Bearer ${token}`);
    expect(own.body.data.requests[0]).toMatchObject({ locationId, status: 'requested' });
    const other = await request(app).get('/api/campaigns/setup').set('Authorization', `Bearer ${otherToken}`);
    expect(other.body.data.requests).toEqual([]);
  });
  it('restricts the operations queue to admins', async () => {
    expect((await request(app).get('/api/admin/campaign-setup')).status).toBe(401);
    expect((await request(app).get('/api/admin/campaign-setup').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    const result = await request(app).get('/api/admin/campaign-setup').set('Authorization', `Bearer ${adminToken}`);
    expect(result.status).toBe(200);
    expect(result.body.data.requests.find((r: any) => r.clientId === clientId)).toMatchObject({ locationName: 'Requested branch', campaigns: [] });
  });
  it('does not represent unavailable provider data as zero or an observed empty list', async () => {
    const unsub = await request(app).get('/api/campaigns/unsubscribes').set('Authorization', `Bearer ${token}`);
    expect(unsub.body.data).toMatchObject({ available: false, total: null });
    const credits = await request(app).get('/api/campaigns/credits').set('Authorization', `Bearer ${token}`);
    expect(credits.body.data).toMatchObject({ available: false, total: null });
    const templates = await request(app).get('/api/campaigns/templates').set('Authorization', `Bearer ${token}`);
    expect(templates.body.data.available).toBe(false);
  });
});
