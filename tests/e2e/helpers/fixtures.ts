import { Page, expect } from '@playwright/test';
import { uniqueEmail, registerViaAPI } from './auth';
import { dbQuery, dbScalar } from './db';

export const TEST_PASSWORD = 'TestPass123!';

export interface TestClient {
  email: string;
  password: string;
  businessName: string;
}

interface ClientOpts {
  /** Defaults to 'pro' — a fresh signup is Pro because trials run with full Pro access. */
  plan?: 'lite' | 'pro';
  /** Defaults to 'trialing' — matches a real new signup. */
  status?: 'trialing' | 'active' | 'past_due' | 'canceled';
  /**
   * 0 = brand new, will be bounced to /onboarding.
   * 4 = finished the wizard.
   * 5 = used by suite 08 to mean "onboarded, don't redirect".
   */
  onboardingStep?: number;
  /** Defaults to true so the verify-email nudge doesn't interfere with assertions. */
  verified?: boolean;
  businessName?: string;
}

/**
 * Registers a client through the real API, then forces its plan/subscription state
 * via SQL. Forcing is necessary because product_line only flips on a paid Stripe
 * invoice, and the Stripe webhook cannot currently be delivered at all
 * (signature verification fails — see the QA plan, GT-03).
 */
export async function createTestClient(opts: ClientOpts = {}): Promise<TestClient> {
  const {
    plan = 'pro',
    status = 'trialing',
    onboardingStep = 4,
    verified = true,
    businessName = 'Zero Data Co',
  } = opts;

  const email = uniqueEmail();
  await registerViaAPI(email, TEST_PASSWORD, businessName);

  if (verified) {
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
  }
  dbQuery(`
    UPDATE clients
    SET product_line = '${plan}',
        subscription_status = '${status}',
        onboarding_step = ${onboardingStep},
        trial_ends_at = NOW() + INTERVAL '7 days'
    WHERE user_id = (SELECT id FROM users WHERE email = '${email}')
  `);

  return { email, password: TEST_PASSWORD, businessName };
}

export function clientIdFor(email: string): string {
  const id = dbScalar(
    `SELECT id FROM clients WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`
  );
  if (!id) throw new Error(`No client row for ${email}`);
  return id;
}

/** Inserts a location directly. Returns its uuid. */
export function seedLocation(
  email: string,
  loc: { name: string; city?: string; state?: string; lat?: number | null; lng?: number | null }
): string {
  const clientId = clientIdFor(email);
  const lat = loc.lat == null ? 'NULL' : String(loc.lat);
  const lng = loc.lng == null ? 'NULL' : String(loc.lng);
  return dbScalar(`
    INSERT INTO locations (client_id, name, address, city, state, lat, lng, is_primary)
    VALUES ('${clientId}', '${loc.name}', '123 Test St', '${loc.city ?? 'Tulsa'}',
            '${loc.state ?? 'OK'}', ${lat}, ${lng}, true)
    RETURNING id
  `);
}

/** Inserts a keyword against a location. Returns its uuid. */
export function seedKeyword(locationId: string, keyword: string): string {
  return dbScalar(`
    INSERT INTO keywords (location_id, keyword) VALUES ('${locationId}', '${keyword}')
    RETURNING id
  `);
}

/**
 * Inserts a ranking snapshot. `rank` may be null to represent an unranked result —
 * which is the case that historically broke Avg Rank, "In Top 3" (null <= 3 is true
 * in JS) and table sorting (?? 0 floated nulls to the top).
 */
export function seedRankingSnapshot(opts: {
  keywordId: string;
  locationId: string;
  rank: number | null;
  searchEngine?: string;
  rankType?: 'organic' | 'local_pack' | 'paid';
}): void {
  const rank = opts.rank == null ? 'NULL' : String(opts.rank);
  dbQuery(`
    INSERT INTO ranking_snapshots (keyword_id, location_id, rank, search_engine, rank_type, pulled_at)
    VALUES ('${opts.keywordId}', '${opts.locationId}', ${rank},
            '${opts.searchEngine ?? 'google'}', '${opts.rankType ?? 'organic'}', NOW())
  `);
}

/**
 * Captures uncaught exceptions and console errors for a page.
 *
 * `pageErrors` is the signal that matters: an uncaught exception in React unmounts
 * the tree and renders a blank screen. That is exactly how `.toFixed()` on a null
 * avgRank (commit 1c4b4ef) and a decimal-as-string audit score (8e098ad) presented
 * to users — a white page, no message.
 */
export function watchPageErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Third-party noise the app does not control.
    if (/crisp\.chat|favicon|tile\.openstreetmap|js\.stripe\.com|ERR_BLOCKED_BY_CLIENT/i.test(text)) return;
    consoleErrors.push(text);
  });

  return {
    pageErrors,
    consoleErrors,
    /** Fails only on uncaught exceptions; console errors are reported for triage. */
    assertNoCrash(context: string) {
      expect(pageErrors, `${context} — uncaught exception(s):\n${pageErrors.join('\n')}`).toEqual([]);
    },
  };
}

/**
 * Asserts a page actually rendered rather than crashing to the ErrorBoundary or a
 * blank body. Deliberately stricter than the existing 06-dashboard checks, which
 * only assert `body.innerText.length > 50` — a bar that an error string clears.
 */
export async function assertRendered(page: Page, headingPattern: RegExp): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Something went wrong' })
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: headingPattern }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Inserts a location_audit in a given state.
 *
 * `createdAt` is offset in hours so tests can place an audit inside or outside
 * the 24h throttle and the 30-minute stale-processing cutoff.
 */
export function seedAudit(opts: {
  email: string;
  locationId: string;
  status: 'processing' | 'failed' | 'complete';
  hoursAgo?: number;
}): string {
  const clientId = clientIdFor(opts.email);
  const hours = opts.hoursAgo ?? 0;
  const score = opts.status === 'complete' ? '72' : 'NULL';
  return dbScalar(`
    INSERT INTO location_audits (client_id, location_id, status, composite_score, created_at, updated_at)
    VALUES ('${clientId}', '${opts.locationId}', '${opts.status}', ${score},
            NOW() - INTERVAL '${hours} hours', NOW() - INTERVAL '${hours} hours')
    RETURNING id
  `);
}
