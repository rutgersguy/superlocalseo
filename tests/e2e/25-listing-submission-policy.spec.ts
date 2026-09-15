import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('listing wizard limits packages, filters relevance and blocks trial spending', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated UI fixture; no provider purchases');
  await page.route('**/api/admin/citations', r => r.fulfill({ json: { success: true, data: { credits: 30, submissions: [], orders: [], byStatus: {} } } }));
  await page.route('**/api/admin/citations/locations', r => r.fulfill({ json: { success: true, data: { locations: [{ clientId: 'client-fixture', clientName: 'Fitness fixture', locationId: 'location-fixture', locationName: 'Fitness location', subscriptionStatus: 'trialing', allowedDomains: ['yelp.com'], address: '123 Main', city: 'Tulsa', state: 'OK' }] } } }));
  await page.route('**/api/admin/citations/campaign', r => r.fulfill({ json: { success: true, data: { campaignId: 'campaign-fixture' } } }));
  await page.route('**/api/admin/citations/campaign/campaign-fixture/lookup', r => r.fulfill({ json: { success: true, data: { lookupStatus: 'complete', citations: [], availableCitations: ['yelp.com', 'healthgrades.com', 'unrelated.example'] } } }));
  await loginViaUI(page, 'admin@fixture.test', 'TestPass123!');
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Citations', exact: true }).click();
  await page.getByRole('button', { name: 'Run Builder for Client' }).click();
  const selects = page.locator('select');
  await selects.nth(0).selectOption('client-fixture');
  await selects.nth(1).selectOption('location-fixture');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: '10 credits', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '15 credits', exact: true })).toBeVisible();
  await expect(page.getByText('healthgrades.com', { exact: true })).toHaveCount(0);
  await expect(page.getByText('unrelated.example', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0 selected', { exact: false })).toBeVisible();
  await page.getByLabel('yelp.com', { exact: false }).check();
  await page.getByLabel('I have confirmed the business details', { exact: false }).check();
  await expect(page.getByRole('button', { name: 'Confirm & Submit' })).toBeDisabled();
  await expect(page.getByText('Submissions begin after the first paid Pro subscription payment.', { exact: false })).toBeVisible();
});

test('customer sees the paid listing allowance', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated fixture');
  await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
  await page.goto('/dashboard/citations');
  await expect(page.getByText('Each paid location includes one initial allocation', { exact: false })).toBeVisible();
});
