import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { PROSPECT_SOURCE } from '../services/prospect_report.service';
import { prospectReportsQueue } from '../jobs/queue';
jest.mock('../jobs/queue', () => ({ prospectReportsQueue: { add: jest.fn().mockResolvedValue({id:'fixture'}), getJob: jest.fn().mockResolvedValue(null) } }));
describe('Admin native reports', () => {
  const prefix = `admin-report-${Date.now()}`; const emails: string[] = []; const ids: string[] = [];
  let adminToken: string, customerToken: string;
  async function login(admin: boolean) {
    const email = `${prefix}-${admin}@example.test`; emails.push(email);
    expect((await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: prefix })).status).toBe(201);
    if (admin) await db('users').where({ email }).update({ role: 'admin' });
    return (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
  }
  const get = (query: object = {}) => request(app).get('/api/admin/free-reports').set('Authorization', `Bearer ${adminToken}`).query({ search: prefix, ...query });
  beforeAll(async () => {
    adminToken = await login(true); customerToken = await login(false);
    const inserted = await db('audit_leads').insert(Array.from({ length: 28 }, (_, i) => ({
      business_name: `${prefix}-${i}${i === 0 ? '%_' : ''}`, email: `${prefix}-${i}@example.test`, city: 'Atlanta', keyword: 'video production',
      source: i === 27 ? 'legacy-vendor' : PROSPECT_SOURCE,
      updated_at: i === 1 ? new Date(Date.now() - 20 * 60000) : new Date(),
      audit_data: JSON.stringify({ status: i === 1 ? 'processing' : i === 2 ? 'failed' : 'completed', emailStatus: i === 3 ? 'failed' : 'accepted',
        consentAt: '2026-09-09T12:00:00Z', consentVersion: 'report-delivery-only-v1', emailId: 'private-receipt-id',
        snapshot: i === 1 || i === 2 ? null : { generatedAt: '2026-09-09T12:05:00Z', summary: { checked: 9, unavailable: 0 }, points: ['private-large-payload'] } })
    }))).returning('id'); ids.push(...inserted.map(r => r.id));
  });
  afterAll(async () => { await db('audit_leads').whereIn('id', ids).delete(); await db('users').whereIn('email', emails).delete(); });
  it('requires admin authorization', async () => {
    expect((await request(app).get('/api/admin/free-reports')).status).toBe(401);
    expect((await request(app).get('/api/admin/free-reports').set('Authorization', `Bearer ${customerToken}`)).status).toBe(403);
  });
  it('paginates only native reports with safe operational metadata', async () => {
    const first = await get(); expect(first.status).toBe(200); expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.data).toMatchObject({ total: 27, page: 1, hasMore: true }); expect(first.body.data.reports).toHaveLength(25);
    const second = await get({ page: 2 }); expect(second.body.data.reports).toHaveLength(2); expect(second.body.data.hasMore).toBe(false);
    const rows = [...first.body.data.reports, ...second.body.data.reports]; expect(new Set(rows.map(r => r.id)).size).toBe(27);
    expect(JSON.stringify(rows)).not.toContain('private-receipt-id'); expect(JSON.stringify(rows)).not.toContain('private-large-payload');
    expect(rows.find(r => r.businessName.endsWith('-1'))).toMatchObject({ stale: true, needsAttention: true, hasSnapshot: false, checked: null });
    expect(rows.find(r => r.businessName.endsWith('-3'))).toMatchObject({ emailStatus: 'failed', hasSnapshot: true, checked: 9, unavailable: 0 });
  });
  it('filters failures, stalled processing and email failures without hiding completed reports', async () => {
    expect((await get({ status: 'attention' })).body.data.total).toBe(3);
    expect((await get({ status: 'failed' })).body.data.total).toBe(1);
    expect((await get({ status: 'completed' })).body.data.total).toBe(25);
    expect((await get({ search: `${prefix}-0%_` })).body.data.total).toBe(1);
    expect((await get({ search: ids[0] })).body.data.total).toBe(1);
    expect((await get({ search: 'nonexistent-report-fixture' })).body.data.total).toBe(0);
  });
  it('rejects malformed filters and page bounds', async () => {
    for (const query of [{ page: 0 }, { page: 1.5 }, { page: 'bad' }, { status: 'injected' }, { search: 'x'.repeat(101) }]) expect((await get(query)).status).toBe(422);
  });
  it('authorizes recovery and blocks existing active jobs and ambiguous email', async () => {
    const path=`/api/admin/free-reports/${ids[2]}/recover`;
    expect((await request(app).post(path)).status).toBe(401);
    expect((await request(app).post(path).set('Authorization',`Bearer ${customerToken}`)).status).toBe(403);
    const recover=(id:string)=>request(app).post(`/api/admin/free-reports/${id}/recover`).set('Authorization',`Bearer ${adminToken}`);
    expect((await recover(ids[3])).status).toBe(409);
    (prospectReportsQueue.getJob as jest.Mock).mockResolvedValueOnce({getState:async()=>'active'});
    expect((await recover(ids[2])).status).toBe(409);
    expect((await recover(ids[2])).status).toBe(202);
    expect(prospectReportsQueue.add).toHaveBeenCalledWith('generate',{id:ids[2]},expect.objectContaining({jobId:ids[2]}));
    const before=(await db('audit_leads').where({id:ids[2]}).first()).audit_data;
    (prospectReportsQueue.add as jest.Mock).mockRejectedValueOnce(new Error('queue unavailable'));
    expect((await recover(ids[2])).status).toBe(500);
    expect((await db('audit_leads').where({id:ids[2]}).first()).audit_data).toEqual(before);
    expect((await recover(ids[27])).status).toBe(404);
  });

});
