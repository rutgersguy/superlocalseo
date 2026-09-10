import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { readReplyState, replyToReview, EMRReplyError } from '../services/embedmyreviews.service';
jest.mock('../services/embedmyreviews.service', () => ({
  ...jest.requireActual('../services/embedmyreviews.service'), readReplyState: jest.fn(), replyToReview: jest.fn(),
}));
jest.mock('../services/emr_provisioning', () => ({ getClientEMRKey: jest.fn().mockResolvedValue('fixture') }));

describe('Durable reply publication', () => {
  let token: string, viewerToken: string, clientId: string, locationId: string;
  const emails: string[] = [];
  async function review(externalId: string) {
    const [r] = await db('reviews').insert({ client_id: clientId, location_id: locationId, source: 'emr', platform: 'Google', external_review_id: externalId, rating: 5, body: 'Fixture review' }).returning('*'); return r;
  }
  const publish = (id: string, body: any = { body: 'Approved fixture reply' }) => request(app).post(`/api/reviews/${id}/publish`).set('Authorization', `Bearer ${token}`).send(body);
  beforeAll(async () => {
    const email = `reply-${Date.now()}@example.com`; emails.push(email);
    await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Reply fixture' });
    const user = await db('users').where({ email }).first(); const c = await db('clients').where({ user_id: user.id }).first(); clientId = c.id;
    token = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
    await db('clients').where({ id: clientId }).update({ emr_organization_id: 886600, emr_location_id: 886601 });
    const [l] = await db('locations').insert({ client_id: clientId, name: 'Reply fixture' }).returning('id'); locationId = l.id;
    const viewerEmail = `reply-viewer-${Date.now()}@example.com`; emails.push(viewerEmail);
    await request(app).post('/api/auth/register').send({ email: viewerEmail, password: 'Password123!', businessName: 'Viewer fixture' });
    const viewer = await db('users').where({ email: viewerEmail }).first();
    viewerToken = (await request(app).post('/api/auth/login').send({ email: viewerEmail, password: 'Password123!' })).body.data.accessToken;
    await db('clients').where({ user_id: viewer.id }).delete();
    await db('team_members').insert({ client_id: clientId, user_id: viewer.id, email: viewerEmail, role: 'viewer', accepted_at: new Date() });
  });
  afterAll(async () => { await db('users').whereIn('email', emails).del(); });
  beforeEach(() => {
    jest.clearAllMocks();
    (readReplyState as jest.Mock).mockImplementation(async (_key, id) => ({ id, organizationId: '886600', locationId: '886601', source: 'Google', reply: null, replyDate: null }));
    (replyToReview as jest.Mock).mockResolvedValue(undefined);
  });
  it('keeps viewer accounts read-only for reply mutations', async () => {
    const r = await review('reply-viewer');
    for (const path of ['publish','reconcile','response/draft']) expect((await request(app).post(`/api/reviews/${r.id}/${path}`).set('Authorization', `Bearer ${viewerToken}`).send({ body: 'No permission' })).status).toBe(403);
    expect((await request(app).patch(`/api/reviews/${r.id}/response`).set('Authorization', `Bearer ${viewerToken}`).send({ approve: true })).status).toBe(403);
    expect(replyToReview).not.toHaveBeenCalled();
  });
  it('requires explicit text, checks upstream identity and commits publishing before the external call', async () => {
    const r = await review('reply-approved');
    await db('review_responses').insert({ client_id: clientId, review_id: r.id, draft_body: 'Unapproved AI draft' });
    expect((await publish(r.id, {})).status).toBe(422); expect(replyToReview).not.toHaveBeenCalled();
    (replyToReview as jest.Mock).mockImplementation(async () => {
      const saved = await db('review_responses').where({ review_id: r.id }).first(); expect(saved.status).toBe('publishing'); expect(saved.final_body).toBe('Approved fixture reply'); expect(saved.approved_at).not.toBeNull();
    });
    expect((await publish(r.id)).status).toBe(200); expect(replyToReview).toHaveBeenCalledTimes(1);
    expect((await db('review_responses').where({ review_id: r.id }).first()).status).toBe('posted');
    expect((await publish(r.id)).status).toBe(409); expect(replyToReview).toHaveBeenCalledTimes(1);
  });
  it('prevents concurrent duplicate sends', async () => {
    const r = await review('reply-concurrent');
    const results = await Promise.all([publish(r.id), publish(r.id)]);
    expect(results.map(r => r.status).sort()).toEqual([200,409]); expect(replyToReview).toHaveBeenCalledTimes(1);
  });
  it('freezes a timeout and reconciles without any retry of the public write', async () => {
    const r = await review('reply-timeout');
    (replyToReview as jest.Mock).mockRejectedValue(new Error('Timeout'));
    expect((await publish(r.id)).status).toBe(409);
    expect((await db('review_responses').where({ review_id: r.id }).first()).status).toBe('uncertain');
    expect((await publish(r.id)).status).toBe(409);
    const check = () => request(app).post(`/api/reviews/${r.id}/reconcile`).set('Authorization', `Bearer ${token}`);
    expect((await check()).body.data).toMatchObject({ published: false, retryAllowed: false });
    expect((await request(app).patch(`/api/reviews/${r.id}/response`).set('Authorization', `Bearer ${token}`).send({ body: 'Changed' })).status).toBe(409);
    (readReplyState as jest.Mock).mockResolvedValue({ id: r.external_review_id, organizationId: '886600', locationId: '886601', source: 'Google', reply: 'Approved fixture reply', replyDate: new Date('2026-09-01') });
    expect((await check()).body.data.published).toBe(true); expect(replyToReview).toHaveBeenCalledTimes(1);
    expect((await db('review_responses').where({ review_id: r.id }).first()).status).toBe('posted');
  });
  it('does not overwrite an existing upstream reply or a foreign provider review', async () => {
    const r = await review('reply-existing');
    (readReplyState as jest.Mock).mockResolvedValue({ id: r.external_review_id, organizationId: '886600', locationId: '886601', source: 'Google', reply: 'Existing vendor reply', replyDate: null });
    expect((await publish(r.id)).status).toBe(200); expect(replyToReview).not.toHaveBeenCalled();
    expect((await db('review_responses').where({ review_id: r.id }).first()).status).toBe('reply_conflict');
    const foreign = await review('reply-foreign');
    (readReplyState as jest.Mock).mockResolvedValue({ id: foreign.external_review_id, organizationId: '99999', locationId: '886601', source: 'Google', reply: null });
    expect((await publish(foreign.id)).status).toBe(409); expect(replyToReview).not.toHaveBeenCalled();
  });
  it('allows a deliberate retry after a confirmed rejection and resets approval after edits', async () => {
    const r = await review('reply-refused');
    (replyToReview as jest.Mock).mockRejectedValueOnce(new EMRReplyError('Unsupported',403,'REPLY_SOURCE_UNSUPPORTED'));
    expect((await publish(r.id)).status).toBe(403);
    expect((await db('review_responses').where({ review_id: r.id }).first()).status).toBe('failed');
    await request(app).patch(`/api/reviews/${r.id}/response`).set('Authorization', `Bearer ${token}`).send({ approve: true });
    const edit = await request(app).patch(`/api/reviews/${r.id}/response`).set('Authorization', `Bearer ${token}`).send({ body: 'New wording' });
    expect(edit.body.data.status).toBe('draft'); expect(edit.body.data.approvedAt).toBeNull();
    expect((await publish(r.id, {body:'New wording'})).status).toBe(200);
  });
});
