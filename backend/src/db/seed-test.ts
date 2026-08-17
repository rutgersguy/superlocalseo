/**
 * Fixture seeder for the isolated test stack (issue #159).
 *
 *   docker compose -f docker-compose.test.yml exec api node dist/db/seed-test.js
 *
 * Idempotent: it deletes every fixture user first, and everything cascades from
 * `users`, so re-running gives a clean, identical dataset.
 *
 * REFUSES TO RUN outside the test stack. It is destructive by design, and the
 * one thing that must never happen is someone running it against production —
 * so it checks NODE_ENV and the database name before touching anything.
 *
 * Why fixtures with real data matter: Reviews and Campaigns coverage has been
 * blocked because no account on this host has any. docs/FRONTEND_TEST_SUITE.md
 * marks 7+ cases "needs seed" and they have stayed BLOCKED ever since.
 */
import bcrypt from 'bcryptjs';
import { db } from './connection';
import { config } from '../config';
import { logger } from '../utils/logger';

const PASSWORD = 'TestPass123!';
const SALT_ROUNDS = 10;

/** Every fixture account shares this suffix so cleanup is unambiguous. */
const DOMAIN = '@fixture.test';

interface Fixture {
  email: string;
  role: 'admin' | 'client';
  businessName: string;
  productLine: 'lite' | 'pro';
  status: 'trialing' | 'active';
  onboardingStep: number;
  emailVerified: boolean;
  withData: boolean;
}

const FIXTURES: Fixture[] = [
  { email: `admin${DOMAIN}`,     role: 'admin',  businessName: 'Fixture Admin',   productLine: 'pro',  status: 'active',   onboardingStep: 5, emailVerified: true,  withData: false },
  { email: `pro${DOMAIN}`,       role: 'client', businessName: 'Fixture Pro Co',  productLine: 'pro',  status: 'active',   onboardingStep: 5, emailVerified: true,  withData: true  },
  { email: `lite${DOMAIN}`,      role: 'client', businessName: 'Fixture Lite Co', productLine: 'lite', status: 'active',   onboardingStep: 5, emailVerified: true,  withData: true  },
  { email: `trialing${DOMAIN}`,  role: 'client', businessName: 'Fixture Trial Co',productLine: 'pro',  status: 'trialing', onboardingStep: 5, emailVerified: true,  withData: false },
  // The most valuable fixture: a brand-new account. Every value is null or
  // empty, which is the least-tested state in this codebase and the one that
  // produced seven separate blank-screen regressions.
  { email: `newuser${DOMAIN}`,   role: 'client', businessName: 'Fixture New Co',  productLine: 'pro',  status: 'trialing', onboardingStep: 0, emailVerified: false, withData: false },
];

function assertSafeToRun(): void {
  const dbName = (config.db.url.split('/').pop() ?? '').split('?')[0];
  if (process.env.NODE_ENV !== 'test' || !dbName.includes('test')) {
    throw new Error(
      'seed-test refuses to run outside the test stack. '
      + `NODE_ENV=${process.env.NODE_ENV ?? '(unset)'} database=${dbName}. `
      + 'It is destructive; run it only against docker-compose.test.yml.',
    );
  }
}

