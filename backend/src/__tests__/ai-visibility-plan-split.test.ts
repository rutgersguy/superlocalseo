/**
 * AI visibility is the first surface where BOTH plans call the same endpoint and
 * the PAYLOAD differs. That is a new shape of gate for this codebase, and the
 * old shape has failed repeatedly: #157 found four Pro-marketed surfaces
 * rendering for Lite, two of which actually worked rather than 403'ing, because
 * only the frontend knew about the gate.
 *
 * So these tests assert the depth is genuinely ABSENT from the Lite response —
 * not merely unrendered — and that the verdict Lite converted on is still there.
 *
 * The verdict must stay Lite-inclusive: docs/POSITIONING.md makes AI visibility
 * the landing page's lead claim, and paywalling the answer would sell Lite a
 * promise it cannot open.
 */
import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';

const LITE = 'aivis-lite@example.com';
const PRO = 'aivis-pro@example.com';

async function registerAndLogin(email: string): Promise<string> {
  await request(app).post('/api/auth/register').send({
    email, password: 'Password123!', businessName: 'Aivis Test Co',
  });
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  return (login.body as { data?: { accessToken?: string } }).data?.accessToken ?? '';
}

async function seedFor(email: string, plan: 'lite' | 'pro'): Promise<string> {
  const user = await db('users').where({ email }).first();
  const client = await db('clients').where({ user_id: user.id }).first();
  await db('clients').where({ id: client.id }).update({
    product_line: plan,
    subscription_status: 'active',
    industry: 'HVAC',
  });
  // Platform admins bypass the plan gate entirely (requireProPlan), which would
  // make a Lite assertion vacuous.
  await db('users').where({ id: user.id }).update({ role: 'client' });

  const [loc] = await db('locations')
    .insert({ client_id: client.id, name: 'Aivis Test Co', city: 'Bixby', state: 'OK' })
    .returning('id');
  const locationId = typeof loc === 'string' ? loc : loc.id;

  await db('ai_visibility_snapshots').insert([
    {
      location_id: locationId, prompt_key: 'best_open',
      prompt_text: 'Who are the best HVAC companies in Bixby, OK?',
      engine: 'chat_gpt', model_name: 'gpt-5.5', status: 'mentioned', position: 2,
      businesses_named: JSON.stringify(['JayCo HVACR', 'Aivis Test Co']),
      citations: JSON.stringify(['bbb.org', 'yelp.com']),
      response_text: 'The full answer text that only Pro may read.',
      scanned_at: new Date(),
    },
    {
      location_id: locationId, prompt_key: 'best_open',
      prompt_text: 'Who are the best HVAC companies in Bixby, OK?',
      engine: 'gemini', model_name: 'gemini-3.5-flash', status: 'unverified',
      unverified_reason: 'assistant unavailable: task status 40102',
      businesses_named: JSON.stringify([]), citations: JSON.stringify([]),
      scanned_at: new Date(),
    },
    {
      location_id: locationId, prompt_key: 'best_open',
      prompt_text: 'Who are the best HVAC companies in Bixby, OK?',
      engine: 'perplexity', model_name: 'sonar', status: 'absent',
      businesses_named: JSON.stringify(['York Plumbing']),
      citations: JSON.stringify(['angi.com']),
      response_text: 'Other businesses entirely.',
      scanned_at: new Date(),
    },
  ]);

  return locationId;
}

