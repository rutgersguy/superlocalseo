import { test, expect } from '@playwright/test';
import { uniqueEmail, registerViaAPI, loginViaUI } from './helpers/auth';
import { cleanupTestUsers, dbQuery } from './helpers/db';

test.describe('Suite 01 — Authentication', () => {
  test.afterEach(async () => {
    cleanupTestUsers();
  });

  test('TEST-AUTH-01 — non-existent email shows register prompt', async ({ page }) => {
    const email = uniqueEmail();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('anything123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The Login page shows a noAccountHint banner with text "No account found for that email."
    await expect(page.getByText('No account found for that email')).toBeVisible({ timeout: 8_000 });
    // Banner contains a "Create account →" link
    const link = page.getByRole('link', { name: 'Create account →' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('/register?email=');
    expect(decodeURIComponent(href!)).toContain(email);
    // Still on /login
    expect(page.url()).toContain('/login');
  });

  test('TEST-AUTH-02 — wrong password shows generic error', async ({ page }) => {
    const email = uniqueEmail();
    await registerViaAPI(email, 'correct123', 'Test Biz');
    dbQuery(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('No account found')).not.toBeVisible();
    expect(page.url()).toContain('/login');
  });

  test('TEST-AUTH-03 — Google-only account shows Google hint', async ({ page }) => {
    const email = `pw-google-${Date.now()}@test.com`;
    dbQuery(`INSERT INTO users (email, google_id, role, email_verified) VALUES ('${email}', 'fake-gid-${Date.now()}', 'client', true)`);
    dbQuery(`INSERT INTO clients (user_id, business_name, subscription_status, trial_ends_at) VALUES ((SELECT id FROM users WHERE email = '${email}'), 'Google Biz', 'trialing', NOW() + INTERVAL '7 days')`);
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('anything');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Login page shows googleOnlyHint with "This account uses Google sign-in."
    await expect(page.getByText('This account uses Google sign-in')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Sign in with Google').nth(1)).toBeVisible();
  });

  test('TEST-AUTH-04 — register URL pre-fills form', async ({ page }) => {
    await page.goto('/register?email=prefilled%40example.com&business=My+Plumbing');
    // Register page uses defaultValues from searchParams
    await expect(page.getByLabel('Email')).toHaveValue('prefilled@example.com');
    await expect(page.getByLabel('Business Name')).toHaveValue('My Plumbing');
    await expect(page.getByLabel('Password')).toHaveValue('');
  });

  test('TEST-AUTH-05 — successful registration lands on /registered', async ({ page }) => {
    const email = uniqueEmail();
    await page.goto('/register');
    await page.getByLabel('Business Name').fill('Playwright Test Biz');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('SecurePass123!');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('/registered', { timeout: 15_000 });
  });

  test('TEST-AUTH-06 — no-account banner links to register with pre-filled email', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('noone@example.com');
    await page.getByLabel('Password').fill('anything');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('No account found for that email')).toBeVisible({ timeout: 8_000 });
    await page.getByRole('link', { name: 'Create account →' }).click();
    await page.waitForURL(/\/register/, { timeout: 8_000 });
    // Email should be pre-filled via query param
    await expect(page.getByLabel('Email')).toHaveValue('noone@example.com');
  });
});
