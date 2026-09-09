import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test.describe('Google connection recovery UI', () => {
  test.skip(IS_PRODUCTION_TARGET, 'Provider responses are simulated on the isolated stack');
  test('shows failures, popup fallback, business selection and a healthy zero count', async ({ page }) => {
    let phase = 'not_started'; let fail = true; let imports = 0;
    await page.addInitScript(() => { window.open = () => null; });
    await page.route('**/api/integrations/emr/google/connect-link', async route => {
      if (route.request().method() === 'POST') {
        if (fail) { fail = false; await route.fulfill({ status: 503, json: { success: false, error: { message: 'Connection is temporarily unavailable. Please retry.' } } }); return; }
        phase = 'awaiting_authorization';
        await route.fulfill({ json: { success: true, data: { connectUrl: 'https://app.superlocalseo.com/connect/test' } } }); return;
      }
      await route.fulfill({ json: { success: true, data: { phase, profileSelected: phase === 'profile_selected', selectedAt: '2026-09-09T00:00:00Z', reviewCount: phase === 'profile_selected' ? 0 : null, lastSyncAt: phase === 'profile_selected' ? '2026-09-09T01:00:00Z' : null, connectUrl: null } } });
    });
    await page.route('**/api/integrations/emr/google/sync', async route => { imports++; await route.fulfill({ status: 202, json: { success: true, data: { queued: true } } }); });
    await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
    await page.goto('/dashboard/settings?tab=integrations');
    const card = page.getByRole('region', { name: 'Google review connection' });
    await card.getByRole('button', { name: 'Connect Google', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText('temporarily unavailable');
    await card.getByRole('button', { name: 'Connect Google', exact: true }).click();
    await expect(card.getByRole('link', { name: 'Continue Google connection' })).toBeVisible();
    phase = 'select_business';
    await card.getByRole('button', { name: 'Check status' }).click();
    await expect(card.getByText('Select your business', { exact: true })).toBeVisible();
    phase = 'profile_selected';
    await card.getByRole('button', { name: 'Check status' }).click();
    await expect(card.getByText('Business profile selected', { exact: true })).toBeVisible();
    await expect(card.getByText('0 Google reviews imported through this connection.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reconnect Google' })).toBeVisible();
    await card.getByRole('button', { name: 'Refresh reviews' }).click();
    await expect(card.getByText('Import requested. Check status shortly to see the result.')).toBeVisible();
    expect(imports).toBe(1);
    await page.screenshot({ path: 'test-results/google-connection-settings.png', fullPage: true });
  });
  test('onboarding uses the same recoverable connection flow', async ({ page }) => {
    await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
    await page.route('**/api/clients', async route => {
      const response = await route.fetch(); const body = await response.json(); body.data.onboardingStep = 4;
      await route.fulfill({ response, json: body });
    });
    await page.route('**/api/integrations/emr/google/connect-link', route => route.fulfill({ json: { success: true, data: { phase: 'expired', profileSelected: false, reviewCount: null, lastSyncAt: null, connectUrl: null } } }));
    await page.goto('/onboarding');
    const card = page.getByRole('region', { name: 'Google review connection' });
    await expect(card.getByText('Connection link expired', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Connect Google' })).toBeEnabled();
  });
});
