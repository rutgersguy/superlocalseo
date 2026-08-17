import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './config';

test.describe('Suite 06 — Dashboard', () => {
  // Login fresh per test since refresh tokens rotate (single-use)
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    // Let auth state fully settle before navigating to sub-routes
    await page.waitForLoadState('networkidle');
  });

  test('TEST-DASH-01 — dashboard loads and shows main nav items', async ({ page }) => {
    // Scope to the sidebar nav — the dashboard body also has quick-action cards
    // (e.g. "View Reviews") whose names collide with nav links.
    const nav = page.getByRole('navigation', { name: /dashboard navigation/i });
    await expect(nav.getByRole('link', { name: 'Rankings', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(nav.getByRole('link', { name: 'Reviews', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Citations', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  });

  test('TEST-DASH-02 — rankings nav link works', async ({ page }) => {
    await page.getByRole('link', { name: /rankings/i }).click();
    await page.waitForURL(/dashboard\/rankings/, { timeout: 5_000 });
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('TEST-DASH-03 — reviews nav link works', async ({ page }) => {
    await page.getByRole('navigation', { name: /dashboard navigation/i }).getByRole('link', { name: 'Reviews', exact: true }).click();
    await page.waitForURL(/dashboard\/reviews/, { timeout: 5_000 });
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('TEST-DASH-04 — citations nav link works', async ({ page }) => {
    await page.getByRole('link', { name: /citations/i }).click();
    await page.waitForURL(/dashboard\/citations/, { timeout: 5_000 });
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('TEST-DASH-05 — reports nav link works', async ({ page }) => {
    await page.getByRole('link', { name: /reports/i }).click();
    await page.waitForURL(/dashboard\/reports/, { timeout: 5_000 });
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('TEST-DASH-06 — audit nav link works', async ({ page }) => {
    await page.getByRole('navigation', { name: /dashboard navigation/i }).getByRole('link', { name: 'SEO Audit', exact: true }).click();
    await page.waitForURL(/dashboard\/audit/, { timeout: 5_000 });
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('TEST-DASH-07 — settings nav link works', async ({ page }) => {
    await page.getByRole('link', { name: /settings/i }).click();
    await page.waitForURL(/dashboard\/settings/, { timeout: 5_000 });
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('TEST-DASH-08 — settings page has no Yelp panel', async ({ page }) => {
    await page.getByRole('link', { name: /settings/i }).click();
    await page.waitForURL(/dashboard\/settings/, { timeout: 5_000 });
    await expect(page.getByText(/yelp/i)).not.toBeVisible({ timeout: 5_000 });
  });

  test('TEST-DASH-09 — settings page has no BrightLocal mentions', async ({ page }) => {
    await page.getByRole('link', { name: /settings/i }).click();
    await page.waitForURL(/dashboard\/settings/, { timeout: 5_000 });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toLowerCase()).not.toContain('brightlocal');
  });

  test('TEST-DASH-10 — admin user does not get redirected to /onboarding', async ({ page }) => {
    await expect(page).not.toHaveURL('/onboarding');
    await expect(page.url()).toContain('/dashboard');
  });

  test('TEST-DASH-11 — unauthenticated redirects to /login', async ({ browser }) => {
    const ctx = await browser.newContext(); // fresh context, no cookies
    const page = await ctx.newPage();
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/login');
    await ctx.close();
  });
});
