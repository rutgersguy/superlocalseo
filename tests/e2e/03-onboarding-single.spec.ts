import { test, expect } from '@playwright/test';
import { uniqueEmail, registerViaAPI, loginViaUI } from './helpers/auth';
import { cleanupTestUsers, dbQuery, getClientForEmail } from './helpers/db';

test.describe('Suite 03 — Onboarding: Single Location', () => {
  let email: string;
  let password: string;

  test.beforeEach(async () => {
    email = uniqueEmail();
    password = 'TestPass123!';
    await registerViaAPI(email, password, 'Acme Plumbing');
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
  });

  test.afterEach(async () => {
    cleanupTestUsers();
  });

  test('TEST-ONB-S-01 — new user auto-redirects to /onboarding', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    await expect(page.getByText('Business Information')).toBeVisible();
    // "Finish later" button in top right
    await expect(page.getByRole('button', { name: 'Finish later' })).toBeVisible();
  });

  test('TEST-ONB-S-02 — step 1: fill business info and advance', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    // Fill business name (placeholder is "Acme Plumbing")
    await page.getByPlaceholder('Acme Plumbing').fill('Acme Plumbing Co');
    // Select industry from the select dropdown
    await page.locator('select').selectOption('Plumbing');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Your Locations')).toBeVisible();
    // Verify DB saved step=2 (business name save is async, may lag slightly)
    // Wait a moment for the PATCH to complete
    await page.waitForTimeout(1000);
    const row = getClientForEmail(email);
    expect(row).toContain('2');
  });

  test('TEST-ONB-S-03 — step 2: add a single location', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    // Complete step 1 with defaults
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 10_000 });
    // Add location - click "+ Add location" button
    await page.getByRole('button', { name: '+ Add location' }).click();
    // Fill location form (capitalize labels match the rendered label text)
    await page.getByLabel('Name').fill('Main Branch');
    await page.getByLabel('Address').fill('123 Main St');
    await page.getByLabel('City').fill('Austin');
    await page.getByLabel('State').fill('TX');
    await page.getByLabel('Zip').fill('78701');
    await page.getByLabel('Phone').fill('512-555-0100');
    // Click "Add" button inside the location form
    await page.getByRole('button', { name: 'Add' }).click();
    // Location should now appear in the list
    await expect(page.getByText('Main Branch')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 10_000 });
  });

  test('TEST-ONB-S-04 — step 3: add keywords', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Next' }).click(); // step 1->2
    await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '+ Add location' }).click();
    await page.getByLabel('Name').fill('Main Branch');
    await page.getByLabel('Address').fill('123 Main St');
    await page.getByLabel('City').fill('Austin');
    await page.getByLabel('State').fill('TX');
    await page.getByLabel('Zip').fill('78701');
    await page.getByLabel('Phone').fill('512-555-0100');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('button', { name: 'Next' }).click(); // step 2->3
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Target Keywords')).toBeVisible();
    // keyword input placeholder: "e.g. plumber near me"
    const kwInput = page.getByPlaceholder('e.g. plumber near me');
    await kwInput.fill('plumber near me');
    await kwInput.press('Enter');
    await expect(page.getByText('plumber near me')).toBeVisible();
    await kwInput.fill('emergency plumber Austin');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('emergency plumber Austin')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 4 of 4')).toBeVisible({ timeout: 10_000 });
  });

  test('TEST-ONB-S-05 — step 4: finish navigates to billing settings', async ({ page }) => {
    test.setTimeout(45_000);
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    // Step 1 -> 2
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 10_000 });
    // Step 2 -> 3 (skip adding locations)
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 10_000 });
    // Step 3 -> 4
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 4 of 4')).toBeVisible({ timeout: 10_000 });
    // Finish
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.waitForURL(/dashboard\/settings/, { timeout: 25_000 });
    expect(page.url()).toContain('tab=billing');
    const row = getClientForEmail(email);
    expect(row).toContain('4');
  });

  test('TEST-ONB-S-06 — completed user not redirected back to onboarding', async ({ page }) => {
    dbQuery(`UPDATE clients SET onboarding_step = 4 WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`);
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    expect(page.url()).not.toContain('/onboarding');
  });

  test('TEST-ONB-S-07 — back button returns to step 1', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    // Wait for the API to load business name before typing (avoids race condition where
    // the useEffect resolves asynchronously and overwrites user input)
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Acme Plumbing').fill('My Plumbing');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    // After Back, the React state should still hold 'My Plumbing'
    await expect(page.getByPlaceholder('Acme Plumbing')).toHaveValue('My Plumbing');
  });
});
