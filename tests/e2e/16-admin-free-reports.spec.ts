import { test, expect } from '@playwright/test';
import { IS_PRODUCTION_TARGET, ADMIN_EMAIL, ADMIN_PASSWORD } from './config';
import { loginViaUI } from './helpers/auth';
const id = '33333333-3333-4333-8333-333333333333';
const row = { id, businessName: 'Report fixture', email: 'owner@example.test', city: 'Atlanta', keyword: 'video production', createdAt: '2026-09-09T12:00:00Z', updatedAt: '2026-09-09T12:05:00Z', generatedAt: '2026-09-09T12:05:00Z', status: 'completed', emailStatus: 'accepted', stale: false, needsAttention: false, hasSnapshot: true, checked: 9, unavailable: 0, error: null, consentAt: '2026-09-09T12:00:00Z', consentVersion: 'report-delivery-only-v1' };
test.describe('Admin free reports', () => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated fixtures only');
  test('lists reports, opens the saved report, and filters and paginates without mutations', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const mutations: string[] = [];
    page.on('request', r => { if (r.url().includes('/free-reports') && r.method() !== 'GET') mutations.push(r.method()); });
    await page.route('**/api/admin/free-reports?*', async route => {
      const q = new URL(route.request().url()).searchParams;
      const reports = q.get('search') === 'missing' ? [] : q.get('status') === 'attention' ? [{ ...row, emailStatus: 'failed', needsAttention: true }] : q.get('page') === '2' ? [{ ...row, businessName: 'Second page report' }] : [row];
      await route.fulfill({ json: { success: true, data: { reports, total: reports.length ? 26 : 0, hasMore: q.get('page') === '1' && reports.length > 0 } } });
    });
    await page.goto('/admin?tab=free-reports');
    await expect(page.getByRole('heading', { name: 'Free report leads' })).toBeVisible();
    await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
    await expect(page.getByText('Accepted by email provider', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open report', exact: true })).toHaveAttribute('href', `/free-report/${id}`);
    const popupEvent = page.waitForEvent('popup'); await page.getByRole('link', { name: 'Open report', exact: true }).click(); const popup = await popupEvent;
    await expect(popup.getByRole('heading', { name: 'Light Hawk Studios', exact: true })).toBeVisible(); await popup.close();
    await page.getByRole('button', { name: 'Next', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Second page report' })).toBeVisible();
    await page.getByLabel('Report status', { exact: true }).selectOption('attention'); await expect(page.getByText('Acceptance not confirmed', { exact: true })).toBeVisible();
    await page.getByLabel('Search reports').fill('missing'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await expect(page.getByText('No reports match these filters.')).toBeVisible();
    await page.getByLabel('Search reports').fill(''); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByText('Acceptance not confirmed', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/admin-reports-mobile.png', fullPage: true }); expect(mutations).toEqual([]);
    await page.route('**/api/admin/free-reports?*', r => r.fulfill({ status: 503, json: { success: false, error: { message: 'Unavailable' } } }));
    await page.getByRole('button', { name: 'Refresh reports', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Could not load reports');
  });
  test('explains recovery and queues only an eligible saved request', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    let calls=0;
    await page.route('**/api/admin/free-reports?*', r => r.fulfill({json:{success:true,data:{reports:[{...row,emailStatus:'rejected',needsAttention:true,recovery:{allowed:true,reason:'Send the saved report to its original recipient; no new scan is purchased.'}}],total:1,hasMore:false}}}));
    await page.route(`**/api/admin/free-reports/${id}/recover`, async r => { expect(r.request().method()).toBe('POST');calls++;await r.fulfill({status:202,json:{success:true,data:{message:'Recovery queued'}}}); });
    await page.goto('/admin?tab=free-reports');
    await page.getByText('How report recovery works', {exact:true}).click();
    await expect(page.getByText('No marketing consent is implied.',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Retry report email',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('Recovery queued');expect(calls).toBe(1);
    await page.route('**/api/admin/free-reports?*', r => r.fulfill({json:{success:true,data:{reports:[{...row,emailStatus:'uncertain',recovery:{allowed:false,reason:'Email outcome is unknown; resend blocked.'}}],total:1,hasMore:false}}}));
    await page.getByRole('button',{name:'Refresh reports',exact:true}).click();
    await expect(page.getByText('Outcome unknown — resend blocked',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Retry report email',exact:true})).toHaveCount(0);
  });

});
