import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { dbQuery } from './helpers/db';
import { IS_PRODUCTION_TARGET } from './config';

test.describe('Campaign setup request workflow', () => {
  test.skip(IS_PRODUCTION_TARGET, 'Uses isolated fixture accounts only');
  test.beforeAll(() => {
    dbQuery("DELETE FROM campaign_setup_requests WHERE client_id IN (SELECT c.id FROM clients c JOIN users u ON u.id=c.user_id WHERE u.email='pro@fixture.test')");
  });
  test('customer saves a request and admin sees it; unavailable metrics remain explicit', async ({ page }) => {
    await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
    await page.goto('/dashboard/campaigns');
    await page.getByRole('button', { name: 'Campaign setup', exact: true }).click();
    await page.getByRole('button', { name: 'Request campaign setup', exact: true }).click();
    await expect(page.getByText(/Setup requested on/)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Campaign setup', exact: true }).click();
    await expect(page.getByText(/Setup requested on/)).toBeVisible();
    await page.getByRole('button', { name: 'Close campaign setup' }).click();
    await page.getByText('Unsubscribed', { exact: true }).click();
    await expect(page.getByText(/REST API does not expose an unsubscribe list/)).toBeVisible();
    await expect(page.getByText(/great engagement/)).toHaveCount(0);
    await page.screenshot({ path: 'test-results/campaign-setup-customer.png', fullPage: true });
    await loginViaUI(page, 'admin@fixture.test', 'TestPass123!');
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Campaign setup', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Fixture Pro Co — Fixture Pro Co/ })).toBeVisible();
    await expect(page.getByText(/not proof of delivery or destination accuracy/)).toBeVisible();
    await page.screenshot({ path: 'test-results/campaign-setup-admin.png', fullPage: true });
  });
});
