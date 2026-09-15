import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('review requests distinguish missing connection from temporary request limits', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated fixture; no invitations');
  let limited = false;
  await page.route('**/api/campaigns', route => route.fulfill(limited ? { status: 429, json: { success: false, error: { message: 'Too many requests', code: 'RATE_LIMITED' } } } : { json: { success: true, data: { campaigns: [], setupState: 'connection_required' } } }));
  await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
  await page.goto('/dashboard/campaigns');
  await expect(page.getByRole('link', { name: 'Connect Google reviews', exact: true })).toBeVisible();
  await expect(page.getByText('Failed to load campaigns')).toHaveCount(0);
  limited = true; await page.reload();
  await expect(page.getByRole('alert')).toContainText('Requests are temporarily limited');
  limited = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Connect Google reviews', exact: true })).toBeVisible();
});

test('website audit explains missing results and requires a saved website', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated fixture; no audit purchases');
  const id = '00000000-0000-4000-8000-000000000123';
  await page.route('**/api/locations', route => route.fulfill({ json: { success: true, data: [{ id, name: 'Fixture Fitness', website: null }] } }));
  const audits = [{ id: 'audit-fixture', locationId: id, status: 'complete', napScore: null, citationScore: 27, compositeScore: null, onPageScore: null, onPageDetails: [], dfsLighthouseTaskId: null, dfsOnPageData: null, createdAt: new Date().toISOString() }];
  await page.route('**/api/audits/bl', route => route.fulfill({ json: { success: true, data: { audits } } }));
  await page.route('**/api/audits/bl/location/*/history', route => route.fulfill({ json: { success: true, data: { audits } } }));
  await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
  await page.goto('/dashboard/audit');
  await expect(page.getByRole('button', { name: 'Run Audit', exact: true })).toBeDisabled();
  await expect(page.getByText(/A dash means no measured result is available/)).toBeVisible();
  await expect(page.getByText(/Add your website in Settings → Locations to start your first website audit/)).toBeVisible();
});
