import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { issueTokens } from '../services/auth.service';

describe('private feedback management authorization and recovery', () => {
  let clientId: string, otherClient: string, feedbackId: string, foreignId: string, token: string, viewerToken: string;
  let ownerId: string, viewerId: string, foreignUser: string, locationId: string;
  const emails = ['owner', 'other', 'viewer'].map(x => `feedback-${x}-${Date.now()}@example.com`);
  beforeAll(async () => {
    for (const email of emails.slice(0, 2)) await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Feedback fixture' });
    ownerId = (await db('users').where({ email: emails[0] }).first()).id;
    foreignUser = (await db('users').where({ email: emails[1] }).first()).id;
    clientId = (await db('clients').where({ user_id: ownerId }).first()).id;
    otherClient = (await db('clients').where({ user_id: foreignUser }).first()).id;
    viewerId = (await db('users').insert({ email: emails[2], role: 'client', password_hash: 'unused-test-hash' }).returning('id'))[0].id;
    await db('team_members').insert({ client_id: clientId, user_id: viewerId, email: emails[2], role: 'viewer', accepted_at: new Date() });
    token = (await issueTokens(ownerId, 'client')).accessToken;
    viewerToken = (await issueTokens(viewerId, 'client')).accessToken;
    locationId = (await db('locations').insert({ client_id: otherClient, name: 'Foreign fixture' }).returning('id'))[0].id;
    feedbackId = (await db('private_feedback').insert({ client_id: clientId, emr_feedback_id: `follow-up-${clientId}`, source: 'emr', contact_email: 'secret@example.com', message: '=HYPERLINK("test")', received_at: new Date() }).returning('id'))[0].id;
    foreignId = (await db('private_feedback').insert({ client_id: otherClient, emr_feedback_id: `follow-up-${otherClient}`, received_at: new Date() }).returning('id'))[0].id;
  });
  afterAll(async () => { await db('users').whereIn('email', emails).delete(); });
  const update = (id: string, body: object, auth = token) => request(app).patch(`/api/reviews/feedback/${id}`).set('Authorization', `Bearer ${auth}`).send(body);
  const body = () => ({ version: 0, status: 'in_progress', assignedUserId: ownerId, notes: 'Internal action' });
  it('requires auth and admin permission for mutation and export', async () => {
    expect((await request(app).get('/api/reviews/feedback/export')).status).toBe(401);
    expect((await update(feedbackId, body(), viewerToken)).status).toBe(403);
    expect((await request(app).get('/api/reviews/feedback/export').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });
  it('rejects foreign rows, foreign locations, foreign and viewer assignment', async () => {
    expect((await update(foreignId, body())).status).toBe(404);
    for (const path of ['/api/reviews/feedback', '/api/reviews/feedback/export']) {
      expect((await request(app).get(`${path}?locationId=${locationId}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
    }
    expect((await update(feedbackId, { ...body(), assignedUserId: foreignUser })).status).toBe(422);
    expect((await update(feedbackId, { ...body(), assignedUserId: viewerId })).status).toBe(422);
  });
  it('saves local follow-up and rejects stale changes without overwriting notes', async () => {
    expect((await update(feedbackId, body())).status).toBe(200);
    expect((await update(feedbackId, { ...body(), notes: 'Stale overwrite' })).status).toBe(409);
    const row = await db('private_feedback').where({ id: feedbackId }).first();
    expect(row).toMatchObject({ follow_up_status: 'in_progress', follow_up_notes: 'Internal action', follow_up_version: 1, assigned_user_id: ownerId });
  });
  it('filters status, explains incomplete coverage and protects notes from viewers', async () => {
    const result = await request(app).get('/api/reviews/feedback?status=in_progress').set('Authorization', `Bearer ${viewerToken}`);
    expect(result.status).toBe(200); expect(result.body.data.total).toBe(1);
    expect(result.body.data).toMatchObject({ canManage: false, assignees: [] });
    expect(result.body.data.coverage).toContain('not backfilled');
    expect(result.body.data.feedback[0]).not.toHaveProperty('notes');
    expect(JSON.stringify(result.body)).not.toContain('secret@example.com');
  });
  it('blocks Lite CSV export while keeping the feedback inbox available', async () => {
    await db('clients').where({ id: clientId }).update({ product_line: 'lite' });
    try {
      expect((await request(app).get('/api/reviews/feedback/export').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect((await request(app).get('/api/reviews/feedback').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    } finally { await db('clients').where({ id: clientId }).update({ product_line: 'pro' }); }
  });
  it('exports only tenant rows with masked contacts and no internal notes', async () => {
    const result = await request(app).get('/api/reviews/feedback/export?status=in_progress').set('Authorization', `Bearer ${token}`);
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.text).toContain(feedbackId); expect(result.text).not.toContain(foreignId);
    expect(result.text).toContain("'=HYPERLINK"); expect(result.text).not.toContain('secret@example.com'); expect(result.text).not.toContain('Internal action');
  });
});
