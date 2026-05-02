import { test, expect, Page } from '@playwright/test';
import { uniqueEmail, registerViaAPI, loginViaUI } from './helpers/auth';
import { cleanupTestUsers, dbQuery } from './helpers/db';

async function goToStep2(page: Page, email: string, password: string) {
  await loginViaUI(page, email, password);
  await page.waitForURL('/onboarding', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 10_000 });
}

async function addLocation(
  page: Page,
  name: string,
  address: string,
  city: string,
  state: string,
  zip: string,
  phone: string
) {
  await page.getByRole('button', { name: '+ Add location' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Address').fill(address);
  await page.getByLabel('City').fill(city);
  await page.getByLabel('State').fill(state);
  await page.getByLabel('Zip').fill(zip);
  await page.getByLabel('Phone').fill(phone);
  await page.getByRole('button', { name: 'Add' }).click();
  // Match the exact location name in the card (not the address line or input value)
  await expect(page.locator('p.font-medium').filter({ hasText: name })).toBeVisible({ timeout: 5_000 });
}

test.describe('Suite 04 — Onboarding: Multiple Locations', () => {
  let email: string;
  const password = 'TestPass123!';

  test.beforeEach(async () => {
    email = uniqueEmail();
    await registerViaAPI(email, password, 'Metro HVAC');
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
  });

  test.afterEach(async () => {
    cleanupTestUsers();
  });

  test('TEST-ONB-M-01 — add three locations in step 2', async ({ page }) => {
    await goToStep2(page, email, password);
    await addLocation(page, 'North Branch', '100 N Oak Ave', 'Dallas', 'TX', '75201', '214-555-0101');
    await addLocation(page, 'South Branch', '200 S Elm St', 'Dallas', 'TX', '75203', '214-555-0202');
    await addLocation(page, 'East Branch', '300 E Pine Rd', 'Dallas', 'TX', '75204', '214-555-0303');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 10_000 });
    // All three locations should appear on step 3 as keyword sections
    await expect(page.getByText('North Branch')).toBeVisible();
    await expect(page.getByText('South Branch')).toBeVisible();
    await expect(page.getByText('East Branch')).toBeVisible();
  });

  test('TEST-ONB-M-02 — step 3 has keyword section per location', async ({ page }) => {
    await goToStep2(page, email, password);
    await addLocation(page, 'North Branch', '100 N Oak Ave', 'Dallas', 'TX', '75201', '214-555-0101');
    await addLocation(page, 'South Branch', '200 S Elm St', 'Dallas', 'TX', '75203', '214-555-0202');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 10_000 });
    // Each location gets its own keyword input
    await expect(page.getByText('North Branch')).toBeVisible();
    await expect(page.getByText('South Branch')).toBeVisible();
    const kwInputs = page.getByPlaceholder('e.g. plumber near me');
    expect(await kwInputs.count()).toBeGreaterThanOrEqual(2);
  });

  test('TEST-ONB-M-03 — add different keywords per location', async ({ page }) => {
    await goToStep2(page, email, password);
    await addLocation(page, 'North Branch', '100 N Oak Ave', 'Dallas', 'TX', '75201', '214-555-0101');
    await addLocation(page, 'South Branch', '200 S Elm St', 'Dallas', 'TX', '75203', '214-555-0202');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 10_000 });
    const kwInputs = page.getByPlaceholder('e.g. plumber near me');
    // First location keywords
    await kwInputs.nth(0).fill('hvac repair dallas');
    await kwInputs.nth(0).press('Enter');
    await expect(page.getByText('hvac repair dallas')).toBeVisible();
    // Second location keywords
    await kwInputs.nth(1).fill('ac repair south dallas');
    await kwInputs.nth(1).press('Enter');
    await expect(page.getByText('ac repair south dallas')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 4 of 4')).toBeVisible({ timeout: 10_000 });
  });

  test('TEST-ONB-M-04 — remove a location in step 2', async ({ page }) => {
    await goToStep2(page, email, password);
    await addLocation(page, 'Location A', '1 A St', 'Austin', 'TX', '78701', '512-000-0001');
    await addLocation(page, 'Location B', '2 B St', 'Austin', 'TX', '78702', '512-000-0002');
    // Location A is at index 0, so its Remove button is first in the list
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.getByText('Location A')).not.toBeVisible();
    await expect(page.getByText('Location B')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Location A')).not.toBeVisible();
    await expect(page.getByText('Location B')).toBeVisible();
  });

  test('TEST-ONB-M-05 — remove a keyword chip', async ({ page }) => {
    await goToStep2(page, email, password);
    await addLocation(page, 'Main', '1 Main St', 'Austin', 'TX', '78701', '512-000-0001');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 10_000 });
    const kwInput = page.getByPlaceholder('e.g. plumber near me').first();
    for (const kw of ['kw1', 'kw2', 'kw3']) {
      await kwInput.fill(kw);
      await kwInput.press('Enter');
      await expect(page.getByText(kw)).toBeVisible();
    }
    // Remove kw2: find the chip span and click its × button
    // The chip is a <span> containing the kw text and a <button> with ×
    const kw2Chip = page.locator('span').filter({ hasText: /^kw2/ });
    await kw2Chip.getByRole('button').click();
    await expect(page.getByText('kw2')).not.toBeVisible();
    await expect(page.getByText('kw1')).toBeVisible();
    await expect(page.getByText('kw3')).toBeVisible();
  });
});
