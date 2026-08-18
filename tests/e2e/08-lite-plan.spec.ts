import { test, expect } from '@playwright/test';
import { uniqueEmail, registerViaAPI, loginViaUI } from './helpers/auth';
import { dbQuery, cleanupTestUsers } from './helpers/db';

/**
 * Suite 08 — Lite plan gating (Option B: trials run as Pro; the plan applies at
 * checkout, and product_line flips to 'lite' on a Lite payment). These tests force
 * an already-onboarded, active LITE client to verify the plan-gated UI.
 */
test.describe('Suite 08 — Lite plan gating', () => {
  let email: string;
  const password = 'TestPass123!';

  test.beforeEach(async () => {
    email = uniqueEmail();
    await registerViaAPI(email, password, 'Lite Test Co');
    // Force an onboarded, active Lite client so the dashboard renders for Lite.
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
    dbQuery(`
      UPDATE clients
      SET product_line = 'lite', subscription_status = 'active', onboarding_step = 5
      WHERE user_id = (SELECT id FROM users WHERE email = '${email}')
    `);
  });

  test.afterEach(() => {
    cleanupTestUsers();
  });

  test('TEST-LITE-01 — Pro-only nav items are hidden for Lite', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    // Scope to the sidebar nav (the dashboard body also has quick-action links).
    const nav = page.getByRole('navigation', { name: /dashboard navigation/i });

    // Lite keeps these
    await expect(nav.getByRole('link', { name: 'Reviews', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(nav.getByRole('link', { name: 'Rankings', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

    // Pro-only — hidden for Lite
    await expect(nav.getByRole('link', { name: /citations/i })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /seo audit/i })).toHaveCount(0);
  });

  test('TEST-LITE-02 — Competitors shows the upgrade teaser for Lite', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    await page.goto('/dashboard/competitors');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText("See who's outranking you")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /upgrade to pro/i })).toBeVisible();
    // The full Pro competitor controls must NOT render for Lite (teaser only).
    await expect(page.getByRole('button', { name: /add competitor/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /run scan/i })).toHaveCount(0);
  });

  test('TEST-LITE-03 — Register shows the plan picker (Lite default)', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('Choose your plan')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/\$149\/mo/)).toBeVisible();
    await expect(page.getByText(/\$349\/mo/)).toBeVisible();
  });

  test('TEST-LITE-04 — Rankings hides Pro features for Lite', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Rankings' })).toBeVisible({ timeout: 10_000 });
    // Pro-only controls hidden for Lite
    await expect(page.getByText('Visibility Map')).toHaveCount(0); // geo-grid tab
    await expect(page.getByRole('button', { name: 'ROI', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0); // manual sync
  });

  test('TEST-LITE-05 — Settings hides Team and QR Codes tabs for Lite', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    // Lite keeps these tabs
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Billing', exact: true })).toBeVisible();
    // Pro-only tabs hidden
    await expect(page.getByRole('button', { name: 'Team', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'QR Codes', exact: true })).toHaveCount(0);
  });

  test('TEST-LITE-06 — Dashboard hides Pro widgets for Lite', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10_000 });
    // Pro-only widgets/actions hidden for Lite
    await expect(page.getByText('Local SEO Score')).toHaveCount(0); // audit metric
    await expect(page.getByText('Unlock your ROI estimate')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Run SEO Audit' })).toHaveCount(0);
  });

  /**
   * TEST-LITE-08..10 lock the #157 decisions of 2026-08-18.
   *
   * All three surfaces below rendered for Lite. Two of them WORKED rather than
   * merely 403'ing, so this was a revenue leak and not a cosmetic one: Lite
   * could download rankings, keywords, reviews and citations despite both
   * PRICING.md and the landing page selling "CSV exports" as Pro.
   *
   * The decision was to enforce what we already sell, and to hide the controls
   * rather than let them fail — a button that 403s teaches a customer the
   * product is broken, not that they should upgrade.
   */
  test('TEST-LITE-08 — Reports hides the CSV export card for Lite', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.getByRole('link', { name: /reports/i }).first().click();
    await expect(page.getByRole('heading', { name: /Reports/i }).first()).toBeVisible({ timeout: 15_000 });

    // The page itself stays — PRICING.md sells Reports as part of Lite.
    // Only the four export tiles go.
    await expect(page.getByText('Data Exports')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /rankings\.csv|export/i })).toHaveCount(0);
  });

  test('TEST-LITE-09 — Reviews hides the Export CSV button for Lite', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.getByRole('link', { name: /reviews/i }).first().click();
    await expect(page.getByRole('heading', { name: /Reviews/i }).first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  });

  test('TEST-LITE-10 — Settings keeps Widgets for Lite but hides ROI', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.getByRole('link', { name: /settings/i }).first().click();
    await expect(page.getByRole('heading', { name: /Settings/i }).first()).toBeVisible({ timeout: 15_000 });

    // Widgets is deliberately Lite-INCLUSIVE (decision 2026-08-18). It was never
    // marketed as Pro, and a review widget on the customer's own site carries
    // our branding. Asserted so a future "tidy-up" cannot quietly remove it.
    await expect(page.getByRole('button', { name: 'Widgets' })).toBeVisible();

    // ROI is Pro — /analytics/roi 403s, so the form used to render and fail.
    await expect(page.getByText('ROI Settings')).toHaveCount(0);
  });

  test('TEST-LITE-07 — direct nav to a Pro route shows the upgrade gate (ProGate)', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    // Lite user types the URL directly — nav hides it, but the route must gate gracefully.
    await page.goto('/dashboard/citations');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Citations is a Pro feature')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /upgrade to pro/i })).toBeVisible();
  });
});
