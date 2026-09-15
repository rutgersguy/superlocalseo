import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { config } from '../config';
import { fetchPublicWebsite } from '../services/public_website_fetch';
import { pollWebsiteCrawls, summarizeCrawl, crawlPageLimit } from '../services/website_crawl.service';
jest.mock('../services/public_website_fetch', () => ({ fetchPublicWebsite: jest.fn() }));
const email = `website-crawl-${Date.now()}@example.com`;
const page = { resource_type: 'html', url: 'https://crawl.example/services', meta: { title: 'Services' }, status_code: 200, duplicate_title: true, checks: { no_description: true, no_h1_tag: false } };
describe('expanded website crawl lifecycle', () => {
  let clientId: string, locationId: string, auditId: string, token: string;
  let fetchMock: jest.SpyInstance;
  let finished = false;
  let empty = false;
  beforeAll(async () => {
    Object.assign(config.dataforseo, { login: 'crawler-test', password: 'crawler-test' });
    await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Crawl fixture' });
    const user = await db('users').where({ email }).first();
    clientId = (await db('clients').where({ user_id: user.id }).first()).id;
    token = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
    locationId = (await db('locations').insert({ client_id: clientId, name: 'Crawl fixture', website: 'https://crawl.example' }).returning('id'))[0].id;
    fetchMock = jest.spyOn(global, 'fetch');
    // This suite owns only its new audits. Existing fixture audits are not enrolled.
    await db('location_audits').where({ crawl_status: 'queued' }).update({ crawl_status: null });
  });
  beforeEach(async () => {
    finished = false; empty = false; fetchMock.mockReset();
    await db('location_audits').where({ client_id: clientId }).delete();
    await db('clients').where({ id: clientId }).update({ subscription_status: 'active', product_line: 'pro' });
    auditId = (await db('location_audits').insert({ client_id: clientId, location_id: locationId, status: 'complete' }).returning('id'))[0].id;
    (fetchPublicWebsite as jest.Mock).mockResolvedValue({ ok: true, url: 'https://crawl.example/', text: async () => '' });
    fetchMock.mockImplementation(async (input: string) => ({ ok: true, json: async () => ({ status_code: 20000, tasks: [input.endsWith('task_post')
      ? { status_code: 20100, id: 'crawl-task' }
      : { status_code: 20000, result: [input.includes('/summary/') ? { crawl_progress: finished ? 'finished' : 'in_progress', crawl_status: { pages_crawled: 1, pages_in_queue: 0 } } : { items: empty ? null : [page], total_items_count: empty ? 0 : 1 }] }] }) }));
  });
  afterAll(async () => { fetchMock.mockRestore(); await db('users').where({ email }).delete(); });
  it('submits once under concurrent polling and retains actionable observations', async () => {
    await Promise.all([pollWebsiteCrawls(), pollWebsiteCrawls()]);
    expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('task_post'))).toHaveLength(1);
    expect((await db('location_audits').where({ id: auditId }).first()).crawl_status).toBe('running');
    finished = true; await pollWebsiteCrawls();
    const audit = await db('location_audits').where({ id: auditId }).first();
    expect(audit.crawl_status).toBe('complete');
    expect(audit.crawl_data.checks.find((c: any) => c.key === 'no_description')).toMatchObject({ affectedPages: 1, urls: [page.url] });
    expect(audit.crawl_data.checks.find((c: any) => c.key === 'no_description').fix).toContain('CMS');
    expect(audit.crawl_data.checks.find((c: any) => c.key === 'no_h1_tag').affectedPages).toBe(0);
    expect(audit.crawl_data.checks.find((c: any) => c.key === 'no_title').testedPages).toBe(0);
  });
  it('reuses a recent crawl across audits without a second paid task', async () => {
    finished = true; await pollWebsiteCrawls();
    // Old accepted tasks may retain tracking parameters; normalization must not buy a duplicate.
    await db('location_audits').where({ id: auditId }).update({ crawl_url: 'https://crawl.example/?utm_source=old' });
    await db('location_audits').insert({ client_id: clientId, location_id: locationId, status: 'complete' });
    await pollWebsiteCrawls();
    expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('task_post'))).toHaveLength(1);
  });
  it('saves tenant scope without buying or resetting a crawl', async () => {
    expect((await request(app).put(`/api/audits/bl/${auditId}/crawl-scope`).set('Authorization', `Bearer ${token}`).send({ scope: 'section' })).status).toBe(200);
    expect((await db('locations').where({ id: locationId }).first()).website_crawl_scope).toBe('section');
    expect((await request(app).get(`/api/audits/bl/${auditId}/crawl-scope`).set('Authorization', `Bearer ${token}`)).body.data.scope).toBe('section');
    expect((await request(app).put(`/api/audits/bl/${auditId}/crawl-scope`).set('Authorization', `Bearer ${token}`).send({ scope: 'invalid' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await db('locations').where({ id: locationId }).update({ website_crawl_scope: 'auto' });
  });
  it('sends and persists the actual limits in the provider request', async () => {
    await pollWebsiteCrawls();
    const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('task_post'))!;
    expect(JSON.parse(call[1].body)[0]).toMatchObject({ max_crawl_pages: 25, max_crawl_depth: 3, respect_sitemap: false });
    expect((await db('location_audits').where({ id: auditId }).first()).crawl_data.policy.pageLimit).toBe(25);
  });
  it('holds uncertain paid submissions instead of retrying', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure after sending'));
    await pollWebsiteCrawls(); await pollWebsiteCrawls();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db('location_audits').where({ id: auditId }).first()).crawl_status).toBe('needs_review');
  });
  it('does not purchase for unreachable or private destinations', async () => {
    (fetchPublicWebsite as jest.Mock).mockRejectedValue(new Error('Private website destination'));
    await pollWebsiteCrawls(); expect(fetchMock).not.toHaveBeenCalled();
    expect((await db('location_audits').where({ id: auditId }).first()).crawl_status).toBe('unavailable');
  });
  it('does not turn an empty result into a clean audit', async () => {
    finished = true; empty = true; await pollWebsiteCrawls();
    expect((await db('location_audits').where({ id: auditId }).first()).crawl_status).toBe('unavailable');
  });
  it('does not automatically enroll historical audits', async () => {
    await db('location_audits').where({ id: auditId }).update({ crawl_status: null });
    await pollWebsiteCrawls(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('enforces tenant ownership when requesting expanded checks', async () => {
    const response = await request(app).post('/api/audits/bl/00000000-0000-4000-8000-000000000001/crawl').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('caps websites at 25 pages and defaults saved paths to one page', () => {
    expect(crawlPageLimit('https://shared.example/tulsa/')).toBe(1);
    expect(crawlPageLimit('https://business.example/')).toBe(25);
  });
  it('keeps missing metrics null and excludes resources from page checks', () => {
    const result = summarizeCrawl({}, [page, { resource_type: 'image', checks: { no_description: true } }], 'https://crawl.example');
    expect(result.pagesCrawled).toBeNull(); expect(result.pagesReturned).toBe(1);
    expect(result.checks.find(c => c.key === 'no_description')?.affectedPages).toBe(1);
  });
});
