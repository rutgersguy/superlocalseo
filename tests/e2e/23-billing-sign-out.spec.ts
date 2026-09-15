import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('expired trial can sign out from billing and cannot reopen it signed out', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated fixture session and simulated expired status');
  await page.route('**/api/billing/status', async route => {
    const response = await route.fetch(); const body = await response.json();
    body.data.status = 'trialing'; body.data.trialDaysLeft = 0; body.data.trialEndsAt = '2020-01-01T00:00:00Z';
    await route.fulfill({ response, json: body });
  });
  await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
  await page.goto('/billing');
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  await expect(signOut).toBeVisible();
  const logout = page.waitForResponse(r => r.url().endsWith('/api/auth/logout') && r.request().method() === 'POST');
  await signOut.click();
  expect((await logout).status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/billing');
  await expect(page).toHaveURL(/\/login$/);
});
