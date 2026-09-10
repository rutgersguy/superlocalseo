import { test, expect } from '@playwright/test';
import { createHash } from 'crypto';
import { loginViaUI } from './helpers/auth';
import { dbQuery, dbScalar } from './helpers/db';
import { IS_PRODUCTION_TARGET } from './config';

test.describe('Native review collection', () => {
  test.skip(IS_PRODUCTION_TARGET, 'Isolated fixture only; no public reviews or emails');
  test('owner issues QR link, all ratings retain Google link, private feedback is stored and link revokes', async ({ page, context }) => {
    const client = dbScalar("SELECT c.id FROM clients c JOIN users u ON c.user_id=u.id WHERE u.email='pro@fixture.test'");
    const location = dbScalar(`INSERT INTO locations(client_id,name,google_place_id) VALUES('${client}','Collection browser fixture','ChIJ-collection-browser') RETURNING id`);
    const l = JSON.parse(dbQuery(`SELECT row_to_json(l) FROM locations l WHERE id='${location}'`));
    const identity = createHash('sha256').update(JSON.stringify([l.id,l.client_id,l.name,l.address,l.city,l.state,l.zip,l.google_place_id])).digest('hex');
    dbQuery(`INSERT INTO provider_organization_owners(organization_id,client_id) VALUES('889910','${client}')`);
    dbQuery(`INSERT INTO provider_location_mappings(location_id,client_id,organization_id,provider_location_id,google_place_id,revision,evidence,note,verified_at) VALUES('${location}','${client}','889910','889911','ChIJ-collection-browser',1,'{"localIdentity":"${identity}"}','Isolated browser fixture',now())`);
    try {
      await loginViaUI(page, 'pro@fixture.test', 'TestPass123!');
      await page.goto('/dashboard/campaigns');
      const section = page.locator('div.border-t').filter({ has: page.getByRole('heading', { name: 'Collection browser fixture', exact: true }) });
      await section.getByRole('button', { name: 'Create review link', exact: true }).click();
      const link = section.getByRole('textbox', { name: 'Review link', exact: true });
      await expect(link).toHaveValue(/\/review\/[a-f0-9]{64}$/);
      const url = await link.inputValue(); const path = new URL(url).pathname;
      const downloadPromise = page.waitForEvent('download');
      await section.getByRole('button', { name: 'Download QR code' }).click();
      const download = await downloadPromise; expect(download.suggestedFilename()).toBe('honest-review-qr.png');
      await download.saveAs('test-results/native-review-qr.png');
      const guest = await context.newPage();
      await guest.goto(path);
      const publicLink = guest.getByRole('link', { name: 'Leave an honest Google review' });
      const destination = 'https://search.google.com/local/writereview?placeid=ChIJ-collection-browser';
      await expect(publicLink).toHaveAttribute('href', destination);
      for (const n of [1,2,3,4,5]) {
        await guest.getByRole('radio', { name: `${n} ${n === 1 ? 'star' : 'stars'}`, exact: true }).check();
        await expect(publicLink).toBeVisible(); await expect(publicLink).toHaveAttribute('href', destination);
      }
      await guest.setViewportSize({ width: 390, height: 844 });
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await guest.getByRole('radio', { name: '1 star', exact: true }).focus(); await guest.keyboard.press('Space');
      await guest.getByLabel('Your feedback', { exact: true }).fill('Browser fixture private feedback');
      let first = true; const payloads: any[] = [];
      await guest.route('**/api/collection/*/feedback', async route => {
        payloads.push(route.request().postDataJSON());
        const response = await route.fetch();
        if (first) { first = false; await route.abort('failed'); } else await route.fulfill({ response });
      });
      await guest.getByRole('button', { name: 'Send private feedback', exact: true }).click();
      await expect(guest.getByRole('alert')).toBeVisible();
      await guest.getByRole('button', { name: 'Retry private feedback', exact: true }).click();
      await expect(guest.getByRole('status')).toContainText('Your private feedback was received');
      expect(payloads).toHaveLength(2); expect(payloads[0]).toEqual(payloads[1]);
      await expect(publicLink).toHaveAttribute('href', destination);
      expect(dbScalar(`SELECT count(*) FROM private_feedback WHERE location_id='${location}'`)).toBe('1');
      await guest.screenshot({ path: 'test-results/native-review-mobile.png', fullPage: true });
      await page.goto('/dashboard/reviews'); await page.getByRole('button', { name: /Private feedback/i }).click();
      await expect(page.getByText('Browser fixture private feedback', { exact: true })).toBeVisible();
      await page.goto('/dashboard/campaigns'); page.once('dialog', d => d.accept());
      await section.getByRole('button', { name: 'Disable link', exact: true }).click();
      await expect(section.getByText(/This link is disabled/)).toBeVisible();
      await guest.reload(); await expect(guest.getByRole('heading', { name: 'Review page unavailable' })).toBeVisible();
      await expect(publicLink).toHaveCount(0);
      await guest.close();
    } finally {
      dbQuery(`DELETE FROM private_feedback WHERE location_id='${location}'`);
      dbQuery(`DELETE FROM locations WHERE id='${location}'`);
      dbQuery("DELETE FROM provider_organization_owners WHERE organization_id='889910'");
    }
  });
});
