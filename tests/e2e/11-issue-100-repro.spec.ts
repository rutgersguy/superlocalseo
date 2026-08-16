import { test, expect, Page } from '@playwright/test';
import { loginViaUI, uniqueEmail, registerViaAPI } from './helpers/auth';
import { cleanupTestUsers, dbQuery } from './helpers/db';
import { TEST_PASSWORD, watchPageErrors } from './helpers/fixtures';
import { RUN_COSTLY } from './config';

/**
 * Suite 11 — Issue #100 reproduction harness.
 *
 * ⚠️  OPT-IN ONLY. Run with RUN_COSTLY=1. Never in CI.
 *
 * Clicking Finish calls POST /clients/complete-onboarding, which:
 *   1. provisions a real EmbedMyReviews organization + location (off-machine),
 *   2. enqueues citationsQueue 'onboarding-pull'  (BrightLocal),
 *   3. enqueues rankingsQueue  'onboarding-pull'  (DataForSEO — real money).
 *
 * DataForSEO balance was $23.82 on 2026-08-16. Each run spends from it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Issue #100 ("New account onboarding and scan initiation issues") has been open
 * since 2026-06-18. Two of its three parts were fixed; #100.2 (geo-grid) and
 * #100.3 (audit) were not, and the maintainer's own note says why:
 *
 *   "A scan that starts but never completes is almost certainly the BrightLocal
 *    orphaned-data issue — re-created accounts inherit stale data that breaks the
 *    ranking pull. This needs a live repro (which account, BrightLocal request id,
 *    API response) to fix; can't reproduce blind."
 *
 * The unchecked acceptance criterion is: "when a customer is deleted, are the
 * BrightLocal workspace/profile, local scan records, API tokens and location/
 * campaign records cleaned up?" This suite turns that from a blind question into a
 * scripted, repeatable cycle: onboard → scan → delete → re-register the SAME
 * identity → onboard → scan, and diff the outcome.
 */
test.describe('Suite 11 — Issue #100: fresh vs. re-created account', () => {
  test.skip(!RUN_COSTLY, 'Costly: provisions EMR orgs and spends DataForSEO credit. Set RUN_COSTLY=1.');

  test.afterAll(() => {
    cleanupTestUsers();
  });

  /** Drives the real 4-step wizard end to end, including Finish. */
  async function completeOnboarding(page: Page, businessName: string): Promise<void> {
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });

    // Step 1 — business info
    await page.getByPlaceholder('e.g. Sunrise Fitness, Metro Law Group').fill(businessName);
    await page.locator('select').first().selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2 — one location
    await page.getByRole('button', { name: /add location/i }).first().click();
    await page.getByPlaceholder('e.g. Main Office').fill('Main Office');
    await page.getByPlaceholder('123 Main St').fill('4517 S Sheridan Rd');
    await page.getByPlaceholder('Austin').fill('Tulsa');
    await page.getByPlaceholder('TX').fill('OK');
    await page.getByPlaceholder('78701').fill('74145');
    await page.getByRole('button', { name: 'Add location', exact: true }).click();
    await expect(page.getByText('Main Office')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3 — one keyword
    const kwInput = page.getByPlaceholder('e.g. personal trainer in Brooklyn').first();
    await kwInput.fill('emergency plumber tulsa');
    await kwInput.press('Enter');
    await expect(page.getByText('emergency plumber tulsa')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 4 — connect platforms (all optional), then Finish.
    await expect(page.getByText('Connect your platforms')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
  }

  /**
   * The core assertion set, run identically against a fresh and a re-created
   * account so the two can be diffed.
   */
  async function assertReachesValue(page: Page, email: string, phase: 'fresh' | 're-created') {
    const errors = watchPageErrors(page);

    // B01/B02/B03 — must land on /dashboard and STAY. The historical failure was a
    // stale SWR /clients cache reporting onboardingStep 0 and bouncing the user
    // back to /onboarding, which a single URL snapshot would miss.
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    await page.waitForTimeout(5_000);
    expect(page.url(), `[${phase}] bounced away from /dashboard after Finish`).toContain('/dashboard');

    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(page.url(), `[${phase}] bounced away from /dashboard after reload`).toContain('/dashboard');

    // The wizard's data must have survived (B04).
    const step = dbQuery(
      `SELECT onboarding_step FROM clients WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`
    );
    expect(step, `[${phase}] onboarding_step not persisted`).toContain('4');

    // #100.3 — Run Audit must either start or explain itself. Silence is the bug.
    await page.goto('/dashboard/audit');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Run Audit' }).click();
    await expect(
      page.getByText(/starting|queued|running|in progress|no location|error|failed|try again/i).first(),
      `[${phase}] Run Audit produced no visible feedback at all`
    ).toBeVisible({ timeout: 30_000 });

    // #100.2 — same bar for the geo-grid scan.
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /visibility map/i }).click();
    const runScan = page.getByRole('button', { name: 'Run Scan' });
    await expect(runScan).toBeVisible({ timeout: 15_000 });

    const selects = page.locator('select');
    await selects.nth(0).selectOption({ index: 1 });
    await selects.nth(1).selectOption({ index: 1 });
    await runScan.click();

    await expect(
      page.getByText(/generating|processing|queued|coordinate|geocod|error|failed|try again/i).first(),
      `[${phase}] Run Scan produced no visible feedback at all`
    ).toBeVisible({ timeout: 30_000 });

    errors.assertNoCrash(`[${phase}] post-onboarding value path`);
  }

  test('TEST-100-01 — a fresh account onboards and can start both scans', async ({ page }) => {
    const email = uniqueEmail();
    await registerViaAPI(email, TEST_PASSWORD, 'Issue100 Fresh Co');
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);

    await loginViaUI(page, email, TEST_PASSWORD);
    await completeOnboarding(page, 'Issue100 Fresh Co');
    await assertReachesValue(page, email, 'fresh');
  });

  test('TEST-100-02 — the SAME identity, deleted and re-registered, behaves identically', async ({ page }) => {
    // This is the scenario the issue has been blocked on for two months.
    const email = uniqueEmail();

    // --- first life ---
    await registerViaAPI(email, TEST_PASSWORD, 'Issue100 Recycled Co');
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
    await loginViaUI(page, email, TEST_PASSWORD);
    await completeOnboarding(page, 'Issue100 Recycled Co');
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    const firstEmrOrg = dbQuery(
      `SELECT emr_organization_id FROM clients WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`
    );

    // --- delete, exactly as an operator would ---
    dbQuery(`DELETE FROM users WHERE email = '${email}'`);

    // Orphan check. The open acceptance criterion on #100 is whether anything
    // outside our database is cleaned up. Nothing today unwinds the EMR
    // organization, which is the leading hypothesis for the re-created-account
    // failures. Recorded rather than asserted, because the answer is the finding.
    console.log(`\n  [#100] EMR organization left behind by deletion: ${firstEmrOrg || '(none)'}\n`);

    // --- second life, same identity ---
    await page.context().clearCookies();
    await registerViaAPI(email, TEST_PASSWORD, 'Issue100 Recycled Co');
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
    await loginViaUI(page, email, TEST_PASSWORD);
    await completeOnboarding(page, 'Issue100 Recycled Co');

    // The bar is identical to a fresh account. Any divergence here IS the bug.
    await assertReachesValue(page, email, 're-created');
  });
});
