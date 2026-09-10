import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('admin mapping inventory explicitly blocks unverified bindings', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Uses isolated fixture accounts only');
  await loginViaUI(page, 'admin@fixture.test', 'TestPass123!');
  const loaded = page.waitForResponse(r => r.url().includes('/api/admin/provider-mappings?') && r.status() === 200);
  await page.goto('/admin?tab=provider-mappings');
  const response = await loaded;
  const data = (await response.json()).data;
  expect(data.verificationAvailable).toBe(false);
  expect(data.locations.length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Provider location mappings', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Binding is disabled');
  const card = page.locator('article').first();
  await card.getByText('Verify a provider mapping', { exact: true }).click();
  await expect(card.getByRole('button', { name: 'Verify and save mapping', exact: true })).toBeDisabled();
  await expect(card.getByLabel('EMR organization ID', { exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
