import { test, expect } from '@playwright/test';
import { uniqueEmail, registerViaAPI, loginViaUI } from './helpers/auth';
import { cleanupTestUsers } from './helpers/db';

import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL } from './config';

test.describe('Suite 07 — Admin Panel', () => {
  // Fresh login per test to avoid refresh token rotation issues
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    // Let auth state and SWR fully settle before navigating away
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    cleanupTestUsers();
  });

  test('TEST-ADMIN-01 — Admin nav item visible for admin user', async ({ page }) => {
    // Admin role shows the Admin nav link in the sidebar
    // `exact` matters: the business-name pill is also a link, so a substring match
    // collides with any business name containing 'Admin'. Note the Admin link sits
    // OUTSIDE <nav aria-label="Dashboard navigation"> — it is rendered after it —
    // so scoping to that nav finds nothing.
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('TEST-ADMIN-02 — admin panel loads Overview tab', async ({ page }) => {
    // Client-side navigation avoids the refresh token rotation race
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.waitForURL('/admin', { timeout: 10_000 });
    // Overview tab shows "Total Clients" stat card
    await expect(page.getByText(/total clients/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/trialing/i)).toBeVisible({ timeout: 10_000 });
  });

  test('TEST-ADMIN-03 — Clients tab loads and is searchable', async ({ page }) => {
    const email = uniqueEmail();
    await registerViaAPI(email, 'TestPass123!', 'Searchable Biz');
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.waitForURL('/admin', { timeout: 10_000 });
    // Click Clients tab (tab bar uses button elements)
    await page.getByRole('button', { name: 'Clients' }).click();
    await expect(page.getByText('Searchable Biz')).toBeVisible({ timeout: 10_000 });
    // Search for the business
    const search = page.getByPlaceholder('Search by name or email…');
    await search.fill('Searchable Biz');
    await expect(page.getByText('Searchable Biz')).toBeVisible({ timeout: 8_000 });
  });

  test('TEST-ADMIN-04 — admin overview shows system health', async ({ page }) => {
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.waitForURL('/admin', { timeout: 10_000 });
    // The overview tab has a "System Health" section with DB and Redis health dots
    await expect(page.getByText('Database')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Redis')).toBeVisible();
  });

  test('TEST-ADMIN-05 — Job Queues tab loads', async ({ page }) => {
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.waitForURL('/admin', { timeout: 10_000 });
    // Wait for overview to render before clicking tabs
    await expect(page.getByText(/total clients/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Job Queues' }).click();
    // Queue stats show waiting/active/completed/failed columns
    await expect(page.getByText(/waiting|active|completed|failed/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('TEST-ADMIN-06 — Analytics tab loads', async ({ page }) => {
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.waitForURL('/admin', { timeout: 10_000 });
    // Wait for overview to render before switching tabs
    await expect(page.getByText(/total clients/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Analytics' }).click();
    // Analytics tab fetches /admin/analytics lazily — wait for network to settle
    await page.waitForLoadState('networkidle');
    // Headings render once /admin/analytics data loads (skeleton shown while loading)
    await expect(page.getByText('New Signups vs Cancellations (last 12 months)')).toBeVisible({ timeout: 15_000 });
  });

  test('TEST-ADMIN-07 — non-admin API calls return 403', async ({ request }) => {
    // Register a regular client user
    const email = uniqueEmail();
    await registerViaAPI(email, 'TestPass123!', 'Regular Biz');
    // Login as regular client via API
    const loginRes = await request.post(`${API_URL}/auth/login`, {
      data: { email, password: 'TestPass123!' },
    });
    const loginBody = await loginRes.json() as { success: boolean; data: { accessToken: string } };
    expect(loginBody.success).toBe(true);
    const token = loginBody.data.accessToken;
    // Try to access admin API endpoint — should be forbidden
    const adminRes = await request.get(`${API_URL}/admin/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(adminRes.status()).toBe(403);
  });

  test('TEST-ADMIN-08 — newly registered client appears in admin list', async ({ page }) => {
    const email = uniqueEmail();
    await registerViaAPI(email, 'TestPass123!', 'New Test Client');
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.waitForURL('/admin', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Clients' }).click();
    // Wait for clients API response to populate table
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('New Test Client')).toBeVisible({ timeout: 15_000 });
  });
});
