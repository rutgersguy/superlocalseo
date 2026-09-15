import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { initialScansQueue } from '../jobs/queue';
import { ensureInitialScans, processInitialScans, reconcileInitialScans } from '../services/initial_scans';
import { syncRankingsForClient } from '../jobs/rankings.job';
import { processCitations } from '../jobs/citations.job';
import { processAiVisibility } from '../jobs/ai_visibility.job';
import { getRankForCoordinate } from '../services/dataforseo.service';
import { computeAuditScores } from '../services/audit_score.service';
jest.mock('../jobs/rankings.job', () => ({ syncRankingsForClient: jest.fn(), processRankings: jest.fn() }));
jest.mock('../jobs/citations.job', () => ({ processCitations: jest.fn() }));
jest.mock('../jobs/ai_visibility.job', () => ({ processAiVisibility: jest.fn() }));
jest.mock('../services/dataforseo.service', () => ({ getRankForCoordinate: jest.fn() }));
jest.mock('../services/audit_score.service', () => ({ computeAuditScores: jest.fn() }));
jest.mock('../services/geocode.service', () => ({ geocodeAddress: jest.fn().mockResolvedValue(null) }));
describe('durable scoped initial scans', () => {
  let clientId: string, locationId: string, otherLocation: string, token: string;
  const email = `initial-scans-${Date.now()}@example.com`;
  const run = () => processInitialScans({ data: { clientId, locationId } } as any);
  beforeAll(async () => {
    jest.spyOn(initialScansQueue, 'add').mockResolvedValue({} as never);
    await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Initial scan fixture' });
    const user = await db('users').where({ email }).first();
    clientId = (await db('clients').where({ user_id: user.id }).first()).id;
    token = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
    await db('clients').where({ id: clientId }).update({ subscription_status: 'trialing', product_line: 'pro' });
    locationId = (await db('locations').insert({ client_id: clientId, name: 'Initial scan fixture', city: 'Tulsa', state: 'Oklahoma' }).returning('id'))[0].id;
    otherLocation = (await db('locations').insert({ client_id: clientId, name: 'Other location' }).returning('id'))[0].id;
    await db('keywords').insert({ location_id: locationId, keyword: 'personal trainer Tulsa' });
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    (syncRankingsForClient as jest.Mock).mockResolvedValue({ snapshotsSaved: 1, errors: [] });
    (processCitations as jest.Mock).mockResolvedValue(undefined);
    (processAiVisibility as jest.Mock).mockResolvedValue(undefined);
    await db('initial_scans').where({ client_id: clientId }).delete();
  });
  afterAll(async () => { await db('users').where({ email }).delete(); });
  it('requires explicit tenant and location and never fans out missing scope', async () => {
    await expect(processInitialScans({ data: {} } as any)).rejects.toThrow('explicit');
    await ensureInitialScans('00000000-0000-4000-8000-000000000001', locationId);
    expect(await db('initial_scans').where({ location_id: locationId })).toHaveLength(0);
  });
  it('enrolls one location and concurrent or repeated deliveries purchase each step once', async () => {
    await ensureInitialScans(clientId, locationId);
    await Promise.all([run(), run()]); await run();
    expect(syncRankingsForClient).toHaveBeenCalledTimes(1);
    expect(syncRankingsForClient).toHaveBeenCalledWith(clientId, locationId);
    expect(processCitations).toHaveBeenCalledTimes(1); expect(processAiVisibility).toHaveBeenCalledTimes(1);
    expect((processAiVisibility as jest.Mock).mock.calls[0][0].data).toMatchObject({ clientId, locationId });
    expect(await db('initial_scans').where({ location_id: otherLocation })).toHaveLength(0);
    const states = await db('initial_scans').where({ location_id: locationId });
    expect(states.find(s => s.step === 'reviews')).toMatchObject({ status: 'waiting' });
    expect(states.find(s => s.step === 'map')).toMatchObject({ status: 'waiting' });
  });
  it('saving a location enrolls scans without completing onboarding', async () => {
    const response = await request(app).post('/api/locations').set('Authorization', `Bearer ${token}`).send({ name: 'Saved in Settings', city: 'Tulsa', state: 'Oklahoma' });
    expect(response.status).toBe(201);
    expect(await db('initial_scans').where({ location_id: response.body.data.id })).toHaveLength(6);
    await db('locations').where({ id: response.body.data.id }).delete();
  });
  it('reuses existing observations instead of repurchasing them', async () => {
    const keyword = await db('keywords').where({ location_id: locationId }).first();
    await db('ranking_snapshots').insert({ keyword_id: keyword.id, location_id: locationId, rank: 2, search_engine: 'google', pulled_at: new Date() });
    await ensureInitialScans(clientId, locationId); await run();
    expect(syncRankingsForClient).not.toHaveBeenCalled();
    expect((await db('initial_scans').where({ location_id: locationId, step: 'rankings' }).first()).status).toBe('existing');
    await db('ranking_snapshots').where({ location_id: locationId }).delete();
  });
  it('queue failure leaves durable enrollment for reconciliation', async () => {
    (initialScansQueue.add as jest.Mock).mockRejectedValueOnce(new Error('Redis unavailable'));
    await ensureInitialScans(clientId, locationId);
    expect(await db('initial_scans').where({ location_id: locationId })).toHaveLength(6);
    await reconcileInitialScans();
    expect(initialScansQueue.add).toHaveBeenLastCalledWith('initial-location', { clientId, locationId }, expect.objectContaining({ jobId: `initial-location-${locationId}` }));
  });
  it('does not retry failed or interrupted paid attempts', async () => {
    await ensureInitialScans(clientId, locationId);
    await db('initial_scans').where({ location_id: locationId, step: 'rankings' }).update({ status: 'running', started_at: new Date(0) });
    (processCitations as jest.Mock).mockRejectedValueOnce(new Error('Unknown upstream outcome'));
    await run(); await run();
    expect(syncRankingsForClient).not.toHaveBeenCalled(); expect(processCitations).toHaveBeenCalledTimes(1);
    expect((await db('initial_scans').where({ location_id: locationId, step: 'citations' }).first()).status).toBe('needs_attention');
    const res = await request(app).get('/api/locations/initial-scans').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200); expect(res.body.data.find((s: any) => s.step === 'rankings').status).toBe('needs_attention');
    expect(JSON.stringify(res.body)).not.toContain('Unknown upstream outcome');
  });
  it('resumes when details arrive and bounds the first map to nine sequential observations', async () => {
    await ensureInitialScans(clientId, locationId);
    (getRankForCoordinate as jest.Mock).mockResolvedValue({ rank: 2, url: null });
    (computeAuditScores as jest.Mock).mockResolvedValue({ napScore: null, citationScore: null, compositeScore: null, onPageScore: 90, onPageDetails: [] });
    await db('locations').where({ id: locationId }).update({ lat: 36, lng: -96, address: '123 Main St', website: 'https://example.com' });
    await run(); await run();
    expect(getRankForCoordinate).toHaveBeenCalledTimes(9); expect(computeAuditScores).toHaveBeenCalledTimes(1);
    const map = await db('geo_grid_reports').where({ location_id: locationId }).first();
    expect(map.status).toBe('complete'); expect(map.grid_data).toHaveLength(9); expect(map.grid_data[4]).toMatchObject({ lat: 36, lng: -96, gridRow: 0, gridCol: 0 });
    await db('locations').where({ id: locationId }).update({ lat: null, lng: null, website: null });
  });
});