async function seedClientData(clientId: string, businessName: string): Promise<void> {
  const [location] = await db('locations')
    .insert({
      client_id: clientId,
      name: `${businessName} — Main`,
      address: '4517 S Sheridan Rd',
      city: 'Tulsa',
      state: 'OK',
      zip: '74145',
      phone: '+19185550100',
      lat: 36.0975,
      lng: -95.9022,
      google_place_id: `ChIJfixture${clientId.slice(0, 8)}`,
      is_primary: true,
      service_area: JSON.stringify(['Tulsa, OK', 'Broken Arrow, OK']),
    })
    .returning('id');
  const locationId = (location as { id: string }).id;

  const keywords = ['emergency plumber tulsa', 'water heater repair tulsa', 'drain cleaning tulsa'];
  const keywordIds: string[] = [];
  for (const keyword of keywords) {
    const [k] = await db('keywords').insert({ location_id: locationId, keyword, monthly_search_volume: 1600 }).returning('id');
    keywordIds.push((k as { id: string }).id);
  }

  // Rankings across two engines and both rank types, including a deliberate
  // NULL — unranked is the case that broke Avg Rank, "In Top 3" (null <= 3 is
  // true in JS) and table sorting.
  const now = Date.now();
  const rows: Record<string, unknown>[] = [];
  keywordIds.forEach((keywordId, i) => {
    for (let daysAgo = 30; daysAgo >= 0; daysAgo -= 10) {
      rows.push({
        keyword_id: keywordId, location_id: locationId,
        rank: i === 2 ? null : i + 2 + Math.floor(daysAgo / 10),
        search_engine: 'google', rank_type: 'organic',
        pulled_at: new Date(now - daysAgo * 86_400_000),
      });
      rows.push({
        keyword_id: keywordId, location_id: locationId,
        rank: i === 2 ? null : i + 1,
        search_engine: 'google', rank_type: 'local_pack',
        pulled_at: new Date(now - daysAgo * 86_400_000),
      });
    }
  });
  await db('ranking_snapshots').insert(rows);

  // Reviews — the dataset that has never existed on this host, which is why the
  // Reviews suite could only ever assert empty states.
  await db('reviews').insert([1, 2, 3, 4, 5].map((n) => ({
    client_id: clientId,
    location_id: locationId,
    platform: 'Google',
    external_review_id: `fixture-review-${clientId.slice(0, 8)}-${n}`,
    author_name: `Fixture Reviewer ${n}`,
    rating: n <= 3 ? 5 : 4,
    body: `Fixture review ${n} — seeded so the Reviews page has something to render.`,
    status: n === 1 ? 'new' : 'responded',
    review_date: new Date(now - n * 5 * 86_400_000),
    ingested_at: new Date(),
    replied: n > 3,
    source: 'emr',
  })));

  await db('private_feedback').insert({
    client_id: clientId,
    emr_feedback_id: `fixture-feedback-${clientId.slice(0, 8)}`,
    contact_name: 'Unhappy Fixture Customer',
    contact_email: 'unhappy@fixture.test',
    rating: 2,
    message: 'Seeded private feedback so the Private Feedback tab is not empty.',
    received_at: new Date(now - 2 * 86_400_000),
  });

  await db('emr_campaigns').insert({
    client_id: clientId,
    emr_campaign_id: `fixture-campaign-${clientId.slice(0, 8)}`,
    name: 'Post-visit review request',
    invited: 120, opened: 78, clicked: 41, reviewed: 22, private_feedback: 3, unsubscribed: 2,
    metrics_pulled_at: new Date(),
  });

  await db('citation_snapshots').insert(
    ['google', 'yelp', 'facebook', 'bing', 'apple'].map((directory, i) => ({
      location_id: locationId,
      directory,
      listed: i < 4,
      nap_match: i < 3,
      pulled_at: new Date(now - 86_400_000),
    })),
  );
}

async function main(): Promise<void> {
  assertSafeToRun();

  const deleted = await db('users').where('email', 'like', `%${DOMAIN}`).del();
  logger.info('Cleared previous fixtures', { deleted });

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  for (const f of FIXTURES) {
    const [user] = await db('users')
      .insert({ email: f.email, password_hash: passwordHash, role: f.role, email_verified: f.emailVerified })
      .returning('id');
    const userId = (user as { id: string }).id;

    const [client] = await db('clients')
      .insert({
        user_id: userId,
        business_name: f.businessName,
        industry: 'plumbing',
        product_line: f.productLine,
        subscription_status: f.status,
        onboarding_step: f.onboardingStep,
        trial_ends_at: new Date(Date.now() + 7 * 86_400_000),
        locations_limit: 1,
      })
      .returning('id');
    const clientId = (client as { id: string }).id;

    if (f.withData) await seedClientData(clientId, f.businessName);
    logger.info('Seeded fixture', { email: f.email, plan: f.productLine, status: f.status, withData: f.withData });
  }

  logger.info(`Seeded ${FIXTURES.length} fixtures. Password for all: ${PASSWORD}`);
}

main()
  .then(async () => { await db.destroy(); process.exit(0); })
  .catch(async (err) => {
    logger.error('Seeding failed', { error: err instanceof Error ? err.message : String(err) });
    await db.destroy();
    process.exit(1);
  });
