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
  test('admin verifies a scoped email setup and customer sees configuration status', async ({ page }) => {
    const client = "(SELECT c.id FROM clients c JOIN users u ON u.id=c.user_id WHERE u.email='pro@fixture.test')";
    const before = JSON.parse(dbQuery(`SELECT json_build_object('org',emr_organization_id,'provider',emr_location_id) FROM clients WHERE id=${client}`));
    const places = JSON.parse(dbQuery(`SELECT json_agg(json_build_object('id',id,'place',google_place_id)) FROM locations WHERE client_id=${client}`));
    try {
      dbQuery(`UPDATE clients SET emr_organization_id=990101,emr_location_id=990102 WHERE id=${client}`);
      dbQuery(`UPDATE locations SET google_place_id='ChIJ-browser-fixture' WHERE client_id=${client}`);
      dbQuery(`INSERT INTO emr_campaigns(client_id,emr_campaign_id,name,metrics_pulled_at) VALUES(${client},'browser-verification','Browser verification campaign',now())`);
      await loginViaUI(page, 'admin@fixture.test', 'TestPass123!'); await page.goto('/admin?tab=campaign-setup');
      const card = page.locator('article').filter({ has: page.getByRole('heading', { name: /Fixture Pro Co — Fixture Pro Co/ }) });
      await card.getByText('Update setup / record verification', { exact: true }).click();
      await card.getByLabel('New setup status', { exact: true }).selectOption('verified');
      await card.getByLabel('Verified campaign', { exact: true }).selectOption('browser-verification');
      await card.getByLabel('Confirm Google place ID', { exact: true }).fill('ChIJ-wrong-business');
      for (const checkbox of await card.getByRole('checkbox').all()) await checkbox.check();
      await card.getByLabel('Operator note (internal)', { exact: true }).fill('Browser fixture: all seven configuration checks completed; no messages sent.');
      await card.getByRole('button', { name: 'Save setup record', exact: true }).click();
      await expect(card.getByText('Save and verify the business Google place ID and provider mapping first.', { exact: true })).toBeVisible();
      await card.getByLabel('Confirm Google place ID', { exact: true }).fill('ChIJ-browser-fixture');
      await card.getByRole('button', { name: 'Save setup record', exact: true }).click();
      await expect(card.getByText(/Status: verified/)).toBeVisible();
      await card.getByText('Verification history (1)', { exact: true }).click();
      await expect(card.getByText(/all seven configuration checks completed/)).toBeVisible();
      await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:'test-results/campaign-verification-mobile.png',fullPage:true});
      await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');await page.goto('/dashboard/campaigns');await page.getByRole('button',{name:'Campaign setup',exact:true}).click();
      await expect(page.getByText(/Email campaign setup checked/)).toBeVisible();await expect(page.getByText(/configuration, not delivery/)).toBeVisible();
      dbQuery(`UPDATE locations SET google_place_id='ChIJ-changed-fixture' WHERE client_id=${client}`);
      await page.reload();await page.getByRole('button',{name:'Campaign setup',exact:true}).click();await expect(page.getByText(/must recheck setup/)).toBeVisible();
    } finally {
      dbQuery(`DELETE FROM campaign_setup_requests WHERE client_id=${client}`);
      dbQuery(`DELETE FROM emr_campaigns WHERE client_id=${client} AND emr_campaign_id='browser-verification'`);
      dbQuery(`UPDATE clients SET emr_organization_id=${before.org ?? 'NULL'},emr_location_id=${before.provider ?? 'NULL'} WHERE id=${client}`);
      for(const p of places) dbQuery(`UPDATE locations SET google_place_id=${p.place === null ? 'NULL' : "'"+String(p.place).replace(/'/g,"''")+"'"} WHERE id='${p.id}'`);
    }
  });

});
