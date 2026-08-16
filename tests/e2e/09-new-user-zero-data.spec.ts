import { test, expect, Locator, Page } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { cleanupTestUsers, dbQuery } from './helpers/db';
import {
  createTestClient,
  seedLocation,
  seedKeyword,
  seedRankingSnapshot,
  watchPageErrors,
  assertRendered,
  TestClient,
} from './helpers/fixtures';

/**
 * Suite 09 — The zero-data account.
 *
 * WHY THIS SUITE MATTERS MOST
 * ---------------------------
 * A brand-new user is an account where every value is null or empty, and null is
 * the least-tested state in this codebase. Seven separate production defects came
 * from it, and each presented to the user as a blank screen or a silently wrong
 * number during their very first session:
 *
 *   1c4b4ef  .toFixed() on a null avgRank blanked the whole React tree
 *   ec821ad  Reviews called .map() on the {reviews,total,page,pages} envelope
 *   8e098ad  pg returns decimal(5,2) as a STRING; .toFixed() is not a function
 *   2eff6b1  avgRank included nulls; "In Top 3" counted them (null <= 3 is true
 *            in JS); "Keywords Tracked" double-counted, once per search engine
 *   9d09989  unranked rows sorted to the TOP (?? 0), burying real results
 *   594febf  competitor battleground picked the latest row, often a null
 *   c79505f  visibility score read from metrics_daily, a table never populated
 *
 * Existing suites run against accounts that already have data, or assert only that
 * a page produced more than 50 characters of text — a bar an error message clears.
 * None of this has ever been covered.
 */

const PAGES: Array<{ path: string; heading: RegExp; label: string }> = [
  { path: '/dashboard', heading: /^Dashboard$/, label: 'Dashboard' },
  { path: '/dashboard/rankings', heading: /^Rankings$/, label: 'Rankings' },
  { path: '/dashboard/reviews', heading: /^Reviews$/, label: 'Reviews' },
  { path: '/dashboard/campaigns', heading: /^Review Campaigns$/, label: 'Campaigns' },
  { path: '/dashboard/competitors', heading: /^Competitors$/, label: 'Competitors' },
  { path: '/dashboard/citations', heading: /^Citations$/, label: 'Citations' },
  { path: '/dashboard/audit', heading: /^Local SEO Audit$/, label: 'SEO Audit' },
  { path: '/dashboard/reports', heading: /^Reports$/, label: 'Reports' },
  { path: '/dashboard/settings', heading: /^Settings$/, label: 'Settings' },
];

/**
 * Reads the number out of a Rankings summary card.
 * Markup is `<div><p>LABEL</p><p>VALUE</p></div>` (Rankings.tsx:738-741), so the
 * value is the label's next sibling. Structural rather than Tailwind-class-based,
 * which keeps it alive through a restyle.
 */
function statValue(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator('xpath=following-sibling::p[1]');
}

