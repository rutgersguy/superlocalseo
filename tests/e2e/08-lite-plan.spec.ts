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
    await expect(page.getByText(/\$99\/mo/)).toBeVisible();
    await expect(page.getByText(/\$349\/mo/)).toBeVisible();
  });
});
