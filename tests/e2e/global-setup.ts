import { chromium } from '@playwright/test';
import { registerViaAPI } from './helpers/auth';
import { cleanupTestUsers, dbQuery } from './helpers/db';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173';

async function uiLogin(email: string, password: string, authPath: string) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|onboarding|admin)/, { timeout: 20_000 });
  await ctx.storageState({ path: authPath });
  await browser.close();
}

async function globalSetup() {
  cleanupTestUsers();
  fs.mkdirSync('tests/e2e/.auth', { recursive: true });

  // Admin session
  await uiLogin('hello@superlocalseo.com', 'Admin#Test2026!', 'tests/e2e/.auth/admin.json');

  // Create client user for dashboard tests
  const clientEmail = `pw-dashboard-${Date.now()}@test.com`;
  const clientPassword = 'TestPass123!';
  await registerViaAPI(clientEmail, clientPassword, 'Dashboard Test Biz');
  dbQuery(`UPDATE clients SET onboarding_step = 4, subscription_status = 'trialing', trial_ends_at = NOW() + INTERVAL '7 days' WHERE user_id = (SELECT id FROM users WHERE email = '${clientEmail}')`);
  dbQuery(`UPDATE users SET email_verified = true WHERE email = '${clientEmail}'`);

  // Client session — separate browser to avoid cookie contamination
  await uiLogin(clientEmail, clientPassword, 'tests/e2e/.auth/client.json');

  fs.writeFileSync('tests/e2e/.auth/meta.json', JSON.stringify({ clientEmail }));
}

export default globalSetup;