describe('AI visibility — plan split', () => {
  let liteToken: string;
  let proToken: string;

  beforeAll(async () => {
    liteToken = await registerAndLogin(LITE);
    proToken = await registerAndLogin(PRO);
    await seedFor(LITE, 'lite');
    await seedFor(PRO, 'pro');
  });

  it('gives Lite the verdict it converted on', async () => {
    const res = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${liteToken}`);
    expect(res.status).toBe(200);

    const d = res.body.data;
    expect(d.plan).toBe('lite');
    const result = d.prompts[0].results.find((r: { engine: string }) => r.engine === 'chat_gpt');
    expect(result.status).toBe('mentioned');
    expect(result.position).toBe(2);
    expect(d.engines.find((e: { engine: string }) => e.engine === 'chat_gpt').mentioned).toBe(1);
  });

  it('withholds the depth from Lite in the PAYLOAD, not just the UI', async () => {
    const res = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${liteToken}`);
    const d = res.body.data;

    expect(d.history).toBeUndefined();
    expect(d.topCompetitors).toBeUndefined();
    expect(d.topSources).toBeUndefined();

    for (const p of d.prompts) {
      for (const r of p.results) {
        expect(r.businessesNamed).toBeUndefined();
        expect(r.citations).toBeUndefined();
      }
    }
    // Nothing anywhere in the serialised body should carry a competitor name.
    expect(JSON.stringify(d)).not.toContain('JayCo');
  });

  it('gives Pro the depth', async () => {
    const res = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${proToken}`);
    const d = res.body.data;

    expect(d.plan).toBe('pro');
    expect(Array.isArray(d.history)).toBe(true);
    expect(d.topCompetitors.length).toBeGreaterThan(0);
    expect(d.topSources.length).toBeGreaterThan(0);

    const result = d.prompts[0].results.find((r: { engine: string }) => r.engine === 'chat_gpt');
    expect(result.businessesNamed).toContain('JayCo HVACR');
    expect(result.citations).toContain('bbb.org');
  });

  it('excludes unverified checks from the recommendation rate', async () => {
    // Seeded: 1 mentioned, 1 absent, 1 unverified. Counting the unverified check
    // as a miss would report 33% and let an upstream outage read to the customer
    // as a drop in their visibility. Over determinate checks only it is 50%.
    const res = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${proToken}`);
    const d = res.body.data;

    expect(d.mentionRate).toBe(50);
    const gemini = d.engines.find((e: { engine: string }) => e.engine === 'gemini');
    expect(gemini.unverified).toBe(1);
    expect(gemini.absent).toBe(0);
    expect(gemini.determinate).toBe(0);
  });

  it('never leaks the vendor or its status codes to a customer', async () => {
    // The stored reason names DataForSEO and its task codes, which is right for
    // an operator and wrong for a plumber. It rendered verbatim on the dashboard
    // the first time this page was opened.
    for (const token of [proToken, liteToken]) {
      const res = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${token}`);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('DataForSEO');
      expect(body).not.toContain('dataforseo');
      expect(body).not.toContain('40102');
      expect(body).not.toContain('llm_responses');
    }

    // ...and the translation is actually present and readable.
    const res = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${proToken}`);
    const gemini = res.body.data.prompts[0].results
      .find((r: { engine: string }) => r.engine === 'gemini');
    expect(gemini.unverifiedReason).toMatch(/try again on the next scan/i);
  });

  it('blocks Lite from the stored answer', async () => {
    const res = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${liteToken}`);
    const snapshotId = res.body.data.prompts[0].results[0].snapshotId;

    const answer = await request(app)
      .get(`/api/ai-visibility/answer/${snapshotId}`)
      .set('Authorization', `Bearer ${liteToken}`);

    expect(answer.status).toBe(403);
    expect(answer.body.error.code).toBe('PRO_REQUIRED');
  });

  it('lets Pro read the stored answer', async () => {
    const res = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${proToken}`);
    const snapshotId = res.body.data.prompts[0].results
      .find((r: { engine: string }) => r.engine === 'chat_gpt').snapshotId;

    const answer = await request(app)
      .get(`/api/ai-visibility/answer/${snapshotId}`)
      .set('Authorization', `Bearer ${proToken}`);

    expect(answer.status).toBe(200);
    expect(answer.body.data.responseText).toContain('only Pro may read');
  });

  it("404s on another client's snapshot rather than leaking it", async () => {
    const liteRes = await request(app).get('/api/ai-visibility').set('Authorization', `Bearer ${liteToken}`);
    const othersId = liteRes.body.data.prompts[0].results[0].snapshotId;

    // Pro is entitled to answers — but only its own.
    const answer = await request(app)
      .get(`/api/ai-visibility/answer/${othersId}`)
      .set('Authorization', `Bearer ${proToken}`);

    expect(answer.status).toBe(404);
  });
});