test.describe('Suite 09 — New user, zero data', () => {
  let client: TestClient;

  test.beforeEach(async () => {
    // Pro + trialing is what a real fresh signup looks like — trials run with full
    // Pro access, so every route below is reachable without forcing a plan.
    client = await createTestClient({ plan: 'pro', status: 'trialing', onboardingStep: 4 });
  });

  test.afterEach(() => {
    cleanupTestUsers();
  });

  // ------------------------------------------------------------- render sweep

  for (const { path, heading, label } of PAGES) {
    test(`TEST-ZD-RENDER-${label.replace(/\s+/g, '-').toUpperCase()} — ${label} survives an empty account`, async ({ page }) => {
      const errors = watchPageErrors(page);

      await loginViaUI(page, client.email, client.password);
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      await assertRendered(page, heading);
      errors.assertNoCrash(`${label} (${path}) on a zero-data account`);

      // A blank body is the exact failure mode these regressions produced.
      const text = await page.locator('body').innerText();
      expect(text.trim().length, `${label} rendered an empty body`).toBeGreaterThan(80);
    });
  }

  // -------------------------------------------------------------- empty states

  test('TEST-ZD-01 — Dashboard metric cards degrade to placeholders, not a crash', async ({ page }) => {
    const errors = watchPageErrors(page);
    await loginViaUI(page, client.email, client.password);
    await page.waitForLoadState('networkidle');

    // All four read straight off /metrics, which is entirely null here.
    // Regression guard for 1c4b4ef.
    await expect(page.getByText('Avg Rank', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Keywords in Top 10', { exact: true })).toBeVisible();
    await expect(page.getByText('Total Reviews', { exact: true })).toBeVisible();
    await expect(page.getByText('Avg Rating', { exact: true })).toBeVisible();

    errors.assertNoCrash('Dashboard metric cards with null metrics');
  });

  test('TEST-ZD-02 — Dashboard top-keywords table tells the user what to do next', async ({ page }) => {
    await loginViaUI(page, client.email, client.password);
    await page.waitForLoadState('networkidle');

    // An empty table is not enough — a new user needs the next action.
    await expect(
      page.getByText('No ranking data yet. Add keywords in Settings to get started.')
    ).toBeVisible({ timeout: 15_000 });
  });

  test('TEST-ZD-03 — Rankings shows add-a-location guidance when there are none', async ({ page }) => {
    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    // Regression guard for #124 / 1e80c8f — Keywords used to be a dead end, with
    // an empty location picker and no route forward.
    await expect(page.getByText('Add a location to start tracking keywords')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('TEST-ZD-04 — Rankings table empty state points at the Keywords panel', async ({ page }) => {
    seedLocation(client.email, { name: 'Main Office' });

    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/No keywords yet\./)).toBeVisible({ timeout: 15_000 });
  });

  // ------------------------------------------ counting and sorting around nulls

  test('TEST-ZD-05 — Keywords Tracked counts keywords, not keyword×engine rows', async ({ page }) => {
    // Two keywords, each ranked on two engines = four snapshot rows.
    // Before 2eff6b1 this rendered "4". The user has two keywords.
    const locationId = seedLocation(client.email, { name: 'Main Office' });
    const kw1 = seedKeyword(locationId, 'emergency plumber tulsa');
    const kw2 = seedKeyword(locationId, 'water heater repair tulsa');

    for (const keywordId of [kw1, kw2]) {
      seedRankingSnapshot({ keywordId, locationId, rank: 4, searchEngine: 'google' });
      seedRankingSnapshot({ keywordId, locationId, rank: 6, searchEngine: 'bing' });
    }

    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    await expect(statValue(page, 'KEYWORDS TRACKED')).toHaveText('2', { timeout: 15_000 });
  });

  test('TEST-ZD-06 — unranked keywords are excluded from Avg Rank and In Top 3', async ({ page }) => {
    // `null <= 3` is true in JS, so unranked keywords were reported as top-3.
    const locationId = seedLocation(client.email, { name: 'Main Office' });
    const ranked = seedKeyword(locationId, 'ranked keyword');
    const unranked = seedKeyword(locationId, 'unranked keyword');

    seedRankingSnapshot({ keywordId: ranked, locationId, rank: 2 });
    seedRankingSnapshot({ keywordId: unranked, locationId, rank: null });

    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    // Exactly one keyword ranks at #2; the null must not be counted.
    await expect(statValue(page, 'IN TOP 3')).toHaveText('1', { timeout: 15_000 });
    // Avg Rank is the ranked keyword's position, not an average polluted by null.
    await expect(statValue(page, 'AVG RANK')).toHaveText('2.0');
  });

  test('TEST-ZD-07 — sorting by rank puts real positions first and unranked last', async ({ page }) => {
    // Regression guard for 9d09989 — `?? 0` floated unranked rows above #1.
    const locationId = seedLocation(client.email, { name: 'Main Office' });
    const top = seedKeyword(locationId, 'aaa top position');
    const none = seedKeyword(locationId, 'zzz not ranked');

    seedRankingSnapshot({ keywordId: top, locationId, rank: 1 });
    seedRankingSnapshot({ keywordId: none, locationId, rank: null });

    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('columnheader', { name: /rank/i }).first().click();

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toContainText('aaa top position', { timeout: 15_000 });
  });

  test('TEST-ZD-08 — "Awaiting scan" tells the user when results will arrive', async ({ page }) => {
    // A keyword with no snapshot at all. Without a stated timeframe a user cannot
    // tell "queued" from "broken" — the core complaint behind issue #100.
    const locationId = seedLocation(client.email, { name: 'Main Office' });
    seedKeyword(locationId, 'brand new keyword');

    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Awaiting scan').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/awaiting their first scan/i)).toBeVisible();
  });

  // ----------------------------------------------------- actionable failure paths

  test('TEST-ZD-09 — geo-grid scan without coordinates surfaces a visible message', async ({ page }) => {
    // #100.2. apiFetch does NOT throw on 4xx, so the old handler never entered
    // catch and a 422 NO_COORDINATES rendered absolutely nothing. Locations are
    // geocoded asynchronously via Nominatim, so a user who opens this page right
    // after onboarding lands in exactly this state.
    //
    // A null-coordinate location is rejected server-side BEFORE any DataForSEO
    // call, so this test costs nothing.
    const locationId = seedLocation(client.email, {
      name: 'Ungeocoded Office',
      lat: null,
      lng: null,
    });
    seedKeyword(locationId, 'plumber near me');

    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /visibility map/i }).click();

    const runScan = page.getByRole('button', { name: 'Run Scan' });
    await expect(runScan).toBeVisible({ timeout: 15_000 });

    // TODO: harden once the geo-grid panel has data-testids — these are the only
    // two selects rendered on this tab today.
    const selects = page.locator('select');
    await selects.nth(0).selectOption({ index: 1 });
    await selects.nth(1).selectOption({ index: 1 });

    await runScan.click();

    // The assertion is simply that SOMETHING is shown. Silence is the bug.
    await expect(
      page.getByText(/coordinate|geocod|still being processed|try again/i).first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test('TEST-ZD-10 — Run Audit with no location explains itself instead of doing nothing', async ({ page }) => {
    // #100.3 — with zero locations the handler returned early with no error at all.
    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/audit');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Run Audit' }).click();

    await expect(
      page.getByText('No location found. Please add a location in Settings before running an audit.')
    ).toBeVisible({ timeout: 15_000 });
  });

  // ------------------------------------------------------------ Lite's one scan

  test('TEST-ZD-11 — Lite is offered exactly one manual scan', async ({ page }) => {
    const lite = await createTestClient({ plan: 'lite', status: 'active', onboardingStep: 4 });
    const locationId = seedLocation(lite.email, { name: 'Lite Office' });
    seedKeyword(locationId, 'lite keyword');

    await loginViaUI(page, lite.email, lite.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    // Unspent: the one-time CTA is offered; the Pro rolling "Refresh" is not.
    await expect(page.getByRole('button', { name: 'Scan now' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  });

  test('TEST-ZD-12 — a Lite account that has spent its scan sees no scan button at all', async ({ page }) => {
    const lite = await createTestClient({ plan: 'lite', status: 'active', onboardingStep: 4 });
    dbQuery(`
      UPDATE clients SET manual_scan_used_at = NOW()
      WHERE user_id = (SELECT id FROM users WHERE email = '${lite.email}')
    `);

    await loginViaUI(page, lite.email, lite.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Rankings' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Scan now' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  });

  // ---------------------------------------------------------- known live defect

  test('TEST-ZD-13 — the add-a-location link goes to Settings, not the marketing site', async ({ page }) => {
    // KNOWN FAILURE — documented in the QA plan as suite F.
    // Rankings.tsx:316 and :640 link to "/settings?tab=locations", which is not a
    // route. App.tsx's catch-all then redirects to "/", so a logged-in user
    // following the app's own guidance lands on the marketing homepage.
    // Correct target: /dashboard/settings?tab=locations
    //
    // test.fail() means this is expected to fail today and will alert us the
    // moment it starts passing, i.e. when the bug is fixed.
    test.fail();

    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: /add your first location/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings/, { timeout: 15_000 });
  });
});
