import request from 'supertest';
import { randomUUID } from 'crypto';
import QRCode from 'qrcode';
import app from '../app';
import { db } from '../db/connection';
import { mappingIdentity } from '../services/provider_mapping.service';

describe('Native honest review collection', () => {
  let auth: string, other: string, client: string, location: string, token: string;
  const emails: string[] = [];
  const issue = (action: string, bearer = auth) => request(app).post(`/api/campaigns/collection/${location}`).set('Authorization', `Bearer ${bearer}`).send({ action });
  const submit = (body: object, ip = '192.0.2.41') => request(app).post(`/api/collection/${token}/feedback`).set('X-Forwarded-For', ip).send(body);
  beforeAll(async () => {
    for (const label of ['a','b']) {
      const email = `collection-${label}-${Date.now()}@example.com`; emails.push(email);
      await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Collection fixture' });
      const user = await db('users').where({ email }).first(); const c = await db('clients').where({ user_id: user.id }).first();
      const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
      if (label === 'a') { auth = login.body.data.accessToken; client = c.id; } else other = login.body.data.accessToken;
    }
    const [l] = await db('locations').insert({ client_id: client, name: 'Trainer fixture', google_place_id: 'ChIJ-test-trainer' }).returning('*'); location = l.id;
  });
  afterAll(async () => { await db('users').whereIn('email', emails).del(); });
  it('requires owner access and a verified mapping before creating a link', async () => {
    expect((await issue('create', other)).status).toBe(404);
    expect((await issue('create')).status).toBe(409);
    const l = await db('locations').where({ id: location }).first();
    await db('provider_organization_owners').insert({ client_id: client, organization_id: '887700' });
    await db('provider_location_mappings').insert({ location_id: location, client_id: client, organization_id: '887700', provider_location_id: '887701', google_place_id: l.google_place_id, revision: 1, evidence: JSON.stringify({ localIdentity: mappingIdentity(l) }), note: 'Test only', verified_at: new Date() });
    const result = await issue('create'); expect(result.status).toBe(200); token = result.body.data.url.split('/').pop(); expect(token).toMatch(/^[a-f0-9]{64}$/);
    const repeated = await Promise.all([issue('create'), issue('create')]); repeated.forEach(r => expect(r.body.data.url).toBe(result.body.data.url));
    expect((await request(app).get('/api/campaigns/collection').set('Authorization', `Bearer ${other}`)).body.data.locations).toEqual([]);
  });
  it('exposes only public branding and a fixed encoded Google destination', async () => {
    const r = await request(app).get(`/api/collection/${token}?redirect=https://evil.example`);
    expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.data).toEqual({ businessName: 'Trainer fixture', googleUrl: 'https://search.google.com/local/writereview?placeid=ChIJ-test-trainer' });
    expect((await request(app).get('/api/collection/invalid')).status).toBe(404);
  });
  it('stores every rating privately with tenant provenance and idempotent retry', async () => {
    for (const rating of [1,2,3,4,5]) {
      const payload = { submissionId: randomUUID(), rating, message: `Rating ${rating}` };
      const results = await Promise.all([submit(payload, `192.0.2.${rating}`), submit(payload, `192.0.2.${rating}`)]);
      results.forEach(r => expect(r.status).toBe(200));
      expect(await db('private_feedback').where({ location_id: location, submission_id: payload.submissionId })).toHaveLength(1);
      expect((await submit({ ...payload, message: 'changed' }, `192.0.2.${rating}`)).status).toBe(409);
    }
    const own = await request(app).get(`/api/reviews/feedback?locationId=${location}`).set('Authorization', `Bearer ${auth}`);
    expect(own.body.data.total).toBe(5); expect(own.body.data.feedback.every((f: any) => f.source === 'native' && f.locationId === location)).toBe(true);
    expect((await request(app).get('/api/reviews/feedback').set('Authorization', `Bearer ${other}`)).body.data.total).toBe(0);
    expect((await request(app).get(`/api/reviews/feedback?locationId=${location}`).set('Authorization', `Bearer ${other}`)).status).toBe(404);
  });
  it('validates contact consent, bounds, untrusted fields and bot submissions', async () => {
    const base = { submissionId: randomUUID(), message: 'Thanks' };
    for (const payload of [{ ...base, email: 'me@example.com' }, { ...base, message: 'x'.repeat(2001) }, { ...base, rating: 6 }, { ...base, clientId: client }, { ...base, website: 'bot' }]) expect((await submit(payload)).status).toBe(422);
    expect((await submit({ ...base, email: 'me@example.com', contactConsent: true })).status).toBe(200);
    const own = await request(app).get('/api/reviews/feedback').set('Authorization', `Bearer ${auth}`);
    expect(own.body.data.feedback[0]).toMatchObject({ contactEmail: 'me@example.com', contactConsent: true });
  });
  it('rate limits submissions including invalid requests without affecting public reads', async () => {
    for (let i = 0; i < 10; i++) expect((await submit({}, '192.0.2.77')).status).toBe(422);
    expect((await submit({}, '192.0.2.77')).status).toBe(429);
    expect((await request(app).get(`/api/collection/${token}`).set('X-Forwarded-For', '192.0.2.77')).status).toBe(200);
  });
  it('generates a QR PNG for the exact active native URL and denies foreign downloads', async () => {
    const spy = jest.spyOn(QRCode, 'toBuffer');
    const r = await request(app).get(`/api/campaigns/collection/${location}/qr.png`).set('Authorization', `Bearer ${auth}`);
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/image\/png/); expect(r.body.subarray(1,4).toString()).toBe('PNG');
    expect(spy.mock.calls[0][0]).toMatch(new RegExp(`/review/${token}$`)); spy.mockRestore();
    expect((await request(app).get(`/api/campaigns/collection/${location}/qr.png`).set('Authorization', `Bearer ${other}`)).status).toBe(404);
  });
  it('filters private feedback by rating and validates pagination', async () => {
    const filtered = await request(app).get('/api/reviews/feedback?rating=1').set('Authorization', `Bearer ${auth}`);
    expect(filtered.body.data.total).toBe(1); expect(filtered.body.data.feedback[0].rating).toBe(1);
    expect((await request(app).get('/api/reviews/feedback?page=invalid').set('Authorization', `Bearer ${auth}`)).status).toBe(422);
    const page = await request(app).get('/api/reviews/feedback?page=2').set('Authorization', `Bearer ${auth}`);
    expect(page.body.data.feedback).toEqual([]); expect(page.body.data.total).toBe(6);
  });
  it('revokes immediately, rotates without reviving old tokens, and invalidates mapping changes', async () => {
    const old = token; expect((await issue('revoke')).status).toBe(200);
    expect((await request(app).get(`/api/collection/${old}`)).status).toBe(404);
    expect((await submit({ submissionId: randomUUID(), message: 'After revoke' }, '192.0.2.88')).status).toBe(404);
    expect((await issue('create')).status).toBe(409);
    token = (await issue('rotate')).body.data.url.split('/').pop(); expect(token).not.toBe(old);
    expect((await request(app).get(`/api/collection/${old}`)).status).toBe(404);
    await db('provider_location_mappings').where({ location_id: location }).increment('revision', 1);
    expect((await request(app).get(`/api/collection/${token}`)).status).toBe(404);
    token = (await issue('rotate')).body.data.url.split('/').pop();
    await db('locations').where({ id: location }).update({ name: 'Changed business' });
    expect((await request(app).get(`/api/collection/${token}`)).status).toBe(404);
    expect((await issue('rotate')).status).toBe(409);
    expect(await db('private_feedback').where({ client_id: client })).toHaveLength(6);
  });
});
