import { Page } from '@playwright/test';
import { API_URL } from '../config';

export function uniqueEmail(): string {
  return `pw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.com`;
}

export async function registerViaAPI(email: string, password: string, businessName: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, businessName }),
  });
  const body = await res.json() as { success: boolean };
  if (!body.success) throw new Error(`Register failed for ${email}: ${JSON.stringify(body)}`);
}

export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 20_000 });
}

/** Returns an access token for direct API assertions (403/401 checks etc). */
export async function loginViaAPI(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json() as { success: boolean; data?: { accessToken: string } };
  if (!body.success || !body.data?.accessToken) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  }
  return body.data.accessToken;
}
