import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { redis } from '../db/redis';
import { reviewsQueue } from '../jobs/queue';
import { processReviews } from '../jobs/reviews.job';
import { encrypt } from '../utils/crypto';
import { ensureEmrTenancy } from '../services/emr_provisioning';
import { createOrganization, renameLocation, createConnectLink, listConnectLinks, fetchAllReviews, fetchCampaigns } from '../services/embedmyreviews.service';

jest.mock('../config', () => { const { config } = jest.requireActual('../config'); return { config: { ...config, embedmyreviews: { ...config.embedmyreviews, apiKey: 'test-only', baseUrl: 'https://app.superlocalseo.com' } } }; });

jest.mock('../services/embedmyreviews.service', () => ({
  ...jest.requireActual('../services/embedmyreviews.service'),
  createOrganization: jest.fn(), createLocation: jest.fn(), renameLocation: jest.fn(),
  createConnectLink: jest.fn(), listConnectLinks: jest.fn(), fetchAllReviews: jest.fn(), fetchCampaigns: jest.fn(),
}));

describe('EMR onboarding isolation and recovery', () => {
  let token: string, clientId: string, otherId: string;
  const email = `emr-onboarding-${Date.now()}@example.com`;
  const otherEmail = `emr-other-${Date.now()}@example.com`;
  const used = { token: 'old', provider: 'google', locationId: 991, connectUrl: 'https://app.superlocalseo.com/connect/old', status: 'used', usedAt: '2026-09-09T00:00:00Z', completedOauthAt: '2026-09-08T00:00:00Z', expiresAt: null, createdAt: null };
  beforeAll(async () => {
    jest.spyOn(reviewsQueue, 'add').mockResolvedValue({} as never);
    // Registration provisioning is asynchronous; leave mocks safe and configure specific cases afterwards.
    (createOrganization as jest.Mock).mockResolvedValue({ id: 998, defaultLocationId: 999 });
    (renameLocation as jest.Mock).mockResolvedValue(undefined);
    for (const e of [email, otherEmail]) {
      const reg = await request(app).post('/api/auth/register').send({ email: e, password: 'Password123!', businessName: 'Connection fixture' });
      expect(reg.status).toBe(201);
    }
    clientId = (await db('clients').where({ user_id: db('users').where({ email }).select('id') }).first()).id;
    otherId = (await db('clients').where({ user_id: db('users').where({ email: otherEmail }).select('id') }).first()).id;
    token = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await redis.del(`emr:connect-state:${clientId}:991`, `emr:sync:${clientId}`);
    await db('clients').whereIn('id', [clientId, otherId]).update({ emr_organization_id: null, emr_location_id: null, emr_provisioning_status: 'pending' });
    (listConnectLinks as jest.Mock).mockResolvedValue([]);
    (fetchAllReviews as jest.Mock).mockResolvedValue([]);
    (fetchCampaigns as jest.Mock).mockResolvedValue([]);
    (renameLocation as jest.Mock).mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await db('users').whereIn('email', [email, otherEmail]).del();
    await redis.del(`emr:connect-state:${clientId}:991`, `emr:sync:${clientId}`);
  });
  async function mapped() { await db('clients').where({ id: clientId }).update({ emr_organization_id: 990, emr_location_id: 991 }); }
  it('a status read never provisions an unconnected account', async () => {
    const res = await request(app).get('/api/integrations/emr/google/connect-link').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200); expect(res.body.data.phase).toBe('needs_setup');
    expect(createOrganization).not.toHaveBeenCalled(); expect(listConnectLinks).not.toHaveBeenCalled();
  });
  it('a selected profile with zero reviews is distinguished from authorization only', async () => {
    await mapped(); (listConnectLinks as jest.Mock).mockResolvedValue([used]);
    const res = await request(app).get('/api/integrations/emr/google/connect-link').set('Authorization', `Bearer ${token}`);
    expect(res.body.data).toMatchObject({ phase: 'profile_selected', profileSelected: true, reviewCount: null, lastSyncAt: null });
    expect(createOrganization).not.toHaveBeenCalled();
  });
  it('permits reconnect after profile selection and reuses an active link', async () => {
    await mapped(); (listConnectLinks as jest.Mock).mockResolvedValue([used]);
    const active = { ...used, token: 'new', status: 'active', usedAt: null, completedOauthAt: null, connectUrl: 'https://app.superlocalseo.com/connect/new', expiresAt: '2030-01-01T00:00:00Z' };
    (createConnectLink as jest.Mock).mockImplementation(async () => { (listConnectLinks as jest.Mock).mockResolvedValue([active, used]); return active; });
    const results = await Promise.all([1, 2].map(() => request(app).post('/api/integrations/emr/google/connect-link').set('Authorization', `Bearer ${token}`).send({})));
    results.forEach(r => { expect(r.status).toBe(200); expect(r.body.data.connectUrl).toBe(active.connectUrl); });
    expect(createConnectLink).toHaveBeenCalledTimes(1);
  });
  it('refuses shared mappings without exposing or moving another tenant', async () => {
    await mapped(); await db('clients').where({ id: otherId }).update({ emr_organization_id: 990, emr_location_id: 992 });
    for (const method of ['get', 'post'] as const) {
      const res = await request(app)[method]('/api/integrations/emr/google/connect-link').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(409);
    }
    expect(createOrganization).not.toHaveBeenCalled(); expect(listConnectLinks).not.toHaveBeenCalled();
  });
  it('does not convert provider failures into a not-connected response', async () => {
    await mapped(); (listConnectLinks as jest.Mock).mockRejectedValue(new Error('Provider offline'));
    const res = await request(app).get('/api/integrations/emr/google/connect-link').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500); expect(res.body.success).toBe(false);
  });
  it('serializes provisioning and preserves IDs after a naming failure', async () => {
    (createOrganization as jest.Mock).mockResolvedValue({ id: 990, defaultLocationId: 991 });
    (renameLocation as jest.Mock).mockRejectedValue(new Error('Naming unavailable'));
    expect(await Promise.all(Array.from({ length: 10 }, () => ensureEmrTenancy(clientId)))).toEqual(Array(10).fill(991));
    expect(createOrganization).toHaveBeenCalledTimes(1);
  });
  it('does not blindly repeat an ambiguous external creation', async () => {
    (createOrganization as jest.Mock).mockRejectedValue(new Error('Connection lost after request'));
    await expect(ensureEmrTenancy(clientId)).rejects.toThrow();
    await expect(ensureEmrTenancy(clientId)).rejects.toThrow('mapping check');
    expect(createOrganization).toHaveBeenCalledTimes(1);
  });
  it('allows a retry after a definite provider rejection', async () => {
    (createOrganization as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { providerStatus: 429 })).mockResolvedValue({ id: 990, defaultLocationId: 991 });
    await expect(ensureEmrTenancy(clientId)).rejects.toThrow('Rate limited');
    await expect(ensureEmrTenancy(clientId)).resolves.toBe(991);
    expect(createOrganization).toHaveBeenCalledTimes(2);
  });
  it('requires business selection, then queues only this client with a cooldown', async () => {
    await mapped();
    const url = '/api/integrations/emr/google/sync';
    expect((await request(app).post(url).set('Authorization', `Bearer ${token}`)).status).toBe(409);
    (listConnectLinks as jest.Mock).mockResolvedValue([used]);
    expect((await request(app).post(url).set('Authorization', `Bearer ${token}`)).status).toBe(202);
    expect(reviewsQueue.add).toHaveBeenCalledWith('google-connection-import', { clientId, emrOnly: true }, expect.anything());
    expect((await request(app).post(url).set('Authorization', `Bearer ${token}`)).status).toBe(429);
    expect(reviewsQueue.add).toHaveBeenCalledTimes(1);
  });
  it('a scoped import cannot sync another client and clears a resolved error', async () => {
    await mapped();
    await db('clients').where({ id: otherId }).update({ emr_organization_id: 992, emr_location_id: 993 });
    for (const id of [clientId, otherId]) {
      await db('integrations').where({ client_id: id, provider: 'embedmyreviews' }).del();
      await db('integrations').insert({ client_id: id, provider: 'embedmyreviews', status: 'connected', api_key_encrypted: encrypt('test-only'), error_message: 'Previous failure' });
    }
    await processReviews({ data: { clientId, emrOnly: true } } as any);
    expect(fetchAllReviews).toHaveBeenCalledTimes(1);
    expect(fetchAllReviews).toHaveBeenCalledWith('test-only', '991');
    expect((await db('integrations').where({ client_id: clientId, provider: 'embedmyreviews' }).first()).error_message).toBeNull();
    expect((await db('integrations').where({ client_id: otherId, provider: 'embedmyreviews' }).first()).error_message).toBe('Previous failure');
  });

});
