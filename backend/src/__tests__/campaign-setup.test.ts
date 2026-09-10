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
  it('records admin verification, prevents cross-tenant binding and preserves revision history', async () => {
    const r = await db('campaign_setup_requests').where({ client_id: clientId }).first();
    const update = (payload: any, auth = adminToken) => request(app).patch(`/api/admin/campaign-setup/${r.id}`).set('Authorization', `Bearer ${auth}`).send(payload);
    expect((await update({ revision: 0, status: 'in_progress', note: 'Inspecting setup' }, token)).status).toBe(403);
    expect((await request(app).patch(`/api/admin/campaign-setup/${r.id}`).send({})).status).toBe(401);
    expect((await update({ revision: 0, status: 'in_progress', note: 'Inspecting setup' })).status).toBe(200);
    expect((await update({ revision: 0, status: 'blocked', note: 'Old revision' })).status).toBe(409);
    const proof = { campaignId: 'verified-fixture', googlePlaceId: 'ChIJ-fixture-a', templateVersion: 'honest-email-v1', identity: true, equalAccess: true, optionalFeedback: true, sender: true, optOut: true, schedule: true, noEnrollment: true };
    expect((await update({ revision: 1, status: 'verified', note: 'All checks done', proof: { ...proof, equalAccess: false } })).status).toBe(422);
    expect((await update({ revision: 1, status: 'verified', note: 'All checks done', proof })).status).toBe(409);
    await db('locations').where({ id: locationId }).update({ google_place_id: proof.googlePlaceId });
    await db('clients').where({ id: clientId }).update({ emr_organization_id: 990001, emr_location_id: 990002 });
    const foreign = await db('clients').whereNot({ id: clientId }).first();
    await db('emr_campaigns').insert({ client_id: foreign.id, name: 'Foreign campaign', emr_campaign_id: proof.campaignId, metrics_pulled_at: new Date() });
    try { expect((await update({ revision: 1, status: 'verified', note: 'All checks done', proof })).status).toBe(409); }
    finally { await db('emr_campaigns').where({ client_id: foreign.id, emr_campaign_id: proof.campaignId }).delete(); }
    await db('emr_campaigns').insert({ client_id: clientId, name: 'Verified fixture', emr_campaign_id: proof.campaignId, metrics_pulled_at: new Date() });
    expect((await update({ revision: 1, status: 'verified', note: 'Wrong destination', proof: { ...proof, googlePlaceId: 'ChIJ-fixture-b' } })).status).toBe(409);
    await db('clients').where({ id: foreign.id }).update({ emr_organization_id: 990001 });
    try { expect((await update({ revision: 1, status: 'verified', note: 'Shared mapping rejected', proof })).status).toBe(409); }
    finally { await db('clients').where({ id: foreign.id }).update({ emr_organization_id: foreign.emr_organization_id }); }
    expect((await update({ revision: 1, status: 'verified', note: 'Every rating checked with no sends', proof })).status).toBe(200);
    const own = await request(app).get('/api/campaigns/setup').set('Authorization', `Bearer ${token}`);
    expect(own.body.data.requests[0]).toMatchObject({ status: 'verified', campaignName: 'Verified fixture', templateVersion: 'honest-email-v1' });
    expect(JSON.stringify(own.body)).not.toContain('Every rating checked'); expect(JSON.stringify(own.body)).not.toContain('verifiedBy');
    const history = await db('campaign_setup_events').where({ request_id: r.id }).orderBy('revision');
    expect(history).toHaveLength(2); expect(history[1].verification.publicReviewUrl).toBe('https://search.google.com/local/writereview?placeid=ChIJ-fixture-a');
    const queue = await request(app).get('/api/admin/campaign-setup').set('Authorization', `Bearer ${adminToken}`);
    expect(queue.body.data.requests.find((x: any) => x.id === r.id)).toMatchObject({ status: 'verified', locationId, revision: 2 });
    await db('locations').where({ id: locationId }).update({ google_place_id: 'ChIJ-fixture-b' });
    const changed = await request(app).get('/api/campaigns/setup').set('Authorization', `Bearer ${token}`);
    expect(changed.body.data.requests[0]).toMatchObject({ status: 'needs_reverification', verifiedAt: null });
    expect((await update({ revision: 2, status: 'blocked', note: 'Destination changed; investigating' })).status).toBe(200);
    expect((await db('campaign_setup_events').where({ request_id: r.id })).length).toBe(3);
    expect((await db('campaign_setup_events').where({ request_id: r.id, revision: 2 }).first()).verification.googlePlaceId).toBe('ChIJ-fixture-a');
    const [second] = await db('locations').insert({ client_id: clientId, name: 'Second branch', google_place_id: 'ChIJ-fixture-b' }).returning('id');
    try { expect((await update({ revision: 3, status: 'verified', note: 'Second branch test', proof: { ...proof, googlePlaceId: 'ChIJ-fixture-b' } })).status).toBe(409); }
    finally { await db('locations').where({ id: second.id }).delete(); }
    const concurrent = await Promise.all([update({ revision: 3, status: 'requested', note: 'Reopen for review' }), update({ revision: 3, status: 'in_progress', note: 'Concurrent operator update' })]);
    expect(concurrent.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db('campaign_setup_events').where({ request_id: r.id })).toHaveLength(4);
  });

});
