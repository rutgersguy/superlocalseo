import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { encrypt } from '../utils/crypto';
import { mappingIdentity } from '../services/provider_mapping.service';
import { resolveProviderRoute, withProviderRoute } from '../services/provider_routing';
import { handleEmrWebhook } from '../controllers/emr_webhook.controller';
import { reviewsQueue } from '../jobs/queue';
import { processReviews } from '../jobs/reviews.job';
import { fetchAllReviews, fetchCampaigns, listConnectLinks, sendInvite, replyToReview } from '../services/embedmyreviews.service';
jest.mock('../config', () => { const { config } = jest.requireActual('../config'); return { config: { ...config, embedmyreviews: { ...config.embedmyreviews, apiKey: 'test-only' } } }; });
jest.mock('../services/embedmyreviews.service', () => ({ ...jest.requireActual('../services/embedmyreviews.service'),
  createOrganization: jest.fn().mockResolvedValue({ id: 899990, defaultLocationId: 899991 }), renameLocation: jest.fn().mockResolvedValue(undefined),
  fetchAllReviews: jest.fn(), fetchCampaigns: jest.fn().mockResolvedValue([]), listConnectLinks: jest.fn().mockResolvedValue([]), sendInvite: jest.fn(), replyToReview: jest.fn() }));

