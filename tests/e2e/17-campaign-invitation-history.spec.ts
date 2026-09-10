import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { IS_PRODUCTION_TARGET } from './config';

test('invitation UI recovers the same request and explains provider outcomes', async ({page}) => {
  test.skip(IS_PRODUCTION_TARGET,'Simulated invitation API; never sends upstream');
  await loginViaUI(page,'pro@fixture.test','TestPass123!');
  const requests:unknown[]=[];
  await page.route('**/api/campaigns',r=>r.fulfill({json:{success:true,data:{campaigns:[{id:'fixture',emrCampaignId:'fixture',name:'Invitation browser fixture',invited:null,opened:3,clicked:null,reviewed:null,privateFeedback:null,unsubscribed:null}]}}}));
  await page.route('**/api/campaigns/fixture/invite',r=>{requests.push(r.request().postDataJSON());return requests.length===1?r.abort('failed'):r.fulfill({json:{success:true,data:{requestId:(requests[0] as any).requestId,accepted:0,uncertain:1,rejected:0,duplicateBlocked:0}}});});
  await page.goto('/dashboard/campaigns');
  await expect(page.getByRole('heading',{name:'Invitation request history'})).toBeVisible();
  await page.getByText('How to investigate an invitation',{exact:true}).click();
  await expect(page.getByText(/Refreshing this history does not query delivery/)).toBeVisible();
  await page.getByRole('heading',{name:'Invitation browser fixture'}).click();
  await expect(page.getByText('Unknown provider invitations',{exact:true})).toBeVisible();
  await page.getByLabel('First name',{exact:true}).fill('Test');
  await page.getByLabel('Email',{exact:true}).fill('test@example.invalid');
  await page.getByRole('button',{name:'Send email invite',exact:true}).click();
  await expect(page.getByRole('button',{name:'Recover same request'})).toBeVisible();
  await expect(page.getByLabel('Email',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Recover same request'}).click();
  await expect(page.getByText('Accepted: 0 · Unknown/unresolved: 1 · Rejected: 0 · Duplicate blocked: 0',{exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  await page.getByRole('button',{name:'Bulk CSV'}).click();
  await page.getByLabel('Contacts CSV').fill('first_name,email\nTest,test@example.invalid\nInvalid');
  await page.getByRole('button',{name:'Submit email invitations'}).click();
  await expect(page.getByText('Row 3 has the wrong number of columns.',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/invitation-mobile.png',fullPage:true});
});

test('admin invitation history is reachable with recovery guidance',async({page})=>{
  test.skip(IS_PRODUCTION_TARGET,'Fixture account');
  await loginViaUI(page,'admin@fixture.test','TestPass123!');
  await page.goto('/admin?tab=campaign-invitations');
  await expect(page.getByRole('heading',{name:'Invitation request history'})).toBeVisible();
  await page.getByLabel('Status',{exact:true}).selectOption('uncertain');
  await expect(page.getByText('No recorded invitation requests match this filter.',{exact:true})).toBeVisible();
  await page.getByText('How to investigate an invitation',{exact:true}).click();
  await expect(page.getByText(/unresolved requests indefinitely/)).toBeVisible();
});
