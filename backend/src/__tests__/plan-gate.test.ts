/**
 * Plan gate tests — requireProPlan middleware + isPlanAllowed() capability map.
 * Verifies: Lite is blocked from Pro routes, Pro passes, the central map is correct.
 * Uses the real DB (Postgres test DB via knex test config).
 */
import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { isPlanAllowed } from '../config/planFeatures';

async function registerAndLogin(email: string): Promise<string> {
  await request(app).post('/api/auth/register').send({
    email, password: 'Password123!', businessName: 'Test Business',
  });
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  return (login.body as { data?: { accessToken?: string } }).data?.accessToken ?? '';
}

async function setProductLine(email: string, plan: 'lite' | 'pro') {
  const user = await db('users').where({ email }).first();
  if (!user) return;
  // enforcePlanGate runs requireClient (billing check) BEFORE requireProPlan, so set
  // status 'active' too — otherwise a Lite route could 402 (billing) before the 403 (gate).
  await db('clients')
    .where({ user_id: user.id })
    .update({ product_line: plan, subscription_status: 'active' });
}

describe('Plan gate — requireProPlan middleware', () => {
  let liteToken: string;
  let proToken: string;

  beforeAll(async () => {
    liteToken = await registerAndLogin('lite-user@example.com');
    proToken = await registerAndLogin('pro-user@example.com');
    await setProductLine('lite-user@example.com', 'lite');
    await setProductLine('pro-user@example.com', 'pro');
  });

  describe('Lite client — Pro-only routes return 403 with PRO_REQUIRED', () => {
    const proOnlyRoutes = [
      ['GET', '/api/citations'],
      ['GET', '/api/geo-grid'],
      ['GET', '/api/audits/bl'],
      ['GET', '/api/reputation'],
      ['GET', '/api/team'],
      ['GET', '/api/qr'],
      ['GET', '/api/competitors/gap'],
      ['GET', '/api/analytics/rankings'],
      ['GET', '/api/rankings/export'],
    ] as const;

    for (const [method, path] of proOnlyRoutes) {
      it(`${method} ${path} → 403`, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (request(app) as any)[method.toLowerCase()](path)
          .set('Authorization', `Bearer ${liteToken}`) as request.Response;
        expect(res.status).toBe(403);
        expect((res.body as { error?: { code?: string } }).error?.code).toBe('PRO_REQUIRED');
      });
    }
  });

  describe('Lite client — Lite-accessible routes do not return 403', () => {
    const liteAllowedRoutes = [
      ['GET', '/api/reviews'],
      ['GET', '/api/rankings'],
      ['GET', '/api/campaigns'],
      ['GET', '/api/competitors'], // base list is allowed (teaser)
      ['GET', '/api/reports'],
    ] as const;

    for (const [method, path] of liteAllowedRoutes) {
      it(`${method} ${path} → not 403`, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (request(app) as any)[method.toLowerCase()](path)
          .set('Authorization', `Bearer ${liteToken}`) as request.Response;
        expect(res.status).not.toBe(403);
      });
    }
  });

  describe('Pro client — all routes pass the gate', () => {
    const proRoutes = [
      ['GET', '/api/citations'],
      ['GET', '/api/competitors/gap'],
      ['GET', '/api/team'],
    ] as const;

    for (const [method, path] of proRoutes) {
      it(`${method} ${path} → not 403`, async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (request(app) as any)[method.toLowerCase()](path)
          .set('Authorization', `Bearer ${proToken}`) as request.Response;
        expect(res.status).not.toBe(403);
      });
    }
  });

  describe('isPlanAllowed() unit tests', () => {
    it('pro always returns true', () => {
      expect(isPlanAllowed('citations', 'pro')).toBe(true);
      expect(isPlanAllowed('geo-grid', 'pro')).toBe(true);
      expect(isPlanAllowed('competitors/gap', 'pro')).toBe(true);
    });

    it('lite blocked from Pro-only routes', () => {
      expect(isPlanAllowed('citations', 'lite')).toBe(false);
      expect(isPlanAllowed('geo-grid', 'lite')).toBe(false);
      expect(isPlanAllowed('competitors/gap', 'lite')).toBe(false);
      expect(isPlanAllowed('analytics/rankings', 'lite')).toBe(false);
      expect(isPlanAllowed('competitors/__create__', 'lite')).toBe(false);
      expect(isPlanAllowed('team', 'lite')).toBe(false);
      expect(isPlanAllowed('qr', 'lite')).toBe(false);
    });

    it('lite allowed on Lite-accessible routes', () => {
      expect(isPlanAllowed('competitors', 'lite')).toBe(true); // base list
      expect(isPlanAllowed('reviews', 'lite')).toBe(true);
      expect(isPlanAllowed('rankings', 'lite')).toBe(true);
      expect(isPlanAllowed('analytics/reviews/trend', 'lite')).toBe(true);
    });

    it('unlisted route returns true (auth/billing/public)', () => {
      expect(isPlanAllowed('auth/login', 'lite')).toBe(true);
      expect(isPlanAllowed('billing/status', 'lite')).toBe(true);
    });
  });
});