describe('Explicit provider routing', () => {
  const emails: string[] = [];
  let a: string, b: string, token: string, a1: string, a2: string, b1: string;
  beforeAll(async () => {
    jest.spyOn(reviewsQueue, 'add').mockResolvedValue({} as never);
    for (const label of ['a', 'b']) {
      const email = `routing-${label}-${Date.now()}@example.com`; emails.push(email);
      await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Routing fixture' });
      const user = await db('users').where({ email }).first();
      const client = await db('clients').where({ user_id: user.id }).first();
      if (label === 'a') { a = client.id; token = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken; } else b = client.id;
    }
    await db('clients').where({ id: a }).update({ emr_organization_id: 880100, emr_location_id: 880101 });
    await db('clients').where({ id: b }).update({ emr_organization_id: 880200, emr_location_id: 880201 });
    const rows = await db('locations').insert([{ client_id: a, name: 'A first', google_place_id: 'ChIJ-a1' }, { client_id: a, name: 'A second', google_place_id: 'ChIJ-a2' }, { client_id: b, name: 'B first', google_place_id: 'ChIJ-b1' }]).returning('*');
    [a1, a2, b1] = rows.map(r => r.id);
    await db('provider_organization_owners').insert([{ client_id: a, organization_id: '880100' }, { client_id: b, organization_id: '880200' }]);
    for (let i = 0; i < rows.length; i++) {
      const l = rows[i]; await db('provider_location_mappings').insert({ location_id: l.id, client_id: l.client_id, organization_id: i === 2 ? '880200' : '880100', provider_location_id: ['880101', '880102', '880201'][i], google_place_id: l.google_place_id, revision: 1, evidence: JSON.stringify({ localIdentity: mappingIdentity(l) }), note: 'Isolated test fixture', verified_at: new Date() });
    }
    await db('integrations').where({ client_id: a, provider: 'embedmyreviews' }).delete();
    await db('integrations').insert({ client_id: a, provider: 'embedmyreviews', status: 'connected', api_key_encrypted: encrypt('fixture') });
  });
  beforeEach(() => { jest.clearAllMocks(); (fetchAllReviews as jest.Mock).mockImplementation(async (_key, id) => [{ id: `review-${id}`, platform: 'Google', author: 'Fixture', rating: 5, body: 'Fixture review', date: new Date().toISOString(), url: null, replied: false, replyDate: null, replyText: null, hidden: false, avatarUrl: null, verified: null }]); });
  afterAll(async () => { await db('users').whereIn('email', emails).del(); });
  it('requires a branch and refuses foreign or unmapped locations', async () => {
    await expect(resolveProviderRoute(a)).rejects.toMatchObject({ status: 409 });
    await expect(resolveProviderRoute(a, b1)).rejects.toMatchObject({ status: 404 });
    expect(await resolveProviderRoute(a, a2)).toMatchObject({ mode: 'explicit', providerLocationId: '880102' });
    const [extra] = await db('locations').insert({ client_id: a, name: 'Unmapped' }).returning('id');
    await expect(resolveProviderRoute(a, extra.id)).rejects.toMatchObject({ status: 409 });
  });
  it('scopes connection status to the selected provider location', async () => {
    const response = await request(app).get(`/api/integrations/emr/google/connect-link?locationId=${a2}`).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200); expect(response.body.data.mappingMode).toBe('explicit');
    expect(listConnectLinks).toHaveBeenCalledWith('test-only', 880102, 'google');
    const foreign = await request(app).get(`/api/integrations/emr/google/connect-link?locationId=${b1}`).set('Authorization', `Bearer ${token}`);
    expect(foreign.status).toBe(404);
  });
  it('imports each mapped branch with provenance and syncs an organization once', async () => {
    await processReviews({ data: { clientId: a, emrOnly: true } } as any);
    expect(fetchAllReviews).toHaveBeenCalledTimes(2);
    expect(fetchCampaigns).toHaveBeenCalledTimes(1);
    const reviews = await db('reviews').where({ client_id: a }).orderBy('emr_provider_location_id');
    expect(reviews.map(r => [r.location_id, r.emr_provider_location_id])).toEqual([[a1, '880101'], [a2, '880102']]);
    const mapping = await db('provider_location_mappings').where({ location_id: a2 }).first(); expect(mapping.last_review_sync_at).not.toBeNull();
    const filtered = await request(app).get(`/api/reviews?locationId=${a2}`).set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200); expect(filtered.body.data.reviews).toHaveLength(1); expect(filtered.body.data.reviews[0].locationId).toBe(a2);
  });
  it('rejects stale routing before a scoped write', async () => {
    const route = (await resolveProviderRoute(a, a2))!;
    await db('provider_location_mappings').where({ location_id: a2 }).increment('revision', 1);
    const write = jest.fn(); await expect(withProviderRoute(route, write)).rejects.toMatchObject({ status: 409 }); expect(write).not.toHaveBeenCalled();
  });
  it('does not publish legacy reviews after a customer moves to explicit mappings', async () => {
    const [review] = await db('reviews').insert({ client_id: a, source: 'emr', platform: 'Google', external_review_id: 'unassigned-old', rating: 5 }).returning('id');
    const response = await request(app).post(`/api/reviews/${review.id}/publish`).set('Authorization', `Bearer ${token}`).send({ body: 'Isolated fixture reply' });
    expect(response.status).toBe(409); expect(replyToReview).not.toHaveBeenCalled();
  });
  it('blocks invites without a verified location-specific setup', async () => {
    await db('emr_campaigns').insert({ client_id: a, emr_campaign_id: 'route-campaign', name: 'Unverified', emr_organization_id: '880100' });
    const response = await request(app).post('/api/campaigns/route-campaign/invite').set('Authorization', `Bearer ${token}`).send({ firstName: 'Fixture', email: 'fixture@example.com' });
    expect(response.status).toBe(409); expect(sendInvite).not.toHaveBeenCalled();
  });
  it('verifies separate branch campaign setup and rejects stale or wrong-branch invites', async () => {
    await db('emr_campaigns').where({ client_id: a, emr_campaign_id: 'route-campaign' }).update({ metrics_pulled_at: new Date() });
    await db('users').where({ email: emails[0] }).update({ role: 'admin' });
    const admin = (await request(app).post('/api/auth/login').send({ email: emails[0], password: 'Password123!' })).body.data.accessToken;
    const setup = await request(app).post('/api/campaigns/setup').set('Authorization', `Bearer ${token}`).send({ locationId: a1 });
    const proof = { campaignId: 'route-campaign', googlePlaceId: 'ChIJ-a1', templateVersion: 'honest-email-v1', identity: true, equalAccess: true, optionalFeedback: true, sender: true, optOut: true, schedule: true, noEnrollment: true };
    const verified = await request(app).patch(`/api/admin/campaign-setup/${setup.body.data.id}`).set('Authorization', `Bearer ${admin}`).send({ revision: 0, status: 'verified', note: 'Isolated branch campaign inspection', proof });
    expect(verified.status).toBe(200);
    const contact = { firstName: 'Fixture', email: 'fixture@example.com', locationId: a1 };
    expect((await request(app).post('/api/campaigns/route-campaign/invite').set('Authorization', `Bearer ${token}`).send(contact)).status).toBe(200);
    expect(sendInvite).toHaveBeenCalledTimes(1);
    expect((await request(app).post('/api/campaigns/route-campaign/invite').set('Authorization', `Bearer ${token}`).send({ ...contact, locationId: a2 })).status).toBe(409);
    const second = await request(app).post('/api/campaigns/setup').set('Authorization', `Bearer ${token}`).send({ locationId: a2 });
    expect((await request(app).patch(`/api/admin/campaign-setup/${second.body.data.id}`).set('Authorization', `Bearer ${admin}`).send({ revision: 0, status: 'verified', note: 'Reject shared branch campaign', proof: { ...proof, googlePlaceId: 'ChIJ-a2' } })).status).toBe(409);
    await db('provider_location_mappings').where({ location_id: a1 }).increment('revision', 1);
    expect((await request(app).post('/api/campaigns/route-campaign/invite').set('Authorization', `Bearer ${token}`).send(contact)).status).toBe(409);
    expect(sendInvite).toHaveBeenCalledTimes(1);
  });
  it('routes webhook review events by location and ignores ambiguous organization events', async () => {
    const response = { json: jest.fn() } as any;
    await handleEmrWebhook({ body: { event: 'review-created', organization_id: 880100, data: { id: 99 } } } as any, response);
    expect(reviewsQueue.add).not.toHaveBeenCalled();
    await handleEmrWebhook({ body: { event: 'review-created', organization_id: 880100, location_id: 880102, data: { id: 99 } } } as any, response);
    expect(reviewsQueue.add).toHaveBeenCalledWith('mapped-webhook-import', expect.objectContaining({ clientId: a, locationId: a2, emrOnly: true }), expect.anything());
  });
  it('invalidates routing after local business identity changes', async () => {
    await db('locations').where({ id: a2 }).update({ name: 'Changed identity' });
    await expect(resolveProviderRoute(a, a2)).rejects.toMatchObject({ status: 409 });
  });
});
