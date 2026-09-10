import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { dbQuery, dbScalar } from './helpers/db';
import { IS_PRODUCTION_TARGET } from './config';

test('private feedback guide and saved follow-up work without publishing or contacting anyone', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Disposable fixture; no external messages');
  const client = dbScalar("SELECT c.id FROM clients c JOIN users u ON u.id=c.user_id WHERE u.email='pro@fixture.test'");
  const id = dbScalar(`INSERT INTO private_feedback(client_id,emr_feedback_id,source,contact_name,contact_email,message,rating,received_at) VALUES('${client}','e2e-follow-up-${Date.now()}','native','Follow-up fixture','hidden@example.invalid','Follow-up browser fixture',2,now()) RETURNING id`);
  try {
    await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
    await page.goto('/dashboard/reviews');
    await page.getByRole('button', { name: 'Private Feedback', exact: true }).click();
    await page.getByText('How to manage private feedback', { exact: true }).click();
    await expect(page.getByText(/Saving a status or note sends no message/)).toBeVisible();
    await expect(page.getByText(/Historical EMR feedback and later edits are not backfilled/)).toBeVisible();
    const card = page.locator('div.bg-white.rounded-xl').filter({ has: page.getByText('Follow-up browser fixture', { exact: true }) });
    await card.getByText('Manage follow-up', { exact: true }).click();
    await card.getByLabel('Follow-up status', { exact: true }).selectOption('in_progress');
    await card.getByLabel('Assigned teammate').selectOption({ label: 'pro@fixture.test' });
    await card.getByLabel('Internal notes').fill('Owner will discuss in person.');
    await card.getByRole('button', { name: 'Save follow-up' }).click();
    await expect(card.getByText(/Follow-up: In progress/)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Private Feedback', exact: true }).click();
    await card.getByText('Manage follow-up', { exact: true }).click();
    await expect(card.getByLabel('Internal notes')).toHaveValue('Owner will discuss in person.');
    await expect(card.getByText('hidden@example.invalid', { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/private-feedback-mobile.png', fullPage: true });
  } finally { dbQuery(`DELETE FROM private_feedback WHERE id='${id}'`); }
});
