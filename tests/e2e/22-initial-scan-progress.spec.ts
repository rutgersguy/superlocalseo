import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('first-scan progress updates and refreshes data without a Refresh click', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated fixture with simulated scan progress');
  let complete = false; let dataReads = 0;
  await page.route('**/api/locations/initial-scans', route => route.fulfill({ json: { success: true, data: [
    { locationId: 'fixture', locationName: 'Fixture Fitness', step: 'ai', status: complete ? 'complete' : 'running', reason: null, updatedAt: complete ? '2026-09-15T01:01:00Z' : '2026-09-15T01:00:00Z' },
    { locationId: 'fixture', locationName: 'Fixture Fitness', step: 'reviews', status: 'waiting', reason: 'Connect Google reviews and verify the provider location mapping.', updatedAt: '2026-09-15T01:00:00Z' },
  ] } }));
  await page.route('**/api/ai-visibility', async route => { dataReads++; await route.continue(); });
  await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
  await page.goto('/dashboard/ai-visibility');
  const progress = page.getByRole('status').filter({ hasText: 'Results appear as each check finishes.' });
  await expect(progress).toContainText('Your first scans are running automatically.');
  await progress.getByText('View checks and next steps').click();
  await expect(progress).toContainText('Connect Google reviews');
  const previousReads = dataReads;
  complete = true;
  await expect(progress).toContainText('AI visibility: complete', { timeout: 20000 });
  await expect.poll(() => dataReads, { timeout: 5000 }).toBeGreaterThan(previousReads);
  await expect(progress).toContainText('First scan status');
});
