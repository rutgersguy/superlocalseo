import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('expanded SEO findings show repairs while retaining Lighthouse performance', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated display fixture; no crawl purchases');
  const id = '00000000-0000-4000-8000-000000000123';
  await page.route('**/api/locations', r => r.fulfill({ json: { success: true, data: [{ id, name: 'Fitness fixture', website: 'https://fitness.example' }] } }));
  const audits = [{ id: 'audit-fixture', locationId: id, status: 'complete', onPageScore: 87, onPageDetails: [], createdAt: new Date().toISOString(),
    dfsLighthouseTaskId: 'existing-lighthouse', dfsOnPageData: { performanceScore: 83, accessibilityScore: 97, bestPracticesScore: 73, seoScore: 100, lcp: 1900, cls: 0.02, tbt: 50, categoryAudits: { performance: [], accessibility: [], bestPractices: [], seo: [] } },
    websiteCrawl: { status: 'complete', data: { target: 'https://fitness.example', pagesReturned: 2, pagesCrawled: 2, pageLimit: 100, fetchedAt: new Date().toISOString(), pages: [], checks: [
      { key: 'no_description', title: 'Missing meta descriptions', priority: 'medium', why: 'Search engines have no supplied summary.', fix: 'Add a page-specific description in your CMS SEO settings.', testedPages: 2, affectedPages: 1, urls: ['https://fitness.example/training'] },
      { key: 'no_title', title: 'Missing page titles', priority: 'medium', why: '', fix: '', testedPages: 0, affectedPages: 0, urls: [] },
    ] } },
  }];
  await page.route('**/api/audits/bl', r => r.fulfill({ json: { success: true, data: { audits } } }));
  await page.route('**/api/audits/bl/location/*/history', r => r.fulfill({ json: { success: true, data: { audits } } }));
  await loginViaUI(page, 'pro@fixture.test', 'TestPass123!'); await page.goto('/dashboard/audit');
  await expect(page.getByRole('heading', { name: 'Website Performance', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'On-Page SEO Checks', exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Missing meta descriptions' }).click();
  await expect(page.getByText('How to fix it', { exact: true })).toBeVisible();
  await expect(page.getByText('Add a page-specific description in your CMS SEO settings.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://fitness.example/training', exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'All checks and coverage' }).click();
  await expect(page.getByText('Not checked: no observation returned', { exact: false })).toBeVisible();
});
