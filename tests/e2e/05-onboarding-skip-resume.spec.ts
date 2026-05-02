import { test, expect } from '@playwright/test';
import { uniqueEmail, registerViaAPI, loginViaUI } from './helpers/auth';
import { cleanupTestUsers, dbQuery, getClientForEmail } from './helpers/db';

test.describe('Suite 05 — Onboarding: Skip & Resume', () => {
  let email: string;
  const password = 'TestPass123!';

  test.beforeEach(async () => {
    email = uniqueEmail();
    await registerViaAPI(email, password, 'Skip Resume Biz');
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
  });

  test.afterEach(() => {
    cleanupTestUsers();
  });

  test('TEST-ONB-SK-01 — "Finish later" button visible on step 1', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Finish later' })).toBeVisible();
  });

  test('TEST-ONB-SK-02 — clicking "Finish later" from step 1 goes to /dashboard', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Finish later' }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    expect(page.url()).toContain('/dashboard');
    expect(page.url()).not.toContain('/onboarding');
  });

  test('TEST-ONB-SK-03 — skip from step 1 saves current step in DB', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Finish later' }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    // Wait for PATCH to complete before checking DB
    await page.waitForTimeout(1000);
    const row = getClientForEmail(email);
    // onboarding_step should be 1 (step was saved)
    expect(row).toContain('1');
  });

  test('TEST-ONB-SK-04 — skip from step 2 saves step 2', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Finish later' }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    // Wait for PATCH to complete before checking DB
    await page.waitForTimeout(1000);
    const row = getClientForEmail(email);
    expect(row).toContain('2');
  });

  test('TEST-ONB-SK-05 — after skip, dashboard is accessible (no redirect loop)', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.waitForURL('/onboarding', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Finish later' }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    // Wait for the PATCH (step save) to commit before navigating away
    await page.waitForLoadState('networkidle');
    // Navigate to another dashboard section — should NOT redirect to /onboarding
    await page.goto('/dashboard/rankings');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL('/onboarding');
    await expect(page).toHaveURL(/dashboard\/rankings/);
  });

  test('TEST-ONB-SK-06 — resume onboarding from step 2 after skip', async ({ page }) => {
    // Set onboarding_step=2 directly in DB (simulates user who previously skipped at step 2)
    dbQuery(`UPDATE clients SET onboarding_step = 2 WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`);
    await loginViaUI(page, email, password);
    // With step=2, OnboardingRedirect does NOT redirect to /onboarding (only step=0 triggers redirect)
    // User lands on /dashboard
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    // Use client-side navigation via React Router to avoid refresh token rotation on page reload
    await page.evaluate(() => { window.history.pushState({}, '', '/onboarding'); window.dispatchEvent(new PopStateEvent('popstate')); });
    // Wait for the useEffect API call to complete and trigger re-render
    await page.waitForTimeout(1200);
    // The onboarding component loads the saved step from API and renders step 2
    await expect(page.getByText('Step 2 of 4')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Your Locations')).toBeVisible();
  });

  test('TEST-ONB-SK-07 — resume from step 3 after skip', async ({ page }) => {
    dbQuery(`UPDATE clients SET onboarding_step = 3 WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`);
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    // Client-side navigation via React Router — avoids refresh token rotation
    await page.evaluate(() => { window.history.pushState({}, '', '/onboarding'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForTimeout(1200);
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Target Keywords')).toBeVisible();
  });

  test('TEST-ONB-SK-08 — finish after resume does not loop back to onboarding', async ({ page }) => {
    test.setTimeout(45_000);
    // Start from step 3 so we only need to complete step 4 to finish
    dbQuery(`UPDATE clients SET onboarding_step = 3 WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`);
    await loginViaUI(page, email, password);
    await page.waitForURL('/dashboard', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    // Client-side navigation via React Router — avoids refresh token rotation
    await page.evaluate(() => { window.history.pushState({}, '', '/onboarding'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForTimeout(1200);
    await expect(page.getByText('Step 3 of 4')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Step 4 of 4')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.waitForURL(/dashboard\/settings/, { timeout: 25_000 });
    expect(page.url()).toContain('tab=billing');
    // Navigate to dashboard — should NOT redirect back to /onboarding
    // Use client-side nav to avoid token rotation
    await page.evaluate(() => { window.history.pushState({}, '', '/dashboard'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForTimeout(500);
    await expect(page).not.toHaveURL('/onboarding');
  });
});
