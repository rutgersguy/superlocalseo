import { test, expect } from '@playwright/test';
import { uniqueEmail } from './helpers/auth';

// SKIPPED: the in-app /audit lead-magnet form these tests target was replaced by an
// external redirect to app.superlocalseo.com/intel-request (App.tsx — ExternalRedirect).
// The flow now lives off-app, so these in-app assertions no longer apply. Kept (not
// deleted) in case the in-app audit returns; delete if the external intel-request is permanent.
test.describe.skip('Suite 02 — Public Audit Lead', () => {
  test('TEST-AUDIT-01 — audit form renders', async ({ page }) => {
    await page.goto('/audit');
    // Audit form has: Business Name label, City/Area label, and a submit button
    await expect(page.getByLabel('Business Name')).toBeVisible();
    await expect(page.getByLabel('City / Area')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Free Audit' })).toBeVisible();
  });

  test('TEST-AUDIT-02 — running an audit shows scored results', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/audit');
    await page.getByLabel('Business Name').fill('Starbucks');
    await page.getByLabel('City / Area').fill('Seattle, WA');
    await page.getByRole('button', { name: 'Run Free Audit' }).click();
    // Wait for scanning to complete and results to show
    // Results show overallGrade as a GradeBadge, and category cards
    await page.waitForSelector('text=Overall', { timeout: 30_000 });
    // The unlock section should appear with email gate
    await expect(page.getByText('Unlock your full report')).toBeVisible({ timeout: 30_000 });
  });

  test('TEST-AUDIT-03 — email capture unlocks and shows register CTA', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/audit');
    await page.getByLabel('Business Name').fill('Starbucks');
    await page.getByLabel('City / Area').fill('Seattle, WA');
    await page.getByRole('button', { name: 'Run Free Audit' }).click();
    // Wait for results
    await page.waitForSelector('text=Unlock your full report', { timeout: 30_000 });
    // Fill email in the gate form
    const testEmail = uniqueEmail();
    await page.locator('input[type="email"]').fill(testEmail);
    await page.getByRole('button', { name: 'Unlock' }).click();
    // After unlocking, step='unlocked' shows a "Start free 14-day trial" link
    const ctaLink = page.getByRole('link', { name: 'Start free 14-day trial' });
    await expect(ctaLink).toBeVisible({ timeout: 15_000 });
    const href = await ctaLink.getAttribute('href');
    expect(href).toContain('/register');
    expect(href).toContain('email=');
  });

  test('TEST-AUDIT-04 — register link from audit pre-fills form', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/audit');
    await page.getByLabel('Business Name').fill('Starbucks');
    await page.getByLabel('City / Area').fill('Seattle, WA');
    await page.getByRole('button', { name: 'Run Free Audit' }).click();
    await page.waitForSelector('text=Unlock your full report', { timeout: 30_000 });
    const testEmail = uniqueEmail();
    await page.locator('input[type="email"]').fill(testEmail);
    await page.getByRole('button', { name: 'Unlock' }).click();
    const ctaLink = page.getByRole('link', { name: 'Start free 14-day trial' });
    await ctaLink.waitFor({ timeout: 15_000 });
    await ctaLink.click();
    await page.waitForURL(/\/register/, { timeout: 8_000 });
    await expect(page.getByLabel('Email')).toHaveValue(testEmail);
  });
});
