import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('operator inspection form sends explicit evidence and shows membership failures', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Uses isolated fixtures and simulated provider verification only');
  await loginViaUI(page, 'admin@fixture.test', 'TestPass123!');
  // Browser contract test; backend persistence/tenancy is separately exercised by integration tests.
  await page.route('**/api/admin/provider-mappings?*', async route => {
    const response = await route.fetch(); const json = await response.json();
    json.data.verificationAvailable = true;
    json.data.locations = [{ locationId: '00000000-0000-4000-8000-000000000123', businessName: 'Inspection fixture', locationName: 'Test branch', googlePlaceId: null, mapping: null }];
    await route.fulfill({ response, json });
  });
  let submitted: any;
  let accept = false;
  await page.route('**/api/admin/provider-mappings/00000000-0000-4000-8000-000000000123', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: accept ? 200 : 409, json: accept ? { success: true, data: { revision: 1 } } : { success: false, error: { message: 'The provider location does not belong to the selected organization.' } } });
  });
  await page.goto('/admin?tab=provider-mappings');
  await page.getByText('Record a provider mapping', { exact: true }).click();
  await page.getByLabel('EMR organization ID', { exact: true }).fill('880001');
  await page.getByLabel('EMR location ID', { exact: true }).fill('880002');
  await page.getByLabel('Confirm Google Place ID', { exact: true }).fill('ChIJ-browser-fixture');
  await page.getByLabel('Provider dashboard page URL', { exact: true }).fill('https://app.superlocalseo.com/sources');
  await page.getByLabel('Google business name shown in EMR', { exact: true }).fill('Inspection fixture');
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await page.getByLabel('Inspection time', { exact: false }).fill(localTime);
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByLabel('Operator note (internal)', { exact: true }).fill('Simulated fixture inspection for browser contract test.');
  await page.getByRole('button', { name: 'Check membership and save inspection', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('does not belong');
  expect(submitted.expectedGooglePlaceId).toBeNull();
  expect(submitted.inspection.exactPlaceIdConfirmed).toBe(true);
  expect(submitted.inspection.customerOwnershipConfirmed).toBe(true);
  expect(submitted.inspection.businessName).toBe('Inspection fixture');
  accept = true;
  await page.getByRole('button', { name: 'Check membership and save inspection', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Mapping saved with your identity inspection');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
