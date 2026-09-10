import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { readProviderMappingEvidence } from '../services/provider_mapping_evidence';
jest.mock('../services/provider_mapping_evidence', () => ({ readProviderMappingEvidence: jest.fn() }));
const readEvidence = readProviderMappingEvidence as jest.Mock;

describe('Explicit provider location mapping', () => {
  let adminToken: string, token: string, clientA: string, clientB: string;
  let locationA: string, branchA: string, locationB: string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emails: string[] = [];
  const place = 'ChIJ-mapping-fixture';
  async function account(kind: string, admin = false) {
    const email = `mapping-${kind}-${suffix}@example.com`; emails.push(email);
    expect((await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: `Mapping ${kind}` })).status).toBe(201);
    const user = await db('users').where({ email }).first();
    if (admin) await db('users').where({ id: user.id }).update({ role: 'admin' });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    return { token: login.body.data.accessToken, client: await db('clients').where({ user_id: user.id }).first() };
  }
  const input = (org = '880001', providerLoc = '880002', revision = 0) => ({ revision, organizationId: org, providerLocationId: providerLoc, googlePlaceId: place, note: 'Exact source identity checked' });
  const save = (id: string, body = input(), auth = adminToken) => request(app).put(`/api/admin/provider-mappings/${id}`).set('Authorization', `Bearer ${auth}`).send(body);
  beforeAll(async () => {
    const a = await account('a'); token = a.token; clientA = a.client.id;
    clientB = (await account('b')).client.id; adminToken = (await account('admin', true)).token;
    const rows = await db('locations').insert([
      { client_id: clientA, name: 'First branch', google_place_id: place },
      { client_id: clientA, name: 'Second branch', google_place_id: place },
      { client_id: clientB, name: 'Foreign branch', google_place_id: place },
    ]).returning('id');
    [locationA, branchA, locationB] = rows.map(r => r.id);
  });
  beforeEach(() => {
    readEvidence.mockReset().mockImplementation(async (organizationId, providerLocationId, googlePlaceId) =>
      ({ organizationId, providerLocationId, googlePlaceId, verifiedAt: new Date().toISOString(), source: 'provider-read-fixture' }));
  });
  afterAll(async () => { await db('users').whereIn('email', emails).del(); await db('provider_mapping_events').whereIn('client_id', [clientA, clientB]).del(); });

  it('requires admin access and validates canonical IDs', async () => {
    expect((await request(app).get('/api/admin/provider-mappings')).status).toBe(401);
    expect((await request(app).get('/api/admin/provider-mappings').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await save(locationA, input(), token)).status).toBe(403);
    expect((await request(app).put(`/api/admin/provider-mappings/${locationA}`).send(input())).status).toBe(401);
    expect((await save(locationA, { ...input(), organizationId: '0880001' })).status).toBe(422);
    expect((await save(locationA, { ...input(), revision: -1 })).status).toBe(422);
    expect(readEvidence).not.toHaveBeenCalled();
  });
  it('refuses absent or changed local Google identity and failed provider proof', async () => {
    expect((await save(locationA, { ...input(), googlePlaceId: 'ChIJ-wrong' })).status).toBe(409);
    expect(readEvidence).not.toHaveBeenCalled();
    readEvidence.mockRejectedValue(Object.assign(new Error('No exact provider match'), { status: 409 }));
    expect((await save(locationA)).status).toBe(409);
    expect(await db('provider_location_mappings').where({ location_id: locationA })).toHaveLength(0);
  });
  it('rejects foreign legacy organization and location claims without writing', async () => {
    await db('clients').where({ id: clientB }).update({ emr_organization_id: 880001 });
    expect((await save(locationA)).status).toBe(409);
    await db('clients').where({ id: clientB }).update({ emr_organization_id: null, emr_location_id: 880002 });
    expect((await save(locationA)).status).toBe(409);
    await db('clients').where({ id: clientB }).update({ emr_location_id: null });
    expect(await db('provider_mapping_events').where({ location_id: locationA })).toHaveLength(0);
  });
  it('serializes concurrent first saves and appends exactly one audit revision', async () => {
    const responses = await Promise.all([save(locationA), save(locationA)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db('provider_mapping_events').where({ location_id: locationA })).toHaveLength(1);
    expect((await db('provider_location_mappings').where({ location_id: locationA }).first()).revision).toBe(1);
    expect((await db('clients').where({ id: clientA }).first()).emr_location_id).toBeNull();
  });
  it('allows a second branch in the same organization, rejects duplicate locations and cross-customer organization reuse', async () => {
    expect((await save(branchA)).status).toBe(409);
    expect((await save(locationB, input('880001', '880004'))).status).toBe(409);
    expect((await save(branchA, input('880001', '880003'))).status).toBe(200);
    expect((await save(locationB, input('880005', '880002'))).status).toBe(409);
  });
  it('database constraints reject forged cross-customer and duplicate assignments independently of the service', async () => {
    const row = await db('provider_location_mappings').where({ location_id: locationA }).first();
    await expect(db('provider_location_mappings').insert({ ...row, location_id: locationB, client_id: clientB, provider_location_id: '889999' })).rejects.toMatchObject({ code: '23503' });
    await expect(db('provider_location_mappings').where({ location_id: branchA }).update({ provider_location_id: '880002' })).rejects.toMatchObject({ code: '23505' });
    await expect(db('provider_location_mappings').where({ location_id: locationA }).update({ client_id: clientB })).rejects.toMatchObject({ code: '23503' });
  });
  it('keeps historical evidence, prevents stale edits and flags changed local identity in the admin list', async () => {
    expect((await save(locationA, input('880001', '880006', 0))).status).toBe(409);
    expect((await save(locationA, input('880001', '880006', 1))).status).toBe(200);
    const events = await db('provider_mapping_events').where({ location_id: locationA }).orderBy('revision');
    expect(events).toHaveLength(2);
    expect(events[0].evidence.providerLocationId).toBe('880002');
    expect(events[1].evidence.providerLocationId).toBe('880006');
    await db('locations').where({ id: locationA }).update({ google_place_id: 'ChIJ-changed' });
    const result = await request(app).get('/api/admin/provider-mappings').set('Authorization', `Bearer ${adminToken}`);
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data.verificationAvailable).toBe(false);
    expect(result.body.data.locations.find((l: any) => l.locationId === locationA).mapping).toMatchObject({ revision: 2, identityCurrent: false });
    expect((await save(locationA, input('880001', '880006', 2))).status).toBe(409);
  });
  it('retains immutable audit identity after the mapped local location is deleted', async () => {
    await db('locations').where({ id: branchA }).delete();
    expect(await db('provider_location_mappings').where({ location_id: branchA })).toHaveLength(0);
    const events = await db('provider_mapping_events').where({ location_id: branchA });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ client_id: clientA });
    expect(events[0].evidence.providerLocationId).toBe('880003');
  });
  it('rechecks local identity after provider reads before persisting', async () => {
    readEvidence.mockImplementation(async (organizationId, providerLocationId, googlePlaceId) => {
      await db('locations').where({ id: locationB }).update({ google_place_id: 'ChIJ-concurrent-edit' });
      return { organizationId, providerLocationId, googlePlaceId, verifiedAt: new Date().toISOString() };
    });
    expect((await save(locationB, input('880007', '880008'))).status).toBe(409);
    expect(await db('provider_location_mappings').where({ location_id: locationB })).toHaveLength(0);
  });
});
