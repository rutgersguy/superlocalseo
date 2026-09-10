import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { dbQuery, dbScalar } from './helpers/db';
import { IS_PRODUCTION_TARGET } from './config';

test('uncertain reply exposes a status check and never sends a second publish', async ({ page }) => {
  test.skip(IS_PRODUCTION_TARGET, 'Fixture UI contract; upstream writes are simulated');
  const client = dbScalar("SELECT c.id FROM clients c JOIN users u ON c.user_id=u.id WHERE u.email='pro@fixture.test'");
  const id = dbScalar(`INSERT INTO reviews(client_id,source,platform,external_review_id,author_name,rating,body) VALUES('${client}','emr','Google','browser-recovery','Recovery fixture',5,'Reply recovery fixture') RETURNING id`);
  let publishes=0, checks=0, status='draft';
  try {
    await loginViaUI(page,'pro@fixture.test','TestPass123!');
    await page.route(`**/api/reviews/${id}/response`, route => route.fulfill({json:{success:true,data:{id:'fixture',reviewId:id,draftBody:'Suggested reply',finalBody:status==='draft'?null:'Approved browser reply',status,lastPublishError:status==='uncertain'?'Publication outcome is unknown.':null}}}));
    await page.route(`**/api/reviews/${id}/publish`, route => { publishes++; expect(route.request().postDataJSON()).toEqual({body:'Approved browser reply'}); status='uncertain'; return route.fulfill({status:409,json:{success:false,error:{message:'Publication outcome is unknown. Use Check publication status.'}}}); });
    await page.route(`**/api/reviews/${id}/reconcile`, route => { checks++; return route.fulfill({json:{success:true,data:{published:false,checked:true,retryAllowed:false}}}); });
    await page.goto('/dashboard/reviews');
    const card=page.locator('div.shadow-card').filter({has:page.getByText('Reply recovery fixture',{exact:true})});
    await card.getByRole('button',{name:'Post to Google',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Approve and post reply'})).toBeVisible();
    await page.getByPlaceholder('Write your reply…').fill('Approved browser reply');
    await page.getByRole('button',{name:'Approve and post',exact:true}).click();
    await expect(page.getByRole('button',{name:'Check publication status',exact:true})).toBeVisible();
    await expect(page.getByPlaceholder('Write your reply…')).toBeDisabled();
    await page.getByRole('button',{name:'Check publication status',exact:true}).click();
    await expect(page.getByText('No reply is visible at the provider yet. No resend was attempted.',{exact:true})).toBeVisible();
    expect(publishes).toBe(1); expect(checks).toBe(1);
    await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/reply-recovery-mobile.png',fullPage:true});
  } finally { dbQuery(`DELETE FROM reviews WHERE id='${id}'`); }
});
